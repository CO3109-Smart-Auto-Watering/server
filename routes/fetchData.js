const express = require('express');
const router = express.Router();
const { authenticate } = require('../controllers/authController');
const { 
  fetchDataFromAdafruit,
  getLatestData,
  sendCommand,
  getHistoricalData,
  getSingleFeedData,
  getDeviceFeedValue,
  setActiveDevice
} = require('../controllers/fetchDataController');

router.use(authenticate);

// ----- ROUTES CHUNG CHO TẤT CẢ THIẾT BỊ -----

// Route để thiết lập thiết bị đang hoạt động
router.post('/set-active-device', setActiveDevice);

// Route để lấy dữ liệu mới nhất
router.get('/latest', getLatestData);

// Route để lấy dữ liệu theo feed
router.get('/feed/:feedName', getSingleFeedData);

// Route để lấy lịch sử của feed
router.get('/history/:feedName', getHistoricalData);

// Route để gửi lệnh điều khiển
router.post('/command', sendCommand);

// Route để kích hoạt tải dữ liệu từ Adafruit
router.get('/fetch', fetchDataFromAdafruit);

// --- THÊM ROUTES MỚI HỖ TRỢ DEVICEID ---


// Route để lấy dữ liệu mới nhất cho thiết bị cụ thể
router.get('/:deviceId/latest', getLatestData);

// Route để gửi lệnh điều khiển cho thiết bị cụ thể
router.post('/:deviceId/command', sendCommand);

// Route để lấy lịch sử dữ liệu cho feed và thiết bị cụ thể
router.get('/:deviceId/history/:feedName', getHistoricalData);


// Route để lấy dữ liệu feed đơn cho thiết bị cụ thể
router.get('/:deviceId/feed/:feedName', getDeviceFeedValue);





module.exports = router;