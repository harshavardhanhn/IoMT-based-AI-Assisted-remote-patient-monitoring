const mongoose = require('mongoose');

const ecgSchema = new mongoose.Schema({
  pid: { type: String, required: true },
  device: { type: String, required: true },
  timestamp: { type: Date, required: true },
  ecg_samples: { type: [Number], required: true },
  samples: { type: [Number] },
  leads_off: { type: Boolean, default: false },
  hash: { type: String, required: true }
});

ecgSchema.index({ pid: 1, timestamp: -1 });

module.exports = mongoose.model('Ecg', ecgSchema, 'ecg');
