"""Standalone IoMT intrusion-detection service.

This prototype accepts CIC-IoMT-style numeric flow features at port 5001. It
keeps network security scoring separate from the clinical AI service, so a
future CIC-IoMT2024 model can replace the heuristic without changing the
clinical telemetry API.
"""

import os
import time
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

PACKET_RATE_LIMIT = float(os.getenv("IDS_PACKET_RATE_LIMIT", "250"))
SUSPICIOUS_PORTS = {21, 23, 445, 3389}


def score_flow(flow: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic baseline IDS decision for one network flow."""
    score = 0.0
    reasons = []
    destination_port = int(flow.get("destination_port", 0) or 0)
    packet_rate = float(flow.get("packets_per_second", 0) or 0)
    failed_auth = int(flow.get("failed_auth", 0) or 0)

    if destination_port in SUSPICIOUS_PORTS:
        score += 0.35
        reasons.append("sensitive destination port")
    if packet_rate > PACKET_RATE_LIMIT:
        score += 0.4
        reasons.append("abnormal packet rate")
    if failed_auth >= 5:
        score += 0.35
        reasons.append("repeated authentication failures")
    if float(flow.get("payload_entropy", 0) or 0) > 7.8:
        score += 0.2
        reasons.append("high payload entropy")

    score = min(score, 1.0)
    label = "malicious" if score >= 0.7 else "suspicious" if score >= 0.35 else "benign"
    return {
        "label": label,
        "anomaly_score": round(score, 3),
        "reasons": reasons,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@app.post("/ids/analyze")
def analyze():
    flow = request.get_json(silent=True)
    if not isinstance(flow, dict):
        return jsonify({"error": "JSON flow object required"}), 400
    return jsonify(score_flow(flow))


@app.get("/ids/status")
def status():
    return jsonify({
        "status": "running",
        "port": 5001,
        "model": "baseline-heuristic",
        "dataset_ready": False,
        "dataset": "CIC-IoMT2024",
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
