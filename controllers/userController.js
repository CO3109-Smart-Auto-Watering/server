const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');

/**
 * Lấy danh sách tất cả người dùng
 * @route GET /api/users
 * @access Admin
 */
const getUsers = async (req, res) => {
  try {
    // Chỉ admin mới có thể xem danh sách tất cả users
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Không có quyền truy cập' });
    }

    // Tìm tất cả người dùng, không bao gồm mật khẩu
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

/**
 * Lấy thông tin người dùng theo ID
 * @route GET /api/users/:id
 * @access Admin hoặc User (nếu là chính họ)
 */
const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Kiểm tra quyền truy cập: admin hoặc chính người dùng đó
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({ message: 'Không có quyền truy cập' });
    }

    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error getting user by ID:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

/**
 * Cập nhật thông tin người dùng
 * @route PUT /api/users/:id
 * @access Admin hoặc User (nếu là chính họ)
 */
const updateUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.params.id;
    
    // Kiểm tra quyền: admin hoặc chính người dùng đó
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({ message: 'Không có quyền cập nhật thông tin này' });
    }

    const { name, email, password, phone, address, role } = req.body;
    
    // Tìm người dùng cần cập nhật
    let user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    // Xây dựng đối tượng cập nhật
    const updateFields = {};
    
    if (name) updateFields.name = name;
    if (email) updateFields.email = email;
    if (phone) updateFields.phone = phone;
    if (address) updateFields.address = address;
    
    // Chỉ admin mới được cập nhật role
    if (role && req.user.role === 'admin') {
      updateFields.role = role;
    }
    
    // Nếu cập nhật mật khẩu
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(password, salt);
    }

    // Cập nhật người dùng
    user = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

/**
 * Xóa người dùng
 * @route DELETE /api/users/:id
 * @access Admin
 */
const deleteUser = async (req, res) => {
  try {
    // Chỉ admin mới có thể xóa người dùng
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Không có quyền xóa người dùng' });
    }

    const userId = req.params.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }
    
    // Thực hiện xóa
    await User.findByIdAndDelete(userId);
    
    res.json({ message: 'Đã xóa người dùng thành công' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};


// Export tất cả các function
module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser
};