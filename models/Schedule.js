const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  // User ID to associate the schedule with a specific user
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Schedule name
  name: {
    type: String,
    required: true,
    trim: true
  },
  // Schedule type: 'recurring' (weekly) or 'onetime' (specific date)
  scheduleType: {
    type: String,
    enum: ['recurring', 'onetime'],
    default: 'onetime'
  },
  // For one-time schedules (specific date)
  scheduledDateTime: {
    type: Date,
    required: function() {
      return this.scheduleType === 'onetime';
    }
  },
  // For recurring schedules
  startTime: {
    type: String,  // Format: "HH:MM" in 24-hour format
    required: function() {
      return this.scheduleType === 'recurring';
    }
  },
  daysOfWeek: {
    type: [Number],  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    default: [],
    required: function() {
      return this.scheduleType === 'recurring';
    }
  },
  // Common fields
  duration: {
    type: Number,  // Duration in minutes
    required: true,
    min: 1,
    max: 120  // Maximum 2 hours
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  // Device and plant fields
  deviceId: {
    type: String,
    required: true,
    ref: 'Device'
  },
  areaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Area'
  },
  plantIndex: {
    type: Number,
    default: -1  // -1 means entire area, >=0 means specific plant
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Auto-update the updatedAt field on save
scheduleSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Schedule = mongoose.model('Schedule', scheduleSchema);

module.exports = Schedule;