# Pulsegrid Clinical Dashboard

This is the canonical React/Vite frontend for the IoMT patient-monitoring system.

It connects to the Node.js backend and displays:

- Live ECG samples from ESP32 devices
- Heart rate, SpO2, temperature, and blood pressure
- AI risk, confidence, ECG classification, qSOFA, and explanations
- Real-time warnings and critical alerts
- Authenticated WebSocket connection status

## Run

From `D:\project\frontend`:

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

Open the Vite URL, normally `http://localhost:5173`.

The backend must be running on port `3000`, and the Python AI service must be running on port `5000`.

Optional Vite environment variables:

```env
VITE_API_BASE=http://localhost:3000
VITE_WS_BASE=ws://localhost:3000
```
