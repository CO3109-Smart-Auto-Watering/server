const express = require("express");
const { getAllUsers } = require("../controllers/userController");
const { protect, adminOnly } = require("../middlewares/authMiddleware");

const router = express.Router();

router.get("/", protect, adminOnly, getAllUsers);

module.exports = router;
