const mongoose = require('mongoose');

const AreaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  devices: [{
    type: String,  // deviceId
    ref: 'Device'
  }],
  plants: [{
    name: {
      type: String,
      required: true
    },
    type: {
      type: String
    },
    moistureThreshold: {
      min: {
        type: Number,
        default: 30
      },
      max: {
        type: Number,
        default: 70
      }
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Area', AreaSchema);