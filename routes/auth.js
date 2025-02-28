const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

// Middleware for protected routes
const authenticate = (req, res, next) => {
  const token = req.header('x-auth-token');
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Không có token, quyền truy cập bị từ chối' 
    });
  }
  
  try {
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'your_jwt_secret'
    );
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Token không hợp lệ' 
    });
  }
};

// Login route
router.post('/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;

    // Validate request
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tên đăng nhập và mật khẩu là bắt buộc' 
      });
    }

    // Find user by username and role
    const user = await User.findOne({ username, role });
    
    // If user not found
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Tên đăng nhập hoặc mật khẩu không đúng' 
      });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Tên đăng nhập hoặc mật khẩu không đúng' 
      });
    }

    // Create JWT token
    const token = jwt.sign(
      { 
        id: user._id, 
        username: user.username, 
        role: user.role 
      }, 
      process.env.JWT_SECRET || 'your_jwt_secret', 
      { expiresIn: '1d' }
    );

    // Send response
    res.status(200).json({
      success: true,
      message: 'Đăng nhập thành công',
      token,
      user: {
        id: user._id,
        username: user.username,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Đã xảy ra lỗi khi đăng nhập', 
      error: error.message 
    });
  }
});

// Register route
router.post('/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tên đăng nhập đã tồn tại' 
      });
    }

    // Create new user
    const newUser = new User({
      username,
      password,
      role: role || 'user'
    });

    await newUser.save();

    // Create token for auto login
    const token = jwt.sign(
      { 
        id: newUser._id, 
        username: newUser.username, 
        role: newUser.role 
      }, 
      process.env.JWT_SECRET || 'your_jwt_secret', 
      { expiresIn: '1d' }
    );

    res.status(201).json({
      success: true,
      message: 'Đăng ký thành công',
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        role: newUser.role
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Đã xảy ra lỗi khi đăng ký', 
      error: error.message 
    });
  }
});

// Forgot password route
router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;
    
    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Không tìm thấy tài khoản với tên đăng nhập này' 
      });
    }
    
    // Generate password reset token
    const resetToken = jwt.sign(
      { id: user._id }, 
      process.env.JWT_SECRET || 'your_jwt_secret', 
      { expiresIn: '15m' }
    );
    
    // In a real app, you would send an email with a reset link
    // Here we're just returning the token for demonstration
    res.status(200).json({
      success: true,
      message: 'Vui lòng kiểm tra email để đặt lại mật khẩu',
      resetToken
    });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Đã xảy ra lỗi khi xử lý yêu cầu', 
      error: error.message 
    });
  }
});

// Reset password route
router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    
    // Verify token
    const decoded = jwt.verify(
      resetToken, 
      process.env.JWT_SECRET || 'your_jwt_secret'
    );
    
    // Find user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Người dùng không tồn tại hoặc token không hợp lệ' 
      });
    }
    
    // Update password
    user.password = newPassword; // This will be hashed by the pre-save hook
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Mật khẩu đã được đặt lại thành công'
    });
    
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Đã xảy ra lỗi khi đặt lại mật khẩu', 
      error: error.message 
    });
  }
});

// Get current user route
router.get('/user', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json({ 
      success: true,
      user 
    });
  } catch (error) {
    console.error('User fetch error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server', 
      error: error.message 
    });
  }
});

module.exports = router;