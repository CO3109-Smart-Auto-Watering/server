const express = require('express');
const router = express.Router();
const { 
  login, 
  register, 
  forgotPassword,
  validateResetToken,
  resetPassword,
  getCurrentUser,
  authenticate,
  verifyToken,
  changePassword,
  updateProfile
} = require('../controllers/authController');

// Public routes
router.post('/login', login);
router.post('/register', register);
router.post('/forgot-password', forgotPassword);
router.get('/reset-password/validate/:token', validateResetToken);
router.post('/reset-password/:token', resetPassword);
router.post('/verify', authenticate, verifyToken);
router.get('/me', authenticate, getCurrentUser);
router.put('/change-password', authenticate, changePassword);
router.put('/profile', authenticate, updateProfile); 


module.exports = router;