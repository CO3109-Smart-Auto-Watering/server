const express = require("express");
const router = express.Router();
const { authenticate } = require("../controllers/authController");
const { getAverageSoilMoisture } = require("../controllers/averageController");

// Tất cả routes yêu cầu xác thực
router.use(authenticate);

// Route: GET /api/soil/average?deviceId=...&days=...
router.get("/", getAverageSoilMoisture);

module.exports = router;
