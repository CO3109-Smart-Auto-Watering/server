const express = require('express');
const router = express.Router();
const { authenticate } = require('../controllers/authController');
const { getUsers, getUserById, updateUser, deleteUser } = require('../controllers/userController');

// Các endpoint cần xác thực
router.use(authenticate);


router.get('/', getUsers);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;