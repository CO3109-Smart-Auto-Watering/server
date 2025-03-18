const mongoose = require("mongoose");

const pumpSchema = new mongoose.Schema({
  name: { type: String},
  status: { type: String, enum: ["ON", "OFF"], required: true },
  updatedAt: { type: Date, default: Date.now }
});

// 📌 Factory function để tạo collection dựa trên tên máy bơm
const getPumpModel = (pumpName) => {
  return mongoose.models[pumpName] || mongoose.model(pumpName, pumpSchema, pumpName);
};

module.exports = getPumpModel;
