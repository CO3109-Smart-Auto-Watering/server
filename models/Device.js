const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  deviceId: {
    type: String,
    required: true,
  },
  deviceName: {
    type: String,
    required: true
  },
  // Thêm thông tin về khu vực và cây trồng
  areaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Area',
    default: null
  },
  // Liên kết với cây trồng cụ thể trong khu vực
  plantIndex: {
    type: Number,
    default: -1  // -1 = chưa liên kết với cây nào
  },
  feeds: [{
    type: String
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
});

DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
DeviceSchema.index({ userId: 1, deviceName: 1 }, { unique: true });

module.exports = mongoose.model('Device', DeviceSchema);