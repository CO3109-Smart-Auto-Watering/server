const express = require('express');
const router = express.Router();
const { 
  createArea, 
  getAreas, 
  getAreaById, 
  updateArea, 
  deleteArea, 
  addPlantToArea,
  updatePlantInArea,
  deletePlantFromArea,
  updateDeviceInArea
} = require('../controllers/areaController');
const { authenticate } = require("../controllers/authController");

// Tất cả routes đều yêu cầu xác thực
router.use(authenticate);

// Tạo khu vực mới
router.post('/', createArea);

// Lấy tất cả khu vực của user
router.get('/', getAreas);

// Lấy khu vực theo ID
router.get('/:areaId', getAreaById);

// Cập nhật khu vực
router.put('/:areaId', updateArea);

// Xóa khu vực
router.delete('/:areaId', deleteArea);

// Thêm cây trồng vào khu vực
router.post('/:areaId/plants', addPlantToArea);

// Cập nhật cây trồng trong khu vực
router.put('/:areaId/plants/:plantIndex', updatePlantInArea);

// Xóa cây trồng khỏi khu vực
router.delete('/:areaId/plants/:plantIndex', deletePlantFromArea);

// Cập nhật thiết bị trong khu vực
router.put('/:areaId/devices', updateDeviceInArea);

module.exports = router;