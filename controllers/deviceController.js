const Device = require("../models/Device");
const Area = require("../models/Area"); // Thêm import Area model

/**
 * Đăng ký thiết bị mới cho người dùng
 */
const registerDevice = async (req, res) => {
  try {
    const { deviceId, deviceName, feeds, areaId, plantIndex } = req.body;
    const userId = req.user.id;
    
    // Kiểm tra thiết bị đã được đăng ký chưa
    const existingDevice = await Device.findOne({ deviceId });
    if (existingDevice) {
      return res.status(400).json({
        success: false,
        message: "Thiết bị này đã được đăng ký"
      });
    }
    
    // Kiểm tra khu vực nếu có
    if (areaId) {
      const area = await Area.findOne({ _id: areaId, userId });
      if (!area) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy khu vực"
        });
      }
      
      // Kiểm tra cây trồng
      if (plantIndex >= 0 && (!area.plants || plantIndex >= area.plants.length)) {
        return res.status(400).json({
          success: false,
          message: "Cây trồng không tồn tại trong khu vực này"
        });
      }
      
      // Thêm deviceId vào mảng devices của khu vực
      await Area.findByIdAndUpdate(areaId, {
        $addToSet: { devices: deviceId }
      });

    }
    
    // Tạo thiết bị mới
    const device = new Device({
      userId,
      deviceId,
      deviceName,
      feeds,
      areaId: areaId || null,
      plantIndex: areaId ? plantIndex : -1
    });
    
    await device.save();
    
    res.status(201).json({
      success: true,
      message: "Thiết bị đã được đăng ký thành công",
      device
    });
  } catch (error) {
    console.error("Error registering device:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi đăng ký thiết bị",
      error: error.message
    });
  }
};

/**
 * Lấy tất cả thiết bị của người dùng
 */
const getUserDevices = async (req, res) => {
  try {
    const userId = req.user.id;
    const devices = await Device.find({ userId });
    
    res.status(200).json({
      success: true,
      count: devices.length,
      devices
    });
  } catch (error) {
    console.error("Error fetching user devices:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi lấy danh sách thiết bị",
      error: error.message
    });
  }
};

/**
 * Lấy thông tin một thiết bị theo ID
 */
const getDeviceById = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.id;
    
    const device = await Device.findOne({ deviceId, userId });
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thiết bị hoặc bạn không có quyền xem thiết bị này"
      });
    }
    
    res.status(200).json({
      success: true,
      device
    });
  } catch (error) {
    console.error("Error fetching device:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi lấy thông tin thiết bị",
      error: error.message
    });
  }
};

/**
 * Cập nhật thông tin thiết bị
 */
const updateDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.id;
    const { deviceName, feeds, areaId, plantIndex } = req.body;
    
    // Tìm thiết bị thuộc về người dùng
    const device = await Device.findOne({ deviceId, userId });
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thiết bị hoặc bạn không có quyền chỉnh sửa thiết bị này"
      });
    }
    
    // Lưu giá trị areaId cũ để kiểm tra sau này
    const oldAreaId = device.areaId;
    
    // Kiểm tra khu vực nếu có
    if (areaId !== undefined) {
      if (areaId) {
        const area = await Area.findOne({ _id: areaId, userId });
        if (!area) {
          return res.status(404).json({
            success: false,
            message: "Không tìm thấy khu vực"
          });
        }
        
        // Kiểm tra cây trồng
        const pIndex = plantIndex !== undefined ? plantIndex : device.plantIndex;
        if (pIndex >= 0 && (!area.plants || pIndex >= area.plants.length)) {
          return res.status(400).json({
            success: false,
            message: "Cây trồng không tồn tại trong khu vực này"
          });
        }
        
        // Nếu thiết bị đã ở trong khu vực cũ, xóa deviceId khỏi khu vực cũ
        if (oldAreaId && oldAreaId !== areaId) {
          await Area.findByIdAndUpdate(oldAreaId, {
            $pull: { devices: deviceId }
          });
        }
        
        // Thêm deviceId vào mảng devices của khu vực mới nếu chưa có
        await Area.findByIdAndUpdate(areaId, {
          $addToSet: { devices: deviceId }
        });
      } else if (oldAreaId) {
        // Nếu areaId mới là null nhưng có areaId cũ, xóa khỏi khu vực cũ
        await Area.findByIdAndUpdate(oldAreaId, {
          $pull: { devices: deviceId }
        });
      }
      
      // Chỉ cập nhật areaId của thiết bị
      device.areaId = areaId || null;
    }
    
    // Cập nhật các trường nếu được cung cấp
    if (deviceName !== undefined) device.deviceName = deviceName;
    if (feeds !== undefined) device.feeds = feeds;
    if (plantIndex !== undefined) device.plantIndex = plantIndex;
    
    // Nếu thiết bị không liên kết với khu vực nào, đặt lại plantIndex
    if (!device.areaId) {
      device.plantIndex = -1;
    }
    
    await device.save();
    
    res.status(200).json({
      success: true,
      message: "Thông tin thiết bị đã được cập nhật thành công",
      device
    });
  } catch (error) {
    console.error("Error updating device:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi cập nhật thiết bị",
      error: error.message
    });
  }
};

/**
 * Xóa thiết bị
 */
const deleteDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.id;
    
    // Tìm thiết bị trước khi xóa
    const device = await Device.findOne({ deviceId, userId });
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thiết bị hoặc bạn không có quyền xóa thiết bị này"
      });
    }
    
    // Nếu thiết bị đang liên kết với khu vực, xóa khỏi khu vực
    if (device.areaId) {
      await Area.findByIdAndUpdate(device.areaId, {
        $pull: { devices: deviceId }
      });
    }
    
    // Xóa thiết bị
    await Device.deleteOne({ deviceId, userId });
    
    res.status(200).json({
      success: true,
      message: "Thiết bị đã được xóa thành công"
    });
  } catch (error) {
    console.error("Error deleting device:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi xóa thiết bị",
      error: error.message
    });
  }
};

/**
 * Thay đổi trạng thái hoạt động của thiết bị
 */
const toggleDeviceStatus = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.id;
    
    // Tìm thiết bị thuộc về người dùng
    const device = await Device.findOne({ deviceId, userId });
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thiết bị hoặc bạn không có quyền truy cập thiết bị này"
      });
    }
    
    // Đảo ngược trạng thái hoạt động
    device.isActive = !device.isActive;
    
    // Cập nhật thời gian hoạt động gần nhất
    device.lastActivity = Date.now();
    
    await device.save();
    
    res.status(200).json({
      success: true,
      message: `Thiết bị đã ${device.isActive ? 'kích hoạt' : 'vô hiệu hóa'} thành công`,
      device
    });
  } catch (error) {
    console.error("Error toggling device status:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi thay đổi trạng thái thiết bị",
      error: error.message
    });
  }
};

/**
 * Liên kết thiết bị với khu vực và cây trồng cụ thể
 */
const linkDeviceToPlant = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { areaId, plantIndex } = req.body;
    const userId = req.user.id;
    
    // Tìm thiết bị thuộc về người dùng
    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thiết bị"
      });
    }
    
    // Lưu giá trị areaId cũ để kiểm tra sau này
    const oldAreaId = device.areaId;
    
    // Kiểm tra khu vực mới
    if (areaId) {
      const area = await Area.findOne({ _id: areaId, userId });
      if (!area) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy khu vực"
        });
      }
      
      // Kiểm tra chỉ mục cây trồng
      if (plantIndex >= 0 && (!area.plants || plantIndex >= area.plants.length)) {
        return res.status(400).json({
          success: false,
          message: "Cây trồng không tồn tại trong khu vực này"
        });
      }
      
      // Nếu thiết bị đã ở trong khu vực cũ, xóa deviceId khỏi khu vực cũ
      if (oldAreaId && oldAreaId !== areaId) {
        await Area.findByIdAndUpdate(oldAreaId, {
          $pull: { devices: deviceId }
        });
      }
      
      // Thêm deviceId vào mảng devices của khu vực mới nếu chưa có
      await Area.findOneAndUpdate(
        { _id: areaId, "plants._id": area.plants[plantIndex]._id },
        { $set: { "plants.$.deviceId": deviceId } }
      );
    } else if (oldAreaId) {
      // Nếu areaId mới là null nhưng có areaId cũ, xóa khỏi khu vực cũ
      await Area.findByIdAndUpdate(oldAreaId, {
        $pull: { devices: deviceId }
      });
    }
    
    // Cập nhật thiết bị
    device.areaId = areaId || null;
    device.plantIndex = plantIndex !== undefined ? plantIndex : -1;
    await device.save();
    
    res.status(200).json({
      success: true,
      message: "Liên kết thiết bị với cây trồng thành công",
      device
    });
  } catch (error) {
    console.error("Error linking device to plant:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi liên kết thiết bị",
      error: error.message
    });
  }
};

/**
 * Lấy thông tin thiết bị kèm theo khu vực và cây trồng đang liên kết
 */
const getDeviceData = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.id;
    
    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thiết bị"
      });
    }
    
    // Lấy thông tin khu vực và cây trồng
    let area = null;
    let plant = null;
    
    if (device.areaId) {
      area = await Area.findById(device.areaId);
      if (area && device.plantIndex >= 0 && area.plants && area.plants.length > device.plantIndex) {
        plant = area.plants[device.plantIndex];
      }
    }
    
    res.status(200).json({
      success: true,
      device,
      area: area ? {
        _id: area._id,
        name: area.name,
        description: area.description
      } : null,
      plant
    });
  } catch (error) {
    console.error("Error fetching device data:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy thông tin thiết bị",
      error: error.message
    });
  }
};

/**
 * Xử lý dữ liệu từ thiết bị IoT và điều khiển dựa trên ngưỡng độ ẩm cây trồng
 * API này được gọi bởi thiết bị IoT nên không yêu cầu xác thực người dùng
 */
const processDeviceData = async (req, res) => {
  try {
    const { deviceId, sensors } = req.body;
    
    if (!deviceId || !sensors || !sensors.soil_moisture) {
      return res.status(400).json({
        success: false,
        message: "Thiếu dữ liệu thiết bị hoặc cảm biến"
      });
    }
    
    const soilMoisture = parseFloat(sensors.soil_moisture);
    
    // Tìm thiết bị
    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thiết bị"
      });
    }
    
    // Cập nhật thời gian hoạt động gần nhất của thiết bị
    device.lastActivity = Date.now();
    await device.save();
    
    // Kiểm tra xem thiết bị có được liên kết với cây trồng cụ thể không
    if (!device.areaId || device.plantIndex < 0) {
      return res.status(200).json({
        success: true,
        message: "Thiết bị chưa liên kết với cây trồng cụ thể",
        action: null
      });
    }
    
    // Lấy thông tin khu vực
    const area = await Area.findById(device.areaId);
    if (!area || !area.plants || area.plants.length <= device.plantIndex) {
      return res.status(200).json({
        success: true,
        message: "Không tìm thấy thông tin cây trồng",
        action: null
      });
    }
    
    // Lấy thông tin cây trồng cụ thể
    const plant = area.plants[device.plantIndex];
    const { min: minThreshold, max: maxThreshold } = plant.moistureThreshold;
    
    let action = null;
    
    // Kiểm tra độ ẩm và đưa ra hành động
    if (!device.isActive) {
      action = "device_inactive";
    } else if (soilMoisture < minThreshold) {
      // Độ ẩm thấp, cần bật bơm nước
      action = "turn_on_pump";
    } else if (soilMoisture > maxThreshold) {
      // Độ ẩm cao, cần tắt bơm nước
      action = "turn_off_pump";
    } else {
      action = "maintain_current_state";
    }
    
    res.status(200).json({
      success: true,
      message: "Đã xử lý dữ liệu thiết bị",
      deviceId,
      deviceName: device.deviceName,
      action,
      plantName: plant.name,
      currentMoisture: soilMoisture,
      minThreshold,
      maxThreshold
    });
  } catch (error) {
    console.error("Error processing device data:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi xử lý dữ liệu thiết bị",
      error: error.message
    });
  }
};


const getDevicesByArea = async (req, res) => {
  try {
    const { areaId } = req.params;
    const userId = req.user.id;
    
    // Kiểm tra khu vực có tồn tại không
    const area = await Area.findOne({ _id: areaId, userId });
    if (!area) {
      return res.status(404).json({
        success: false,
        message: "Khu vực không tồn tại hoặc bạn không có quyền truy cập"
      });
    }
    
    // Tìm tất cả thiết bị có areaId trỏ đến khu vực này
    const devices = await Device.find({ userId, areaId });
    
    res.status(200).json({
      success: true,
      count: devices.length,
      devices
    });
  } catch (error) {
    console.error("Error fetching area devices:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi lấy danh sách thiết bị của khu vực",
      error: error.message
    });
  }
};

const getUnassignedDevices = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Tìm các thiết bị không có areaId
    const devices = await Device.find({ 
      userId, 
      $or: [
        { areaId: { $exists: false } },
        { areaId: null }
      ] 
    });
    
    res.status(200).json({
      success: true,
      count: devices.length,
      devices
    });
  } catch (error) {
    console.error("Error fetching unassigned devices:", error);
    res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi lấy danh sách thiết bị chưa gán khu vực",
      error: error.message
    });
  }
};

const getDeviceAreaMapping = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Tìm tất cả thiết bị của người dùng có liên kết với khu vực
    const devices = await Device.find({ 
      userId, 
      $or: [
        { areaId: { $exists: true, $ne: null } },
        { plantIndex: { $exists: true, $ne: null } }
      ] 
    });
    
    if (!devices || devices.length === 0) {
      return res.status(200).json({
        success: true,
        mappings: [] // Trả về mảng rỗng nếu không có mapping
      });
    }
    
    // Tạo mapping từ thiết bị sang khu vực/cây trồng
    const mappings = devices.map(device => ({
      deviceId: device.deviceId,
      areaId: device.areaId,
      plantIndex: device.plantIndex !== undefined ? device.plantIndex : -1
    })).filter(mapping => mapping.areaId); // Lọc ra các mapping có areaId
    
    res.status(200).json({
      success: true,
      mappings
    });
  } catch (error) {
    console.error('Error getting device-area mappings:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving device-area mappings',
      error: error.message
    });
  }
};



// Export tất cả chức năng
module.exports = {
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
  getUnassignedDevices,
  getDeviceAreaMapping
};