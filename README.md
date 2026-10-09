# Secure IoMT Patient Monitoring System

## Overview
This is a prototype combining real-time IoMT telemetry, AI diagnostics, and multi-layered security.

## Structure
- `esp32/`: C++ code for the ESP32 to read sensors (or simulate) and send to backend.
- `backend/`: Node.js/Express/WebSocket server that stores data in MongoDB and broadcasts to frontend.
- `frontend/`: React/Vite dashboard for real-time visualization.
- `ai_engine/`: Python Flask service with dummy Deep Learning models for anomaly detection.

## How to run the prototype
1. **Database:** Ensure MongoDB is running locally on `mongodb://127.0.0.1:27017`
2. **Backend Server:**
   ```bash
   cd backend
   npm install
   copy .env.example .env
   # Set MONGODB_URI, JWT_SECRET, and DEVICE_API_KEY in .env
   node server.js
   ```
   The backend will start on `http://localhost:3000`.
3. **React Frontend Dashboard:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open the Vite URL shown in the terminal, normally `http://localhost:5173`.
4. **AI Engine:**
   ```bash
   cd ai_engine
   # Use the full Python environment from the project, or create one and install requirements.
   ..\Python\venv_stage5\Scripts\activate
   pip install -r requirements.txt
   python app.py
   ```
5. **Intrusion Detection Service:**
   ```bash
   cd Python
   ..\Python\venv_stage5\Scripts\activate
   pip install -r requirements.txt
   python ids_service.py
   ```
   The IDS listens on `http://localhost:5001` with `/ids/analyze` and
   `/ids/status`. Its deterministic baseline scorer is ready for replacement
   with a trained CIC-IoMT2024 model.
6. **ESP32 Firmware:**
   Open `esp32/patient_monitor.ino` in Arduino IDE. Set Wi-Fi credentials, server URLs, and the device API key. It runs in simulation mode by default. Set `USE_SIMULATION` to `0` and install the MAX30105, OneWire, and DallasTemperature libraries to use the MAX30102, AD8232 analog input, and DS18B20 sensors.

## Components Implemented
- **Stage 1 & 2:** Hardware simulation firmware sends canonical `/ecg` and `/vitals` packets.
- **Stage 3 & 4:** Node.js Backend with `/ecg`, `/vitals`, `/login`, `/api/latest`, `/api/history`, `/status`, WebSocket broadcasting, Mongoose models, and SHA-256 data hashing.
- **Stage 5:** Python Flask REST API integrating TensorFlow for Deep Learning anomaly detection.
- The default `ai_engine/app.py` launcher now starts the complete `Python/ai_engine.py` service at `/ai/analyze`, including rules, Isolation Forest, and CNN-LSTM ECG analysis.
- The backend carries the latest ECG packet into the next vitals analysis so the ECG model participates in the live pipeline.
- Backend secrets and database/service URLs are configured through `backend/.env`; never commit the `.env` file.
- **Stage 6 & 7:** React responsive dashboard with live ECG plots, dynamic vitals UI, authenticated WebSocket alerts, and AI explanations.
- The dashboard consumes `init`, `ecg`, `vitals`, `ai_result`, and `alert` WebSocket events.
- **Stage 8 & 9:** API key verification, invalid-key security events, bcrypt-backed user login, 8-hour JWTs, and role checks. Data is hashed upon ingest to support audit logs.
