
const axios = require("axios");
const mongoose = require("mongoose");
const mqtt = require('mqtt');
const getFeedModel = require("../models/Feed");
const Device = require('../models/Device');
const User = require('../models/User');

// Adafruit API details
const AIO_USERNAME = process.env.AIO_USERNAME;
const AIO_KEY = process.env.AIO_KEY;
const FEED_NAMES = ["sensor-temp", "sensor-soil", "sensor-humidity", "mode", "pump-motor"];

// Configuration
const MQTT_CONFIG = {
  SAVE_FOR_ACTIVE_DEVICES_ONLY: true
};

// MQTT client instance
let mqttClient = null;

// Map để lưu thiết bị đang hoạt động (dùng làm bộ đệm)
const activeDevices = new Map(); // userId -> deviceId

// Set để theo dõi các topic đã đăng ký
const subscribedTopics = new Set();

/**
 * Validate environment variables
 */
const validateEnv = () => {
  const required = ['AIO_USERNAME', 'AIO_KEY'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
};
validateEnv();

/**
 * Initialize MQTT client to receive real-time updates from Adafruit IO
 */
const initMqttClient = () => {
  if (mqttClient) return mqttClient;

  console.log('Initializing MQTT connection to Adafruit IO...');

  mqttClient = mqtt.connect('mqtts://io.adafruit.com', {
    username: AIO_USERNAME,
    password: AIO_KEY,
    reconnectPeriod: 5000
  });

  mqttClient.on('connect', () => {
    console.log('Connected to Adafruit IO MQTT');

    // Loại bỏ trùng lặp trong FEED_NAMES
    const uniqueFeedNames = [...new Set(FEED_NAMES)];

    uniqueFeedNames.forEach(feedName => {
      const topic = `${AIO_USERNAME}/feeds/${feedName}`;
      if (!subscribedTopics.has(topic)) {
        mqttClient.subscribe(topic, (err) => {
          if (!err) {
            console.log(`Subscribed to ${topic}`);
            subscribedTopics.add(topic);
          } else {
            console.error(`Error subscribing to ${topic}:`, err);
          }
        });
      } else {
        console.log(`Already subscribed to ${topic}, skipping.`);
      }
    });
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const feedName = topic.split('/').pop();
      const rawMessage = message.toString();
      let value = rawMessage;
      let deviceId = null;

      // Chỉ parse JSON nếu message bắt đầu bằng '{'
      if (rawMessage.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(rawMessage);
          console.log(`MQTT: Raw JSON payload:`, parsed);
          deviceId = parsed.deviceId;
          value = parsed.value;
          console.log(`MQTT: Parsed JSON - deviceId: ${deviceId}, value: ${value}`);
        } catch (e) {
          console.log(`MQTT: Failed to parse JSON, using raw value: ${rawMessage}`);
          value = rawMessage; // Giữ nguyên rawMessage nếu parse thất bại
        }
      } else {
        console.log(`MQTT: Message is not JSON, using raw value: ${rawMessage}`);
      }

      // Validate value
      if (value === undefined || value === null) {
        console.warn(`MQTT: Invalid value for feed ${feedName}: ${value}. Skipping save. Raw message: ${rawMessage}`);
        return;
      }

      console.log(`MQTT: Received update from ${feedName}: ${value}${deviceId ? ` (deviceId: ${deviceId})` : ''}`);
      console.log(`MQTT: Raw message: ${rawMessage}`);

      // Tìm tất cả thiết bị có feed này
      const devices = await Device.find({ feeds: { $in: [feedName] } });
      console.log(`MQTT: Devices found for feed ${feedName}:`, devices.map(d => ({
        deviceId: d.deviceId,
        userId: d.userId.toString(),
        feeds: d.feeds
      })));

      if (devices.length === 0) {
        console.warn(`MQTT: No device found for feed ${feedName}`);
        return;
      }

      let targetDevice = null;

      // Nếu có deviceId trong payload, kiểm tra thiết bị
      if (deviceId) {
        targetDevice = devices.find(d => d.deviceId === deviceId);
        if (!targetDevice) {
          console.warn(`MQTT: Device ${deviceId} not found for feed ${feedName}`);
          return;
        }
        // Luôn kiểm tra activeDeviceId từ MongoDB
        const user = await User.findById(targetDevice.userId).select('activeDeviceId');
        if (!user || user.activeDeviceId !== deviceId) {
          console.warn(
            `MQTT: Device ${deviceId} is not the active device for user ${targetDevice.userId}. Active device: ${user?.activeDeviceId || 'none'}`
          );
          return;
        }
      } else {
        // Kiểm tra activeDeviceId từ MongoDB
        for (const device of devices) {
          const userId = device.userId.toString();
          const user = await User.findById(userId).select('activeDeviceId');
          const activeDeviceId = user?.activeDeviceId;

          console.log(`MQTT: Checking user ${userId}, activeDeviceId: ${activeDeviceId || 'none'}`);

          if (activeDeviceId && activeDeviceId === device.deviceId) {
            targetDevice = device;
            break;
          }
        }

        // Nếu không tìm thấy thiết bị hoạt động
        if (!targetDevice) {
          console.warn(
            `MQTT: No active device found for feed ${feedName}. Data not saved.`
          );
          return;
        }
      }

      console.log(`MQTT: Selected targetDevice:`, {
        deviceId: targetDevice.deviceId,
        userId: targetDevice.userId.toString()
      });

      // Lưu dữ liệu
      const FeedModel = getFeedModel(feedName);
      const savedData = await FeedModel.create({
        userId: targetDevice.userId,
        deviceId: targetDevice.deviceId,
        value: value.toString(),
        feedType: feedName,
        createdAt: new Date()
      });

      console.log(
        `MQTT: Saved ${feedName} data for device ${targetDevice.deviceId} (user: ${targetDevice.userId}, value: ${value}, savedId: ${savedData._id})`
      );

      // Kiểm tra bản ghi vừa lưu
      const latestRecord = await FeedModel.findOne({ _id: savedData._id });
      console.log(`MQTT: Latest saved record:`, latestRecord);
    } catch (error) {
      console.error('MQTT: Error handling message:', error);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT Client error:', err);
  });

  mqttClient.on('offline', () => {
    console.warn('MQTT Client disconnected');
  });

  return mqttClient;
};

/**
 * Fetch data from Adafruit and save to database
 */
const fetchData = async (deviceId = null, userId = null) => {
  const results = {};

  try {
    let deviceFeeds = FEED_NAMES;
    let device = null;

    if (deviceId) {
      device = await Device.findOne({ deviceId });
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }
      if (device.feeds) {
        deviceFeeds = device.feeds;
      }

      if (userId && MQTT_CONFIG.SAVE_FOR_ACTIVE_DEVICES_ONLY) {
        const user = await User.findById(userId).select('activeDeviceId');
        const activeDeviceId = user?.activeDeviceId;
        if (activeDeviceId !== deviceId) {
          console.warn(
            `fetchData: Skipping data save for non-active device ${deviceId} (active: ${activeDeviceId || 'none'})`
          );
          return { skipped: true, reason: "Not active device", deviceId };
        }
      }
    }

    for (const feedName of deviceFeeds) {
      try {
        const url = `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds/${feedName}/data?limit=1`;
        const response = await axios.get(url, {
          headers: { "X-AIO-Key": AIO_KEY }
        });

        if (response.data.length > 0) {
          const latestData = response.data[0];
          const FeedModel = getFeedModel(feedName);

          const savedData = await FeedModel.create({
            deviceId: deviceId || 'unknown',
            userId: device ? device.userId : null,
            value: latestData.value.toString(),
            feedType: feedName,
            createdAt: new Date(latestData.created_at)
          });

          results[feedName] = {
            success: true,
            value: latestData.value,
            deviceId: deviceId,
            savedId: savedData._id
          };

          console.log(
            `fetchData: Saved ${feedName} data for device ${deviceId || 'unknown'}: ${latestData.value}`
          );
        } else {
          results[feedName] = { success: false, error: "No data found" };
        }
      } catch (feedError) {
        console.error(`fetchData: Error fetching data for ${feedName}:`, feedError.message);
        results[feedName] = { success: false, error: feedError.message };
      }
    }

    return results;
  } catch (error) {
    console.error("fetchData: Error in fetch operation:", error.message);
    throw error;
  }
};

/**
 * Controller to fetch data from Adafruit
 */
const fetchDataFromAdafruit = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.query;

    if (deviceId) {
      const device = await Device.findOne({ deviceId, userId });
      if (!device) {
        return res.status(403).json({
          success: false,
          message: 'Thiết bị không tồn tại hoặc bạn không có quyền truy cập'
        });
      }

      const user = await User.findById(userId).select('activeDeviceId');
      if (MQTT_CONFIG.SAVE_FOR_ACTIVE_DEVICES_ONLY && user?.activeDeviceId !== deviceId) {
        return res.status(403).json({
          success: false,
          message: `Chỉ có thể lấy dữ liệu cho thiết bị đang hoạt động (${user?.activeDeviceId || 'chưa thiết lập'})`
        });
      }
    }

    const results = await fetchData(deviceId, userId);
    res.status(200).json({
      success: true,
      message: `Data fetched and saved successfully ${deviceId ? 'for device ' + deviceId : ''}`,
      deviceId: deviceId || null,
      results
    });
  } catch (error) {
    console.error('fetchDataFromAdafruit: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch data',
      error: error.message
    });
  }
};

/**
 * Controller to get latest data from database
 */
const getLatestData = async (req, res) => {
  try {
    const userId = req.user.id;
    const results = {};

    const userDevices = await Device.find({ userId });
    if (!userDevices || userDevices.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Bạn chưa đăng ký thiết bị nào. Vui lòng đăng ký thiết bị để xem dữ liệu.',
        data: {}
      });
    }

    const userFeeds = new Set(userDevices.flatMap(device => device.feeds));

    for (const feedName of Array.from(userFeeds)) {
      const FeedModel = getFeedModel(feedName);
      const latestEntry = await FeedModel.findOne({ userId })
        .sort({ createdAt: -1 })
        .limit(1);

      results[feedName] = latestEntry ? {
        value: latestEntry.value,
        timestamp: latestEntry.createdAt,
        deviceId: latestEntry.deviceId
      } : { value: null, timestamp: null, deviceId: null };
    }

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error('getLatestData: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch latest data',
      error: error.message
    });
  }
};

/**
 * Controller to send commands to Adafruit
 */
const sendCommand = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, feedName, value } = req.body;

    if (!feedName || value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: feedName and value'
      });
    }

    if (!FEED_NAMES.includes(feedName)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid feed name'
      });
    }

    if (deviceId) {
      const device = await Device.findOne({ deviceId, userId });
      if (!device) {
        return res.status(403).json({
          success: false,
          message: 'Thiết bị không tồn tại hoặc bạn không có quyền truy cập'
        });
      }

      if (!device.feeds.includes(feedName)) {
        return res.status(400).json({
          success: false,
          message: `Thiết bị này không hỗ trợ ${feedName}`
        });
      }

      const user = await User.findById(userId).select('activeDeviceId');
      if (MQTT_CONFIG.SAVE_FOR_ACTIVE_DEVICES_ONLY && user?.activeDeviceId !== deviceId) {
        return res.status(403).json({
          success: false,
          message: `Chỉ có thể gửi lệnh cho thiết bị đang hoạt động (${user?.activeDeviceId || 'chưa thiết lập'})`
        });
      }
    } else {
      const userDevices = await Device.find({ userId });
      const userHasAccess = userDevices.some(device => device.feeds.includes(feedName));
      if (!userHasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Không có quyền điều khiển thiết bị này'
        });
      }
    }

    const commandValue = value.toString();
    const url = `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds/${feedName}/data`;
    const response = await axios.post(url, 
      { value: commandValue },
      { headers: { "X-AIO-Key": AIO_KEY } }
    );


    res.status(200).json({
      success: true,
      message: `Command sent to ${feedName} ${deviceId ? 'for device ' + deviceId : ''} successfully`,
      adafruitResponse: response.data
    });
  } catch (error) {
    console.error('sendCommand: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send command',
      error: error.message
    });
  }
};

/**
 * Controller to get historical data
 */
const getHistoricalData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { feedName } = req.params;
    const deviceId = req.params.deviceId || req.query.deviceId;
    const limit = parseInt(req.query.limit) || 24;

    if (!FEED_NAMES.includes(feedName)) {
      return res.status(404).json({
        success: false,
        message: `Feed ${feedName} not found`
      });
    }

    const filters = { userId };

    if (deviceId) {
      const device = await Device.findOne({ deviceId, userId });
      if (!device) {
        return res.status(403).json({
          success: false,
          message: 'Thiết bị không tồn tại hoặc bạn không có quyền truy cập'
        });
      }

      if (!device.feeds.includes(feedName)) {
        return res.status(400).json({
          success: false,
          message: `Thiết bị này không hỗ trợ ${feedName}`
        });
      }

      filters.deviceId = deviceId;
    } else {
      const userDevices = await Device.find({ userId });
      const userHasFeed = userDevices.some(device => device.feeds.includes(feedName));
      if (!userHasFeed) {
        return res.status(200).json({
          success: true,
          message: `Bạn không có thiết bị nào có cảm biến ${feedName}`,
          count: 0,
          data: []
        });
      }
    }

    const FeedModel = getFeedModel(feedName);
    const historicalData = await FeedModel.find(filters)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('deviceId value createdAt');

    res.status(200).json({
      success: true,
      deviceId: deviceId || null,
      count: historicalData.length,
      data: historicalData
    });
  } catch (error) {
    console.error(`getHistoricalData: Error for ${req.params.feedName}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error fetching historical data',
      error: error.message
    });
  }
};

/**
 * Controller to get all data for a specific device
 */
const getDeviceData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.params;

    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại hoặc không thuộc về bạn'
      });
    }

    const results = [];

    for (const feedName of device.feeds) {
      const FeedModel = getFeedModel(feedName);
      const feedData = await FeedModel.find({ deviceId })
        .sort({ createdAt: -1 })
        .limit(20);

      if (feedData && feedData.length > 0) {
        feedData.forEach(data => {
          results.push({
            feedName,
            type: feedName,
            value: data.value,
            timestamp: data.createdAt
          });
        });
      }
    }

    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({
      success: true,
      device: {
        name: device.deviceName,
        id: device.deviceId,
        feeds: device.feeds
      },
      data: results
    });
  } catch (error) {
    console.error('getDeviceData: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy dữ liệu thiết bị',
      error: error.message
    });
  }
};

/**
 * Controller to get latest soil moisture data
 */
const getLatestMoisture = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.params;

    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại hoặc không thuộc về bạn'
      });
    }

    if (!device.feeds.includes('sensor-soil')) {
      return res.status(400).json({
        success: false,
        message: 'Thiết bị không có cảm biến độ ẩm đất'
      });
    }

    const SoilModel = getFeedModel('sensor-soil');
    const latestMoisture = await SoilModel.findOne({ deviceId })
      .sort({ createdAt: -1 })
      .limit(1);

    if (!latestMoisture) {
      return res.status(200).json({
        success: true,
        message: 'Chưa có dữ liệu độ ẩm đất',
        moisture: null
      });
    }

    res.status(200).json({
      success: true,
      moisture: {
        value: parseFloat(latestMoisture.value),
        timestamp: latestMoisture.createdAt
      }
    });
  } catch (error) {
    console.error('getLatestMoisture: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy dữ liệu độ ẩm đất',
      error: error.message
    });
  }
};

/**
 * Controller to get single feed data
 */
const getSingleFeedData = async (req, res) => {
  try {
    const { feedName } = req.params;
    const userId = req.user.id;

    if (!FEED_NAMES.includes(feedName)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid feed name'
      });
    }

    const FeedModel = getFeedModel(feedName);
    const data = await FeedModel.findOne({ userId })
      .sort({ createdAt: -1 });

    if (!data) {
      return res.status(404).json({
        success: false,
        feedName,
        message: 'No data found for this feed'
      });
    }

    res.status(200).json({
      success: true,
      feedName,
      value: data.value,
      timestamp: data.createdAt,
      deviceId: data.deviceId
    });
  } catch (error) {
    console.error('getSingleFeedData: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching feed data',
      error: error.message
    });
  }
};

/**
 * Controller to get feed value for a device
 */
const getDeviceFeedValue = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, feedName } = req.params;

    if (!FEED_NAMES.includes(feedName)) {
      return res.status(400).json({
        success: false,
        message: `Feed không hợp lệ: ${feedName}`
      });
    }

    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại hoặc không thuộc về bạn'
      });
    }

    if (!device.feeds.includes(feedName)) {
      return res.status(400).json({
        success: false,
        message: `Thiết bị không hỗ trợ ${feedName}`
      });
    }

    const FeedModel = getFeedModel(feedName);
    const latestValue = await FeedModel.findOne({ deviceId })
      .sort({ createdAt: -1 })
      .limit(1);

    if (!latestValue) {
      return res.status(200).json({
        success: true,
        value: null,
        message: 'Chưa có dữ liệu cho feed này'
      });
    }

    res.status(200).json({
      success: true,
      deviceId,
      feedName,
      value: latestValue.value,
      timestamp: latestValue.createdAt
    });
  } catch (error) {
    console.error('getDeviceFeedValue: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy giá trị feed',
      error: error.message
    });
  }
};

/**
 * Controller to set active device
 */
const setActiveDevice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'deviceId là bắt buộc'
      });
    }

    const device = await Device.findOne({ deviceId, userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại hoặc không thuộc về bạn'
      });
    }

    // Lấy thiết bị hoạt động trước đó từ MongoDB
    const user = await User.findById(userId).select('activeDeviceId');
    const previousDeviceId = user?.activeDeviceId;

    // Cập nhật activeDeviceId trong MongoDB
    await User.updateOne({ _id: userId }, { activeDeviceId: deviceId });

    // Cập nhật activeDevices Map
    activeDevices.set(userId.toString(), deviceId);

    console.log(
      `setActiveDevice: User ${userId} set active device: ${deviceId}` +
      (previousDeviceId ? ` (previous: ${previousDeviceId})` : '')
    );
    console.log(`setActiveDevice: Current activeDevices:`, [...activeDevices.entries()]);

    // Đợi ngắn để đảm bảo MongoDB cập nhật
    await new Promise(resolve => setTimeout(resolve, 100));

    res.status(200).json({
      success: true,
      message: `Đã thiết lập ${deviceId} làm thiết bị hoạt động`,
      deviceId,
      previousDeviceId,
      activeCount: activeDevices.size
    });
  } catch (error) {
    console.error('setActiveDevice: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi thiết lập thiết bị hoạt động',
      error: error.message
    });
  }
};

/**
 * Controller to get active device
 */
const getActiveDevice = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select('activeDeviceId');
    const activeDeviceId = user?.activeDeviceId;

    if (!activeDeviceId) {
      return res.status(200).json({
        success: true,
        message: 'Chưa có thiết bị hoạt động nào được thiết lập',
        deviceId: null
      });
    }

    const device = await Device.findOne({ deviceId: activeDeviceId, userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị hoạt động không tồn tại hoặc không thuộc về bạn'
      });
    }

    res.status(200).json({
      success: true,
      deviceId: activeDeviceId,
      deviceName: device.deviceName,
      feeds: device.feeds
    });
  } catch (error) {
    console.error('getActiveDevice: Error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy thông tin thiết bị hoạt động',
      error: error.message
    });
  }
};

module.exports = {
  fetchData,
  fetchDataFromAdafruit,
  getLatestData,
  sendCommand,
  initMqttClient,
  getHistoricalData,
  getDeviceData,
  getSingleFeedData,
  getLatestMoisture,
  getDeviceFeedValue,
  setActiveDevice,
  getActiveDevice
};
