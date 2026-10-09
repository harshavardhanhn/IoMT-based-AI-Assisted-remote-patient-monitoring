const mongoose = require('mongoose');

const vitalSchema = new mongoose.Schema({
  pid: { type: String, required: true },
  device: { type: String, required: true },
  timestamp: { type: Date, required: true },
  temperature: { type: Number },
  heart_rate: { type: Number },
  spo2: { type: Number },
  systolic: { type: Number },
  diastolic: { type: Number },
  finger_on: { type: Boolean },
  leads_off: { type: Boolean, default: false },
  riskTier: { type: String, enum: ['BASELINE', 'WARNING', 'CRITICAL'], default: 'BASELINE' },
  alerts: { type: [mongoose.Schema.Types.Mixed], default: [] },
  hash: { type: String, required: true }
});

vitalSchema.index({ pid: 1, timestamp: -1 });

module.exports = mongoose.model('Vital', vitalSchema);
