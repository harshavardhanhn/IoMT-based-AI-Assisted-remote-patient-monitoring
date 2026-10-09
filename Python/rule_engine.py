"""
Layer 1: Clinical Rule Engine
Medical thresholds based on clinical literature.
Always runs — provides instant result regardless of ML model state.
"""

# ── Clinical threshold constants ──────────────────────────────────────────────

HR_BRADYCARDIA_CRITICAL = 40
HR_BRADYCARDIA_WARNING  = 60
HR_NORMAL_LOW           = 60
HR_NORMAL_HIGH          = 100
HR_TACHY_WARNING        = 100
HR_TACHY_CRITICAL       = 150

SPO2_CRITICAL           = 90
SPO2_WARNING            = 94
SPO2_NORMAL             = 95

TEMP_HYPOTHERMIA_CRIT   = 35.0
TEMP_HYPOTHERMIA_WARN   = 36.0
TEMP_HYPERTHERMIA_WARN  = 38.0
TEMP_HYPERTHERMIA_CRIT  = 39.5

SBP_HYPOTENSION_CRIT    = 80
SBP_HYPOTENSION_WARN    = 90
SBP_HYPERTENSION_WARN   = 140
SBP_HYPERTENSION_CRIT   = 180

DBP_HYPERTENSION_WARN   = 90
DBP_HYPERTENSION_CRIT   = 120


def analyze(vitals: dict) -> dict:
    """
    Run all clinical rules on a vitals packet.
    Returns a dict: { risk, conditions, explanation, qsofa_score }
    """
    hr   = vitals.get("heart_rate", 75)
    spo2 = vitals.get("spo2", 98)
    temp = vitals.get("temperature", 37.0)
    sbp  = vitals.get("systolic", 120)
    dbp  = vitals.get("diastolic", 80)

    conditions   = []
    explanations = {}
    risk_weights = {}          # param → contribution weight (0–1)
    max_severity = 0           # 0=normal, 1=warning, 2=critical

    # ── Heart Rate ──────────────────────────────────────────────────────────
    if hr < HR_BRADYCARDIA_CRITICAL:
        conditions.append("Severe Bradycardia")
        explanations["heart_rate"] = f"Critically low ({hr} BPM) — severe bradycardia"
        risk_weights["heart_rate"] = 0.45
        max_severity = max(max_severity, 2)
    elif hr < HR_BRADYCARDIA_WARNING:
        conditions.append("Bradycardia")
        explanations["heart_rate"] = f"Low ({hr} BPM) — bradycardia"
        risk_weights["heart_rate"] = 0.30
        max_severity = max(max_severity, 1)
    elif hr > HR_TACHY_CRITICAL:
        conditions.append("Severe Tachycardia")
        explanations["heart_rate"] = f"Critically high ({hr} BPM) — severe tachycardia"
        risk_weights["heart_rate"] = 0.45
        max_severity = max(max_severity, 2)
    elif hr > HR_TACHY_WARNING:
        conditions.append("Tachycardia")
        explanations["heart_rate"] = f"Elevated ({hr} BPM) — tachycardia"
        risk_weights["heart_rate"] = 0.25
        max_severity = max(max_severity, 1)
    else:
        explanations["heart_rate"] = f"Normal ({hr} BPM)"
        risk_weights["heart_rate"] = 0.0

    # ── SpO2 ────────────────────────────────────────────────────────────────
    if spo2 < SPO2_CRITICAL:
        conditions.append("Hypoxia")
        explanations["spo2"] = f"Critical ({spo2}%) — severe hypoxia"
        risk_weights["spo2"] = 0.40
        max_severity = max(max_severity, 2)
    elif spo2 < SPO2_WARNING:
        conditions.append("Low SpO2")
        explanations["spo2"] = f"Low ({spo2}%) — mild hypoxemia"
        risk_weights["spo2"] = 0.20
        max_severity = max(max_severity, 1)
    else:
        explanations["spo2"] = f"Normal ({spo2}%)"
        risk_weights["spo2"] = 0.0

    # ── Temperature ─────────────────────────────────────────────────────────
    if temp > TEMP_HYPERTHERMIA_CRIT:
        conditions.append("High Fever")
        explanations["temperature"] = f"Critical fever ({temp}°C)"
        risk_weights["temperature"] = 0.20
        max_severity = max(max_severity, 2)
    elif temp > TEMP_HYPERTHERMIA_WARN:
        conditions.append("Fever")
        explanations["temperature"] = f"Elevated ({temp}°C) — fever"
        risk_weights["temperature"] = 0.10
        max_severity = max(max_severity, 1)
    elif temp < TEMP_HYPOTHERMIA_CRIT:
        conditions.append("Hypothermia")
        explanations["temperature"] = f"Critical low temp ({temp}°C)"
        risk_weights["temperature"] = 0.20
        max_severity = max(max_severity, 2)
    elif temp < TEMP_HYPOTHERMIA_WARN:
        conditions.append("Low Temperature")
        explanations["temperature"] = f"Low ({temp}°C)"
        risk_weights["temperature"] = 0.10
        max_severity = max(max_severity, 1)
    else:
        explanations["temperature"] = f"Normal ({temp}°C)"
        risk_weights["temperature"] = 0.0

    # ── Blood Pressure ───────────────────────────────────────────────────────
    if sbp < SBP_HYPOTENSION_CRIT:
        conditions.append("Severe Hypotension")
        explanations["blood_pressure"] = f"Critical low BP ({sbp}/{dbp} mmHg)"
        risk_weights["blood_pressure"] = 0.35
        max_severity = max(max_severity, 2)
    elif sbp < SBP_HYPOTENSION_WARN:
        conditions.append("Hypotension")
        explanations["blood_pressure"] = f"Low BP ({sbp}/{dbp} mmHg)"
        risk_weights["blood_pressure"] = 0.20
        max_severity = max(max_severity, 1)
    elif sbp > SBP_HYPERTENSION_CRIT or dbp > DBP_HYPERTENSION_CRIT:
        conditions.append("Hypertensive Crisis")
        explanations["blood_pressure"] = f"Critical high BP ({sbp}/{dbp} mmHg)"
        risk_weights["blood_pressure"] = 0.30
        max_severity = max(max_severity, 2)
    elif sbp > SBP_HYPERTENSION_WARN or dbp > DBP_HYPERTENSION_WARN:
        conditions.append("Hypertension")
        explanations["blood_pressure"] = f"High BP ({sbp}/{dbp} mmHg)"
        risk_weights["blood_pressure"] = 0.15
        max_severity = max(max_severity, 1)
    else:
        explanations["blood_pressure"] = f"Normal ({sbp}/{dbp} mmHg)"
        risk_weights["blood_pressure"] = 0.0

    # ── qSOFA Score (early sepsis screening) ─────────────────────────────────
    # Score 1 point each. The edge packet does not carry RR or mentation, so
    # those inputs remain optional for future bedside integrations.
    qsofa = 0
    if vitals.get("respiratory_rate", 0) > 22:
        qsofa += 1
    if vitals.get("altered_mentation", False):
        qsofa += 1
    if sbp < 100:
        qsofa += 1
    if qsofa >= 2:
        if "Sepsis Risk (qSOFA≥2)" not in conditions:
            conditions.append("Sepsis Risk (qSOFA≥2)")
        explanations["qsofa"] = f"qSOFA score {qsofa}/2 — possible sepsis"
        risk_weights["qsofa"] = 0.30
        max_severity = max(max_severity, 2)

    # ── Combined patterns ────────────────────────────────────────────────────
    if hr > HR_TACHY_WARNING and spo2 < SPO2_WARNING:
        if "Respiratory Distress Pattern" not in conditions:
            conditions.append("Respiratory Distress Pattern")
        max_severity = max(max_severity, 2)

    if temp > 38.0 and hr > 100:
        if "Sepsis Pattern" not in conditions:
            conditions.append("Sepsis Pattern")
        max_severity = max(max_severity, 1)

    # ── Map severity to risk level ───────────────────────────────────────────
    risk_map = {0: "NORMAL", 1: "WARNING", 2: "CRITICAL"}
    risk = risk_map[max_severity]

    # Compute normalised per-param % contribution for explanation bar
    total_weight = sum(risk_weights.values()) or 1.0
    explanation_pct = {
        k: round(v / total_weight * 100) for k, v in risk_weights.items() if v > 0
    }

    return {
        "risk":            risk,
        "conditions":      conditions,
        "explanation":     explanations,
        "explanation_pct": explanation_pct,
        "qsofa_score":     qsofa,
        "layer":           "rule_engine"
    }
