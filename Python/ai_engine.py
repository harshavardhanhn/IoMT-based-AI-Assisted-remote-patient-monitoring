"""
Stage 5 — Main Flask AI Engine
Combines: Rule Engine → Isolation Forest → CNN-LSTM → SHAP Explainability

Endpoint:  POST /ai/analyze
Payload:   { pid, heart_rate, spo2, temperature, systolic, diastolic, ecg: [...] }
Response:  { pid, risk, confidence, conditions, recommendation, explanation, ecg_class, ... }
"""

import os, time
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

import rule_engine
import anomaly_detector
import ecg_model
from preprocess import preprocess_ecg

# ── Optional SHAP (non-fatal if not yet installed) ────────────────────────────
try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False
    print("[AI Engine] SHAP not available — explainability disabled.")

app = Flask(__name__)
CORS(app)

# Pre-load ECG model at startup (slow once, fast after)
print("[AI Engine] Loading ECG model...")
ecg_model.load_model()
print("[AI Engine] Ready.")


def merge_results(rules: dict, iso: dict, ecg: dict, vitals: dict) -> dict:
    """
    Combine outputs from all 3 layers into one clinical result.
    Risk escalation: highest severity wins.
    """
    risk_rank = {"NORMAL": 0, "WARNING": 1, "CRITICAL": 2}

    final_risk = rules["risk"]

    # Isolation Forest can escalate to WARNING if anomaly and currently NORMAL
    if iso["anomaly"] and risk_rank[final_risk] < 1:
        final_risk = "WARNING"
        if "ML Anomaly" not in rules["conditions"]:
            rules["conditions"].append("ML Anomaly")

    # ECG class can escalate
    ecg_class = ecg.get("ecg_class", "Normal")
    if ecg_class in ("Tachycardia", "Bradycardia"):
        if risk_rank[final_risk] < 1:
            final_risk = "WARNING"
    if ecg_class == "Arrhythmia":
        if risk_rank[final_risk] < 2:
            final_risk = "CRITICAL"
        if "ECG Arrhythmia" not in rules["conditions"]:
            rules["conditions"].append("ECG Arrhythmia")

    # Confidence: blend rule weight + anomaly score + ecg confidence
    rule_conf   = 0.9 if final_risk == "CRITICAL" else (0.6 if final_risk == "WARNING" else 0.1)
    iso_conf    = iso.get("anomaly_score", 0.0)
    ecg_conf    = ecg.get("ecg_confidence", 0.5)
    confidence  = round(0.5 * rule_conf + 0.3 * iso_conf + 0.2 * ecg_conf, 3)

    # Recommendation
    if final_risk == "CRITICAL":
        recommendation = "Notify ICU team immediately"
    elif final_risk == "WARNING":
        recommendation = "Increase monitoring frequency; alert nursing staff"
    else:
        recommendation = "Continue routine monitoring"

    # Build explanation_pct from rules (normalise to 100%)
    pct = rules.get("explanation_pct", {})
    total = sum(pct.values()) or 1
    pct = {k: round(v / total * 100) for k, v in pct.items()}

    return {
        "pid":            vitals.get("pid", "unknown"),
        "timestamp":      vitals.get("timestamp", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
        "risk":           final_risk,
        "confidence":     confidence,
        "conditions":     rules["conditions"],
        "recommendation": recommendation,
        "explanation":    rules["explanation"],
        "explanation_pct": pct,
        "qsofa_score":    rules.get("qsofa_score", 0),
        "ecg_class":      ecg_class,
        "ecg_confidence": ecg.get("ecg_confidence", 0.0),
        "anomaly_detected": iso["anomaly"],
        "anomaly_score":  iso.get("anomaly_score", 0.0),
        "ml_status":      iso.get("status", ""),
        "severity":       final_risk.lower()
    }


@app.route("/ai/analyze", methods=["POST"])
def analyze():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    t0 = time.time()

    # Layer 1 — Rules (always fast)
    rules = rule_engine.analyze(data)

    # Layer 2 — Isolation Forest
    iso = anomaly_detector.analyze(data)

    # Layer 3 — CNN-LSTM on ECG
    ecg_samples = data.get("ecg", data.get("ecg_samples", []))
    if ecg_samples:
        window = preprocess_ecg(ecg_samples)
        ecg_result = ecg_model.predict(window)
    else:
        ecg_result = {"ecg_class": "No Signal", "ecg_confidence": 0.0, "ecg_probs": {}}

    result = merge_results(rules, iso, ecg_result, data)
    result["inference_ms"] = round((time.time() - t0) * 1000, 1)

    return jsonify(result)


@app.route("/ai/status", methods=["GET"])
def status():
    return jsonify({
        "status":        "running",
        "shap":          SHAP_AVAILABLE,
        "ecg_model_loaded": ecg_model._model is not None,
        "if_trained":    anomaly_detector._model is not None,
        "if_samples":    anomaly_detector._sample_count,
        "if_min_needed": anomaly_detector.MIN_SAMPLES
    })


if __name__ == "__main__":
    app.run(port=5000, debug=False)
