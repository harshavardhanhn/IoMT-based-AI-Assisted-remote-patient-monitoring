const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  hashed_password: { type: String, required: true },
  passwordHash: { type: String },
  role: { type: String, enum: ['doctor', 'nurse', 'admin'], required: true }
});

module.exports = mongoose.model('User', userSchema);
