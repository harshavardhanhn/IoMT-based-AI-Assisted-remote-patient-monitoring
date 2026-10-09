const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const Vital = require('./models/Vital');
const Ecg = require('./models/Ecg');
const Alert = require('./models/Alert');
const User = require('./models/User');

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://127.0.0.1:5000/ai/analyze';

// Call the Python AI engine (non-blocking — won't crash /vitals if Flask is down)
async function callAiEngine(payload) {
  try {
    const res = await fetch(AI_ENGINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`AI engine HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[AI Engine] Unavailable:', err.message);
    return null;
  }
}

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = process.env.JWT_SECRET || 'development-only-jwt-secret';
const API_KEY = process.env.DEVICE_API_KEY || 'iomt-secret-key-2024';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/secureiomt';
const latestEcgByPatient = new Map();
const packetCounts = { ecg: 0, vitals: 0 };

// MongoDB connection
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('MongoDB Connected');
    const username = process.env.DEFAULT_DOCTOR_USERNAME || 'doctor';
    const password = process.env.DEFAULT_DOCTOR_PASSWORD || 'password';
    if (!(await User.exists({ username }))) {
      const passwordHash = await bcrypt.hash(password, 12);
      await User.create({ username, hashed_password: passwordHash, passwordHash, role: 'doctor' });
      console.log(`Created default user '${username}'. Change DEFAULT_DOCTOR_PASSWORD in production.`);
    }
  })
  .catch(err => console.log('MongoDB connection error. Make sure mongod is running.', err.message));

// WebSocket broadcast helper
function broadcast(type, payload) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, payload }));
    }
  });
}

function verifyWebSocketToken(request) {
  const token = new URL(request.url, 'http://localhost').searchParams.get('token');
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function parseTimestamp(value) {
  const date = new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTelemetry(body, type) {
  const normalized = {
    pid: body.pid,
    device: body.device || body.dev,
    timestamp: parseTimestamp(body.timestamp ?? body.ts),
    leads_off: body.leads_off ?? body.lo ?? false
  };
  if (type === 'ecg') normalized.ecg_samples = body.ecg_samples || body.ecg;
  if (type === 'vitals') {
    Object.assign(normalized, {
      temperature: Number(body.temperature),
      heart_rate: Number(body.heart_rate),
      spo2: Number(body.spo2),
      systolic: Number(body.systolic ?? 120),
      diastolic: Number(body.diastolic ?? 80),
      finger_on: body.finger_on
    });
  }
  return normalized;
}

wss.on('connection', async (ws, request) => {
  const user = verifyWebSocketToken(request);
  if (!user || !['doctor', 'nurse', 'admin'].includes(user.role)) {
    ws.close(1008, 'Authentication required');
    return;
  }
  console.log('Client connected to WebSocket');

  // Send latest state on init
  try {
    const latestVitals = await Vital.findOne().sort({ timestamp: -1 });
    const latestEcg = await Ecg.findOne().sort({ timestamp: -1 }).lean();
    const recentAlerts = await Alert.find().sort({ timestamp: -1 }).limit(10);

    ws.send(JSON.stringify({
      type: 'init',
      payload: {
        vitals: latestVitals,
        ecg: latestEcg ? { samples: latestEcg.ecg_samples, leadsOff: latestEcg.leads_off, time: latestEcg.timestamp } : [],
        alerts: recentAlerts
      }
    }));
  } catch (err) {
    console.error('Error fetching init data', err);
  }

  ws.on('close', () => console.log('Client disconnected'));
});

// Middlewares
function verifyApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    mongoose.connection.db?.collection('security_events').insertOne({
      time: new Date(), type: 'invalid_api_key', ip: req.ip, path: req.path,
      keyUsed: key || null
    }).catch(() => {});
    return res.status(401).json({ error: 'Unauthorized device' });
  }
  next();
}

function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(403).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    req.user = decoded;
    next();
  });
}

function authorize(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Compute hash for data integrity
function computeHash(dataObj) {
  const str = JSON.stringify(dataObj);
  return crypto.createHash('sha256').update(str).digest('hex');
}

function validateTelemetry(body, type) {
  const data = normalizeTelemetry(body, type);
  const required = ['pid', 'device', 'timestamp'];
  if (type === 'vitals') required.push('heart_rate', 'spo2', 'temperature', 'systolic', 'diastolic');
  if (type === 'ecg') required.push('ecg_samples');
  const missing = required.filter((field) => data[field] === undefined || data[field] === null || Number.isNaN(data[field]));
  if (missing.length) return `Missing fields: ${missing.join(', ')}`;
  if (type === 'ecg' && (!Array.isArray(data.ecg_samples) || data.ecg_samples.length === 0)) {
    return 'ecg_samples must be a non-empty array';
  }
  return null;
}

// Routes
async function handleEcg(req, res) {
  try {
    const validationError = validateTelemetry(req.body, 'ecg');
    if (validationError) return res.status(400).json({ error: validationError });
    const { pid, device, timestamp, ecg_samples, leads_off } = normalizeTelemetry(req.body, 'ecg');

    const hashData = { pid, device, timestamp, ecg_samples };
    const hash = computeHash(hashData);

    const ecgDoc = new Ecg({ pid, device, timestamp, ecg_samples, leads_off, hash });
    latestEcgByPatient.set(pid, ecg_samples || []);
    await ecgDoc.save();
    packetCounts.ecg += 1;

    broadcast('ecg', { samples: ecg_samples, leadsOff: leads_off, time: timestamp, hash });
    res.status(200).json({ status: 'ok', success: true, hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function handleVitals(req, res) {
  try {
    const validationError = validateTelemetry(req.body, 'vitals');
    if (validationError) return res.status(400).json({ error: validationError });
    const { pid, device, timestamp, temperature, heart_rate, spo2, systolic, diastolic, leads_off, finger_on } = normalizeTelemetry(req.body, 'vitals');

    const hashData = { pid, device, timestamp, temperature, heart_rate, spo2, systolic, diastolic };
    const hash = computeHash(hashData);

    const vitalDoc = new Vital({ pid, device, timestamp, temperature, heart_rate, spo2, systolic, diastolic, leads_off, finger_on, hash });
    await vitalDoc.save();
    packetCounts.vitals += 1;

    const ruleRisk = getRuleRisk({ heart_rate, spo2, temperature, systolic });
    const vitalPayload = { pid, device, timestamp, temperature, heart_rate, spo2, systolic, diastolic, finger_on, leads_off, riskTier: ruleRisk.riskTier, alerts: ruleRisk.alerts, hash };
    broadcast('vitals', vitalPayload);

    res.status(200).json({ status: 'ok', success: true, riskTier: ruleRisk.riskTier, alerts: ruleRisk.alerts, hash });

    // ── Call Python AI Engine (async, after response sent) ──────────────────
    const aiPayload = {
      pid, timestamp, heart_rate, spo2,
      temperature, systolic, diastolic,
      ecg: req.body.ecg || req.body.ecg_samples || latestEcgByPatient.get(pid) || []
    };

    const aiResult = await callAiEngine(aiPayload);

    if (aiResult) {
      // Broadcast real AI result to all dashboard clients
      broadcast('ai_result', aiResult);

      // Save to MongoDB ai_results collection (schema-free insert)
      await mongoose.connection.db.collection('ai_results').insertOne({
        pid, timestamp: aiResult.timestamp || timestamp, riskTier: aiResult.risk || 'NORMAL',
        conditions: aiResult.conditions || [], confidence: aiResult.confidence || 0,
        recommendation: aiResult.recommendation || '', ecg_class: aiResult.ecg_class || 'No Signal',
        qsofa_score: aiResult.qsofa_score || 0, anomaly_score: aiResult.anomaly_score || 0,
        explanation: aiResult.explanation || {}, ...aiResult, createdAt: new Date()
      });

      // Create alert if CRITICAL or WARNING
      if (aiResult.risk === 'CRITICAL' || aiResult.risk === 'WARNING') {
        const alertDoc = new Alert({
          pid,
          timestamp: timestamp || new Date(),
          type: aiResult.risk,
          severity: aiResult.risk,
          param: aiResult.conditions?.[0] || 'clinical_risk',
          message: aiResult.conditions?.join(', ') || aiResult.risk,
          vitals: vitalPayload
        });
        await alertDoc.save();
        broadcast('alert', alertDoc);
      }
    }
  } catch (err) {
    console.error(err);
    // res already sent above, just log
  }
}

function getRuleRisk(vitals) {
  const alerts = [];
  const add = (severity, param, message) => alerts.push({ severity, param, message });
  if (vitals.heart_rate > 150 || vitals.heart_rate < 40) add('CRITICAL', 'heart_rate', 'Heart rate outside critical range');
  else if (vitals.heart_rate > 100 || vitals.heart_rate < 60) add('WARNING', 'heart_rate', 'Heart rate outside normal range');
  if (vitals.spo2 < 90) add('CRITICAL', 'spo2', 'Low oxygen saturation');
  else if (vitals.spo2 < 95) add('WARNING', 'spo2', 'Reduced oxygen saturation');
  if (vitals.temperature > 39.5 || vitals.temperature < 35) add('CRITICAL', 'temperature', 'Temperature in critical range');
  else if (vitals.temperature > 38) add('WARNING', 'temperature', 'Fever detected');
  if (vitals.systolic > 180 || vitals.systolic < 90) add('CRITICAL', 'systolic', 'Systolic pressure in critical range');
  else if (vitals.systolic > 140) add('WARNING', 'systolic', 'Elevated systolic pressure');
  if (vitals.spo2 < 94 && vitals.heart_rate > 100) add('CRITICAL', 'respiratory_distress', 'Respiratory distress pattern');
  const riskTier = alerts.some((alert) => alert.severity === 'CRITICAL') ? 'CRITICAL' : alerts.length ? 'WARNING' : 'BASELINE';
  return { riskTier, alerts };
}

app.post(['/ecg', '/api/ecg'], verifyApiKey, handleEcg);
app.post(['/vitals', '/api/vitals'], verifyApiKey, handleVitals);

app.get(['/api/latest', '/latest'], verifyToken, authorize(['doctor', 'nurse', 'admin']), async (req, res) => {
  try {
    const vitals = await Vital.findOne().sort({ timestamp: -1 });
    const alerts = await Alert.find().sort({ timestamp: -1 }).limit(20);
    const ecg = await Ecg.find().sort({ timestamp: -1 }).limit(50).lean();
    res.json({ vitals, ecg: ecg.flatMap((record) => record.ecg_samples).slice(-900), alerts });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/history', verifyToken, authorize(['doctor', 'nurse', 'admin']), async (req, res) => {
  try {
    res.json(await Vital.find().sort({ timestamp: -1 }).limit(60).lean());
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/status', async (req, res) => {
  res.json({ status: 'ok', mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', packetCount: packetCounts, connectedClients: wss.clients.size });
});

app.get('/api/patients', verifyToken, authorize(['doctor', 'nurse', 'admin']), async (req, res) => {
  try {
    const latestVitals = await Vital.aggregate([
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$pid', latest: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$latest' } },
      { $sort: { pid: 1 } }
    ]);
    const latestAlerts = await Alert.find().sort({ timestamp: -1 }).limit(100).lean();
    const alertsByPatient = latestAlerts.reduce((groups, alert) => {
      (groups[alert.pid] ||= []).push(alert);
      return groups;
    }, {});
    res.json({ patients: latestVitals, alerts: alertsByPatient });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const user = await User.findOne({ username }).lean();
    const passwordHash = user?.passwordHash || user?.hashed_password;
    const valid = passwordHash && await bcrypt.compare(password, passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, role: user.role, expiresIn: '8h' });
  } catch (err) {
    res.status(503).json({ error: 'Authentication service unavailable' });
  }
}

app.post(['/login', '/api/login'], login);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
