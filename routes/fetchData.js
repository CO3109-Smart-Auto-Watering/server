const express = require('express');
const router = express.Router();
const { authenticate } = require('../controllers/authController');
const { 
  fetchDataFromAdafruit,
  getLatestData,
  sendCommand,
  getHistoricalData
} = require('../controllers/fetchDataController');

router.use(authenticate);

// Route to manually trigger data fetch from Adafruit
router.get('/fetch', fetchDataFromAdafruit);

// Route to get latest data from our database
router.get('/latest', getLatestData);

// Route to send commands to Adafruit
router.post('/command', sendCommand);

// Route to get historical data for a specific feed
router.get('/history/:feedName', getHistoricalData);

module.exports = router;