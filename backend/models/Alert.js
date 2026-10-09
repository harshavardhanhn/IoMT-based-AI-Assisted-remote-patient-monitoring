const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  pid: { type: String, required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  type: { type: String, enum: ['WARNING', 'CRITICAL'], required: true },
  severity: { type: String, enum: ['WARNING', 'CRITICAL'] },
  param: { type: String },
  message: { type: String, required: true },
  vitals: { type: Object }
});

alertSchema.index({ pid: 1, timestamp: -1 });

module.exports = mongoose.model('Alert', alertSchema);
