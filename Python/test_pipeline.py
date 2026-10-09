# IoMT Pipeline Test Script
# Usage: .\venv_stage5\Scripts\python.exe test_pipeline.py
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import urllib.request, json, time

BASE_URL = "http://localhost:3000"
API_KEY  = "iomt-secret-key-2024"

def post(path, data):
    body = json.dumps(data).encode()
    req  = urllib.request.Request(
        BASE_URL + path, data=body,
        headers={"Content-Type": "application/json", "x-api-key": API_KEY}
    )
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


tests = [
    {
        "label": "[CRITICAL] Hypoxia + Tachycardia + Fever",
        "data": {
            "pid": "P001", "device": "TEST",
            "timestamp": "2026-09-04T15:00:00Z",
            "heart_rate": 130, "spo2": 87,
            "temperature": 39.1, "systolic": 95, "diastolic": 60
        }
    },
    {
        "label": "[WARNING] Mild Tachycardia",
        "data": {
            "pid": "P001", "device": "TEST",
            "timestamp": "2026-09-04T15:00:05Z",
            "heart_rate": 108, "spo2": 95,
            "temperature": 37.2, "systolic": 125, "diastolic": 80
        }
    },
    {
        "label": "[NORMAL] Healthy vitals",
        "data": {
            "pid": "P001", "device": "TEST",
            "timestamp": "2026-09-04T15:00:10Z",
            "heart_rate": 72, "spo2": 98,
            "temperature": 36.8, "systolic": 118, "diastolic": 76
        }
    }
]

print("=" * 60)
print("  IoMT Pipeline Test — sending vitals to Node.js backend")
print("=" * 60)

for t in tests:
    print("\n" + t['label'])
    print("  Sending: HR=%s, SpO2=%s, Temp=%s" % (t['data']['heart_rate'], t['data']['spo2'], t['data']['temperature']))
    try:
        resp = post("/api/vitals", t["data"])
        print(f"  ✅ Backend response: {resp}")
        print(f"  ⏳ Check dashboard for AI panel update...")
    except Exception as e:
        print(f"  ❌ Error: {e}")
    time.sleep(3)  # wait 3 seconds between tests so dashboard updates are visible

print("\n" + "=" * 60)
print("  Done! Check your browser dashboard for AI panel results.")
print("=" * 60)
