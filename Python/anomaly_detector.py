"""
Layer 2: Anomaly Detector — Isolation Forest
Unsupervised ML that learns what "normal" looks like from the first
200 real vitals packets. No labelled dataset required.
"""

import numpy as np
import joblib
import os
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

MODEL_PATH  = "models/anomaly_detector.pkl"
SCALER_PATH = "models/anomaly_scaler.pkl"
MIN_SAMPLES = 200        # train after collecting this many samples
RETRAIN_EVERY = 500      # retrain periodically to adapt to patient

FEATURES = ["heart_rate", "spo2", "temperature", "systolic", "diastolic"]

_buffer: list[list[float]] = []   # raw training buffer
_model: IsolationForest | None = None
_scaler: StandardScaler | None = None
_sample_count = 0


def _extract(vitals: dict) -> list[float]:
    return [vitals.get(f, 0.0) for f in FEATURES]


def _train(X: np.ndarray):
    global _model, _scaler
    _scaler = StandardScaler()
    Xs = _scaler.fit_transform(X)
    _model = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
    _model.fit(Xs)
    os.makedirs("models", exist_ok=True)
    joblib.dump(_model,  MODEL_PATH)
    joblib.dump(_scaler, SCALER_PATH)
    print(f"[AnomalyDetector] Trained on {len(X)} samples, model saved.")


def _load_saved():
    global _model, _scaler
    if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH):
        _model  = joblib.load(MODEL_PATH)
        _scaler = joblib.load(SCALER_PATH)
        print("[AnomalyDetector] Loaded saved model.")
        return True
    return False


# Try to load on import
_load_saved()


def analyze(vitals: dict) -> dict:
    global _buffer, _model, _scaler, _sample_count

    row = _extract(vitals)
    _buffer.append(row)
    _sample_count += 1

    # Trigger (re)training
    if len(_buffer) >= MIN_SAMPLES:
        if _model is None or (_sample_count % RETRAIN_EVERY == 0):
            _train(np.array(_buffer))
        _buffer = []      # clear after training to avoid unbounded growth

    if _model is None:
        return {
            "anomaly":     False,
            "anomaly_score": 0.0,
            "status":      f"Collecting baseline ({_sample_count}/{MIN_SAMPLES} samples)",
            "layer":       "isolation_forest"
        }

    X = np.array([row])
    Xs = _scaler.transform(X)
    score   = float(_model.decision_function(Xs)[0])   # negative = more anomalous
    is_anom = _model.predict(Xs)[0] == -1              # -1 = anomaly

    # Normalise score to 0–1 confidence (higher = more anomalous)
    conf = float(np.clip(1 - (score + 0.5), 0.0, 1.0))

    return {
        "anomaly":       bool(is_anom),
        "anomaly_score": round(conf, 3),
        "status":        "Anomaly detected" if is_anom else "Pattern within normal range",
        "layer":         "isolation_forest"
    }
