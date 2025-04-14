const Area = require('../models/Area');
const Device = require('../models/Device');


// Tạo khu vực mới
exports.createArea = async (req, res) => {
  try {
    const { name, description, devices } = req.body;  // Thêm devices vào đây
    const userId = req.user.id;

    const newArea = new Area({
      userId,
      name,
      description,
      devices: devices || []  // Thêm trường devices
    });

    const area = await newArea.save();

    res.status(201).json({
      success: true,
      message: 'Tạo khu vực thành công',
      area
    });
  } catch (error) {
    console.error('Error creating area:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi tạo khu vực',
      error: error.message
    });
  }
};

// Lấy tất cả khu vực của user
exports.getAreas = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const areas = await Area.find({ userId });
    
    res.status(200).json({
      success: true,
      areas
    });
  } catch (error) {
    console.error('Error fetching areas:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi tải danh sách khu vực',
      error: error.message
    });
  }
};

// Lấy khu vực theo ID
exports.getAreaById = async (req, res) => {
  try {
    const { areaId } = req.params;
    const userId = req.user.id;
    
    const area = await Area.findOne({ _id: areaId, userId });
    
    if (!area) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy khu vực'
      });
    }
    
    // Lấy thông tin thiết bị kèm theo
    let devices = [];
    if (area.devices && area.devices.length > 0) {
      devices = await Device.find({ deviceId: { $in: area.devices } });
    }
    
    res.status(200).json({
      success: true,
      area,
      devices
    });
  } catch (error) {
    console.error('Error fetching area:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi tải thông tin khu vực',
      error: error.message
    });
  }
};

// Cập nhật khu vực
exports.updateArea = async (req, res) => {
  try {
    const { areaId } = req.params;
    const { name, description, devices } = req.body;
    const userId = req.user.id;
    
    const area = await Area.findOne({ _id: areaId, userId });
    
    if (!area) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy khu vực'
      });
    }
    
    // Cập nhật thông tin
    area.name = name || area.name;
    area.description = description || area.description;
    
    // Cập nhật danh sách thiết bị nếu có
    if (devices) {
      area.devices = devices;
    }
    
    await area.save();
    
    res.status(200).json({
      success: true,
      message: 'Cập nhật khu vực thành công',
      area
    });
  } catch (error) {
    console.error('Error updating area:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi cập nhật khu vực',
      error: error.message
    });
  }
};

// Xóa khu vực
exports.deleteArea = async (req, res) => {
  try {
    const { areaId } = req.params;
    const userId = req.user.id;
    
    const result = await Area.findOneAndDelete({ _id: areaId, userId });
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy khu vực'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Xóa khu vực thành công'
    });
  } catch (error) {
    console.error('Error deleting area:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi xóa khu vực',
      error: error.message
    });
  }
};

// Thêm cây trồng vào khu vực
exports.addPlantToArea = async (req, res) => {
  try {
    const { areaId } = req.params;
    const { name, type, moistureThreshold } = req.body;
    const userId = req.user.id;
    
    const area = await Area.findOne({ _id: areaId, userId });
    
    if (!area) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy khu vực'
      });
    }
    
    // Thêm cây trồng mới
    area.plants.push({
      name,
      type,
      moistureThreshold
    });
    
    await area.save();
    
    res.status(200).json({
      success: true,
      message: 'Thêm cây trồng thành công',
      area
    });
  } catch (error) {
    console.error('Error adding plant:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi thêm cây trồng',
      error: error.message
    });
  }
};

// Cập nhật cây trồng trong khu vực
exports.updatePlantInArea = async (req, res) => {
  try {
    const { areaId, plantIndex } = req.params;
    const plantData = req.body;
    const userId = req.user.id; // From authentication middleware
    
    // Convert plantIndex to a number
    const index = parseInt(plantIndex, 10);
    
    // Find the area and verify ownership
    const area = await Area.findById(areaId);
    
    if (!area) {
      return res.status(404).json({ message: 'Khu vực không tồn tại' });
    }
    
    // Verify that the area belongs to this user
    if (area.userId.toString() !== userId) {
      return res.status(403).json({ message: 'Không có quyền truy cập khu vực này' });
    }
    
    // Check if the plant index is valid
    if (!area.plants || index < 0 || index >= area.plants.length) {
      return res.status(404).json({ message: 'Cây trồng không tồn tại' });
    }
    
    // Update the plant at the specified index
    area.plants[index] = {
      ...area.plants[index].toObject(), // Keep existing plant data
      ...plantData, // Override with new data
    };
    
    await area.save();
    
    res.status(200).json({
      success: true,
      message: 'Cây trồng đã được cập nhật',
      area
    });
  } catch (error) {
    console.error('Error updating plant:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.deletePlantFromArea = async (req, res) => {
  try {
    const { areaId, plantIndex } = req.params;
    const userId = req.user.id; // From authentication middleware
    
    // Convert plantIndex to a number
    const index = parseInt(plantIndex, 10);
    
    // Find the area and verify ownership
    const area = await Area.findById(areaId);
    
    if (!area) {
      return res.status(404).json({ message: 'Khu vực không tồn tại' });
    }
    
    // Verify that the area belongs to this user
    if (area.userId.toString() !== userId) {
      return res.status(403).json({ message: 'Không có quyền truy cập khu vực này' });
    }
    
    // Check if the plant index is valid
    if (!area.plants || index < 0 || index >= area.plants.length) {
      return res.status(404).json({ message: 'Cây trồng không tồn tại' });
    }
    
    // Remove the plant at the specified index
    area.plants.splice(index, 1);
    
    await area.save();
    
    res.status(200).json({
      success: true,
      message: 'Cây trồng đã được xóa',
      area
    });
  } catch (error) {
    console.error('Error deleting plant:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Thêm/Xóa thiết bị khỏi khu vực
exports.updateDeviceInArea = async (req, res) => {
  try {
    const { areaId } = req.params;
    const { deviceId, action } = req.body; // action: 'add' hoặc 'remove'
    const userId = req.user.id;
    
    const area = await Area.findOne({ _id: areaId, userId });
    
    if (!area) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy khu vực'
      });
    }
    
    // Kiểm tra xem thiết bị có tồn tại không
    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy thiết bị'
      });
    }
    
    if (action === 'add') {
      // Thêm thiết bị vào khu vực nếu chưa có
      if (!area.devices.includes(deviceId)) {
        area.devices.push(deviceId);
      }
    } else if (action === 'remove') {
      // Xóa thiết bị khỏi khu vực
      area.devices = area.devices.filter(id => id !== deviceId);
    }
    
    await area.save();
    
    res.status(200).json({
      success: true,
      message: action === 'add' ? 'Đã thêm thiết bị vào khu vực' : 'Đã xóa thiết bị khỏi khu vực',
      area
    });
  } catch (error) {
    console.error('Error updating device in area:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi cập nhật thiết bị trong khu vực',
      error: error.message
    });
  }
};