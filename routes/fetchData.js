const express = require('express');
const router = express.Router();
const { authenticate } = require('../controllers/authController');
const { 
  fetchDataFromAdafruit,
  getLatestData,
  sendCommand,
  getHistoricalData,
  getSingleFeedData
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

// Route to get data for a specific feed
router.get('/feed/:feedName', getSingleFeedData);

// --- THÊM ROUTES MỚI HỖ TRỢ DEVICEID ---

// Route để lấy dữ liệu mới nhất cho thiết bị cụ thể
router.get('/:deviceId/latest', getLatestData);

// Route để gửi lệnh điều khiển cho thiết bị cụ thể
router.post('/command/:deviceId', sendCommand);

// Route để lấy dữ liệu lịch sử cho feed của thiết bị cụ thể
router.get('/:deviceId/history/:feedName', getHistoricalData);

// Route để lấy dữ liệu feed đơn cho thiết bị cụ thể
router.get('/:deviceId/feed/:feedName', getSingleFeedData);

module.exports = router;