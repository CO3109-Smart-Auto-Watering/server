// routes/mode.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../controllers/authController');
const { getModeSummary, getCleanedModeSummary } = require('../controllers/modeController');

router.use(authenticate);
// GET /api/mode/summary?deviceId=...&feedName=mode
router.get('/summary', getModeSummary);
router.get('/summary/cleaned', getCleanedModeSummary);

module.exports = router;