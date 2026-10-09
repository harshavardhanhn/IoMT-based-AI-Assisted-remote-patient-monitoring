import { useEffect, useState } from 'react';
import { Activity, Bell, BrainCircuit, LogOut, ShieldCheck, Thermometer, Wifi, WifiOff } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://localhost:3000';
const ECG_LENGTH = 900;
const emptyVitals = { heart_rate: null, spo2: null, temperature: null, systolic: null, diastolic: null };

function gaussian(position, center, width, amplitude) {
  return amplitude * Math.exp(-((position - center) ** 2) / (2 * width ** 2));
}

function createDemoEcg(length = ECG_LENGTH) {
  const samplesPerBeat = Math.round((60 / 72) * 360);
  return Array.from({ length }, (_, index) => {
    const phase = (index % samplesPerBeat) / samplesPerBeat;
    const value = 2048
      + gaussian(phase, 0.18, 0.025, 130)
      - gaussian(phase, 0.285, 0.009, 180)
      + gaussian(phase, 0.31, 0.006, 1050)
      - gaussian(phase, 0.34, 0.012, 300)
      + gaussian(phase, 0.55, 0.065, 280);
    return { index, value: Math.round(value) };
  });
}

function hasClinicalMorphology(samples) {
  if (samples.length < 60) return false;
  const values = samples.map((sample) => Number(sample.value));
  return Math.max(...values) - Math.min(...values) > 180;
}

function formatValue(value, suffix = '') {
  return value === null || value === undefined ? '--' : `${value}${suffix}`;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('doctor');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to sign in');
      localStorage.setItem('iomt_token', result.token);
      onLogin(result.token);
    } catch (loginError) { setError(loginError.message); }
  };
  return <main className="login-shell"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark"><Activity size={20} /> PULSEGRID</div>
    <p className="kicker">SECURE CLINICAL ACCESS</p><h1>Patient telemetry, made legible.</h1>
    <p className="muted">Sign in to view protected bedside data and AI clinical analysis.</p>
    <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
    <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
    <button className="primary-button" type="submit">Open monitor</button>
    <p className="error-text">{error}</p>
  </form></main>;
}

function VitalCard({ label, value, unit, icon: Icon, tone }) {
  return <article className={`vital-card ${tone || ''}`}><div className="card-label"><span>{label}</span><Icon size={17} /></div><strong>{formatValue(value, unit)}</strong><span className="card-foot">LIVE SENSOR FEED</span></article>;
}

function RiskPanel({ result }) {
  if (!result) return <section className="panel ai-panel waiting"><div className="panel-heading"><span><BrainCircuit size={18} /> AI clinical engine</span><span className="status-badge neutral">STANDBY</span></div><p className="muted">Waiting for the first synchronized vital and ECG packet.</p></section>;
  return <section className="panel ai-panel"><div className="panel-heading"><span><BrainCircuit size={18} /> AI clinical engine</span><span className={`status-badge ${result.risk?.toLowerCase()}`}>{result.risk}</span></div><div className="risk-summary"><div><span className="metric-label">Confidence</span><strong>{Math.round((result.confidence || 0) * 100)}%</strong></div><div><span className="metric-label">ECG class</span><strong>{result.ecg_class || 'No signal'}</strong></div><div><span className="metric-label">qSOFA</span><strong>{result.qsofa_score ?? 0}/2</strong></div></div><div className="conditions">{(result.conditions || []).map((condition) => <span key={condition}>{condition}</span>)}</div><p className="recommendation">{result.recommendation}</p><div className="explanations">{Object.entries(result.explanation_pct || {}).sort((a, b) => b[1] - a[1]).map(([name, percentage]) => <div className="explanation-row" key={name}><span>{name.replaceAll('_', ' ')}</span><div><i style={{ width: `${percentage}%` }} /></div><b>{percentage}%</b></div>)}</div><p className="ai-meta">{result.ml_status || 'Model ready'} {result.inference_ms ? ` / ${result.inference_ms} ms` : ''}</p></section>;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('iomt_token'));
  const [connected, setConnected] = useState(false);
  const [vitals, setVitals] = useState(emptyVitals);
  const [ecg, setEcg] = useState(() => createDemoEcg());
  const [alerts, setAlerts] = useState([]);
  const [aiResult, setAiResult] = useState(null);
  const [patient, setPatient] = useState('P001');

  useEffect(() => {
    if (!token) return undefined;
    let socket;
    let retry;
    const connect = () => {
      socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
      socket.onopen = () => setConnected(true);
      socket.onclose = () => { setConnected(false); retry = setTimeout(connect, 3000); };
      socket.onerror = () => socket.close();
      socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.type === 'init') {
          if (message.payload.vitals) { setVitals(message.payload.vitals); setPatient(message.payload.vitals.pid || 'P001'); }
          const initialSamples = Array.isArray(message.payload.ecg) ? message.payload.ecg : message.payload.ecg?.samples;
          if (initialSamples?.length) setEcg(initialSamples.map((value, index) => ({ index, value })));
          if (message.payload.alerts) setAlerts(message.payload.alerts);
        }
        if (message.type === 'vitals') {
          setVitals(message.payload);
          setPatient(message.payload.pid || 'P001');
          if (message.payload.riskTier === 'BASELINE') {
            setAlerts([]);
            setAiResult(null);
          }
        }
        if (message.type === 'ecg') {
          const samples = message.payload.samples || message.payload.ecg_samples || [];
          setEcg((current) => [...current, ...samples.map((value, index) => ({ index: current.length + index, value }))].slice(-ECG_LENGTH));
        }
        if (message.type === 'ai_result') setAiResult(message.payload);
        if (message.type === 'alert') setAlerts((current) => [message.payload, ...current].slice(0, 20));
      };
    };
    connect();
    return () => { clearTimeout(retry); socket?.close(); };
  }, [token]);

  if (!token) return <Login onLogin={setToken} />;
  const signOut = () => { localStorage.removeItem('iomt_token'); setToken(null); };
  const clearView = () => {
    setVitals(emptyVitals);
    setEcg([]);
    setAlerts([]);
    setAiResult(null);
    setPatient('P001');
  };
  const liveEcg = hasClinicalMorphology(ecg) ? ecg : createDemoEcg();
  const isDemoWaveform = liveEcg !== ecg;
  return <main className="app-shell"><header className="topbar"><div><div className="brand-mark"><Activity size={20} /> PULSEGRID <span>/ ICU TELEMETRY</span></div><p className="date-line">Bedside command view <span>·</span> {new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p></div><div className="top-actions"><div className={`connection ${connected ? 'online' : ''}`}>{connected ? <Wifi size={16} /> : <WifiOff size={16} />} {connected ? 'Live stream' : 'Reconnecting'}</div><button className="icon-button" onClick={signOut} title="Sign out"><LogOut size={17} /></button></div></header><section className="hero-row"><div><p className="kicker">PATIENT OVERVIEW</p><h1>One patient. Every signal.</h1><p className="muted">Continuous monitoring from bedside sensors, with deep-learning support for early deterioration.</p></div><div className="patient-chip"><span className="pulse-dot" /> <div><b>{patient}</b><small>ESP32-BED-01 / ICU 04</small></div></div></section><section className="vitals-grid"><VitalCard label="Heart rate" value={vitals.heart_rate} unit=" bpm" icon={Activity} tone={vitals.heart_rate > 120 ? 'critical' : ''} /><VitalCard label="Blood oxygen" value={vitals.spo2} unit=" %" icon={ShieldCheck} tone={vitals.spo2 < 90 ? 'critical' : ''} /><VitalCard label="Temperature" value={vitals.temperature?.toFixed?.(1)} unit=" °C" icon={Thermometer} /><VitalCard label="Blood pressure" value={vitals.systolic ? `${vitals.systolic}/${vitals.diastolic}` : null} icon={Activity} /></section><section className="content-grid"><section className="panel ecg-panel"><div className="panel-heading"><span><Activity size={18} /> ECG waveform</span><span className="wave-label">{isDemoWaveform ? 'DEMO PQRST MORPHOLOGY' : 'LIVE 360 Hz ACQUISITION'}</span></div><div className="chart-wrap ecg-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={liveEcg} margin={{ top: 12, right: 18, left: 4, bottom: 8 }}><CartesianGrid stroke="#24534d" strokeDasharray="2 5" vertical horizontal /><XAxis dataKey="index" tick={{ fill: '#72918d', fontSize: 10 }} tickFormatter={(value) => `${(value / 360).toFixed(1)}s`} interval={149} /><YAxis domain={[0, 4095]} ticks={[0, 1024, 2048, 3072, 4095]} tick={{ fill: '#72918d', fontSize: 10 }} width={38} /><ReferenceLine y={2048} stroke="#4c8177" strokeDasharray="4 5" /><Tooltip content={() => null} /><Line type="monotone" dataKey="value" stroke="#63e0c2" strokeWidth={2.2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div><div className="ecg-caption"><span><i className="signal-key" /> {isDemoWaveform ? 'Representative PQRST display while test input is low-amplitude' : 'Incoming sensor signal'}</span><span>0–4095 ADC</span></div></section><section className="panel alerts-panel"><div className="panel-heading"><span><Bell size={18} /> Alert stream</span><span className="count-badge">{alerts.length}</span></div><div className="alert-list">{alerts.length ? alerts.slice(0, 6).map((alert, index) => <div className="alert-item" key={alert._id || `${alert.timestamp}-${index}`}><span className={`severity ${alert.type?.toLowerCase()}`} /> <div><b>{alert.type}</b><p>{alert.message}</p><small>{new Date(alert.timestamp).toLocaleTimeString()}</small></div></div>) : <p className="muted empty-state">No active alerts.</p>}</div></section></section><RiskPanel result={aiResult} /></main>;
}

export default App;
