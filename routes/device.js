const express = require('express');
const router = express.Router();
const { 
  registerDevice, 
  getUserDevices, 
  getDeviceById, 
  updateDevice, 
  deleteDevice, 
  toggleDeviceStatus,
  linkDeviceToPlant,
  getDeviceData,
  processDeviceData,
  getDevicesByArea,
  getUnassignedDevices
} = require('../controllers/deviceController');
const { authenticate } = require('../controllers/authController');

// Routes yêu cầu xác thực người dùng
router.use(authenticate);
router.post('/register', registerDevice);
router.get('/', getUserDevices);
router.get('/:deviceId', getDeviceById);
router.put('/:deviceId', updateDevice);
router.delete('/:deviceId', deleteDevice);
router.put('/:deviceId/toggle', toggleDeviceStatus);
router.patch('/:deviceId/toggle', toggleDeviceStatus);
router.post('/:deviceId/link-plant', linkDeviceToPlant);
router.get('/:deviceId/data', getDeviceData);
router.get('/area/:areaId', getDevicesByArea);
router.get('/unassigned', getUnassignedDevices);


// Tạo route riêng cho processDeviceData không yêu cầu xác thực
// (phải đặt bên ngoài middleware authenticate)
module.exports = router;

// Tạo riêng route cho IoT, không yêu cầu xác thực
const createIoTRoutes = () => {
  const iotRouter = express.Router();
  iotRouter.post('/process-data', processDeviceData);
  return iotRouter;
};

module.exports.deviceRoutes = router;
module.exports.iotRoutes = createIoTRoutes();