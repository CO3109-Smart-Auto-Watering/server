const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name:{
    type: String,
    required: false,
    trim: true
  },
  phone: {
    type: String,
    required: false,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  avatar:{
    type: String,
    required: false,
    default: 'https://res.cloudinary.com/dqj0xg3zv/image/upload/v1698236482/avatars/default-avatar.png'
  },
  preferences: {
    notifyWatering:{
      type: Boolean,
      default: true
    },
    notifySystem:{
      type: Boolean,
      default: true
    },
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  activeDeviceId: {
     type: String, 
     default: null 
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Mã hóa mật khẩu trước khi lưu
userSchema.pre('save', async function(next) {
  // Chỉ hash mật khẩu khi nó được thay đổi hoặc là mới
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    // Tạo salt
    const salt = await bcrypt.genSalt(10);
    
    // Hash mật khẩu với salt
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Phương thức so sánh mật khẩu - thêm kiểm tra phòng trường hợp mật khẩu không tồn tại
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    // Kiểm tra xem mật khẩu có tồn tại không
    if (!this.password) {
      console.error('User has no password set:', this.username);
      return false;
    }
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    console.error('Password comparison error:', error);
    throw error;
  }
};

const User = mongoose.model('User', userSchema);

module.exports = User;