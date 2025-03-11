const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendPasswordResetEmail } = require('../utils/email');
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
    const { username, password, email, role } = req.body;

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
    const { username, password, email, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tên đăng nhập đã tồn tại' 
      });
    }

    // Check if email is provided
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email là bắt buộc'
      });
    }

     // Check if email already exists
     const existingEmail = await User.findOne({ email });
     if (existingEmail) {
       return res.status(400).json({
         success: false,
         message: 'Email đã được sử dụng'
       });
     }
     
    // Create new user
    const newUser = new User({
      username,
      password,
      email,
      role: role || 'user'
    });

    await newUser.save();

    // Create token for auto login
    const token = jwt.sign(
      { 
        id: newUser._id, 
        username: newUser.username,
        email: newUser.email,
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
        email: newUser.email,
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

// ...existing code...

// Forgot password route
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp địa chỉ email'
      });
    }

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Không tìm thấy tài khoản với email này' 
      });
    }
    
    // Generate password reset token
    const resetToken = jwt.sign(
      { id: user._id }, 
      process.env.JWT_SECRET || 'your_jwt_secret', 
      { expiresIn: '15m' }
    );
    
    // Store the token's hash in the database
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    await user.save();
    
    // Send email with password reset link
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;
    
    const emailSent = await sendPasswordResetEmail(user.email, resetUrl, user.username);
    
    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: 'Không thể gửi email đặt lại mật khẩu'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Hướng dẫn đặt lại mật khẩu đã được gửi đến email của bạn'
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

// Validate reset token route
router.get('/reset-password/validate/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Thêm log chi tiết hơn
    console.log('Validating reset token:', token);
    
    try {
      // Verify token
      const decoded = jwt.verify(
        token, 
        process.env.JWT_SECRET || 'your_jwt_secret'
      );
      
      console.log('Token decoded successfully, user ID:', decoded.id);
      
      // Tìm người dùng với token và thời gian hết hạn
      const user = await User.findOne({
        _id: decoded.id,
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() }
      });
      
      console.log('User found:', user ? 'Yes' : 'No');
      
      if (!user) {
        return res.status(400).json({ 
          success: false, 
          message: 'Token không hợp lệ hoặc đã hết hạn' 
        });
      }
      
      res.status(200).json({ 
        success: true,
        message: 'Token hợp lệ' 
      });
    } catch (jwtError) {
      console.error('JWT verification error:', jwtError);
      return res.status(400).json({ 
        success: false, 
        message: 'Token không hợp lệ' 
      });
    }
    
  } catch (error) {
    console.error('Validate token error:', error);
    res.status(400).json({ 
      success: false, 
      message: 'Token không hợp lệ hoặc đã hết hạn' 
    });
  }
});

// Reset password route (updated to use URL params)
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu mới là bắt buộc'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'your_jwt_secret'
    );
    
    // Find user with valid token
    const user = await User.findOne({
      _id: decoded.id,
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token không hợp lệ hoặc đã hết hạn' 
      });
    }
    
    // Update password
    user.password = password; // This will be hashed by the pre-save hook
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
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