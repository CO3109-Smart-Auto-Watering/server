const axios = require("axios");
const mongoose = require("mongoose");
const mqtt = require('mqtt');
const getFeedModel = require("../models/Feed");
const Device = require('../models/Device');


// Adafruit API details
const AIO_USERNAME = process.env.AIO_USERNAME;  
const AIO_KEY = process.env.AIO_KEY; 
const FEED_NAMES = ["sensor-temp", "sensor-soil", "sensor-humidity", "mode", "pump-motor"];



// MQTT client instance
let mqttClient = null;

/**
 * Initialize MQTT client to receive real-time updates from Adafruit IO
 */
const initMqttClient = () => {
  // If client already exists, return it
  if (mqttClient) return mqttClient;

  console.log('Initializing MQTT connection to Adafruit IO...');
  
  // Create MQTT client
  mqttClient = mqtt.connect('mqtts://io.adafruit.com', {
    username: AIO_USERNAME,
    password: AIO_KEY,
    reconnectPeriod: 5000 // Reconnect after 5 seconds if connection lost
  });
  
  // Handle connection
  mqttClient.on('connect', () => {
    console.log('Connected to Adafruit IO MQTT');
    
    // Subscribe to all feed topics
    FEED_NAMES.forEach(feedName => {
      const topic = `${AIO_USERNAME}/feeds/${feedName}`;
      mqttClient.subscribe(topic, (err) => {
        if (!err) {
          console.log(`Subscribed to ${topic}`);
        } else {
          console.error(`Error subscribing to ${topic}:`, err);
        }
      });
    });
  });
  
  // Handle incoming messages
  mqttClient.on('message', async (topic, message) => {
    try {
      // Extract feed name from topic (format: username/feeds/feedname)
      const feedName = topic.split('/').pop();
      const value = message.toString();
      
      console.log(`MQTT: Received update from ${feedName}: ${value}`);
      
      // Tìm thiết bị có feed này
      const device = await Device.findOne({ feeds: { $in: [feedName] } });
      
      // Lấy deviceId từ database, không phải từ giá trị tin nhắn
      const deviceId = device ? device.deviceId : 'unknown';
      const userId = device ? device.userId : null;
      
      // Create feed model and save data
      const FeedModel = getFeedModel(feedName);
      await FeedModel.create({
        userId: userId,
        deviceId: deviceId,
        value: value, // Sử dụng giá trị trực tiếp
        feedType: feedName,
        createdAt: new Date()
      });
      
      const userInfo = userId ? `for user ${userId}` : "(unassociated)";
      console.log(`MQTT: Saved ${feedName} data ${userInfo} for device ${deviceId} (value: ${value})`);
    } catch (error) {
      console.error('Error handling MQTT message:', error);
    }
  });
  
  // Handle connection errors
  mqttClient.on('error', (err) => {
    console.error('MQTT Client error:', err);
  });
  
  mqttClient.on('offline', () => {
    console.warn('MQTT Client disconnected');
  });
  
  return mqttClient;
};

/**
 * Function to fetch data from Adafruit and save to database
 */

const fetchData = async (deviceId = null) => {
  const results = {};
  
  try {
    if (!AIO_USERNAME || !AIO_KEY) {
      throw new Error("Missing Adafruit IO credentials in environment variables");
    }
    
    // Nếu có deviceId, tìm thiết bị để lấy feeds
    let deviceFeeds = FEED_NAMES;
    let device = null;
    
    if (deviceId) {
      device = await Device.findOne({ deviceId });
      if (device && device.feeds) {
        deviceFeeds = device.feeds;
      }
    }
    
    for (const feedName of deviceFeeds) {
      try {
        const url = `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds/${feedName}/data?limit=1`;
        
        const response = await axios.get(url, {
          headers: { "X-AIO-Key": AIO_KEY },
        });

        if (response.data.length > 0) {
          const latestData = response.data[0];
          const FeedModel = getFeedModel(feedName);

          // Save data to the corresponding collection with deviceId
          const savedData = await FeedModel.create({
            deviceId: deviceId || 'unknown',
            userId: device ? device.userId : null,
            value: latestData.value,
            feedType: feedName,
            createdAt: new Date(latestData.created_at),
          });

          results[feedName] = {
            success: true,
            value: latestData.value,
            deviceId: deviceId,
            savedId: savedData._id
          };
          
          console.log(`Data saved to ${feedName} collection for device ${deviceId || 'unknown'}:`, latestData.value);
        } else {
          results[feedName] = { success: false, error: "No data found" };
        }
      } catch (feedError) {
        console.error(`Error fetching data for ${feedName}:`, feedError.message);
        results[feedName] = { success: false, error: feedError.message };
      }
    }
    
    return results;
  } catch (error) {
    console.error("Error in fetch operation:", error.message);
    throw error;
  }
};


const fetchDataFromAdafruit = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.query;
    
    // Kiểm tra quyền nếu có deviceId
    if (deviceId) {
      const device = await Device.findOne({ deviceId, userId });
      if (!device) {
        return res.status(403).json({
          success: false,
          message: 'Thiết bị không tồn tại hoặc bạn không có quyền truy cập'
        });
      }
    }
    
    const results = await fetchData(deviceId);
    res.status(200).json({
      success: true,
      message: `Data fetched and saved successfully ${deviceId ? 'for device ' + deviceId : ''}`,
      deviceId: deviceId || null,
      results
    });
  } catch (error) {
    console.error('Error in fetch endpoint:', error);
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
    
    // Get user's devices and their feeds
    const userDevices = await Device.find({ userId });

    if (!userDevices || userDevices.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Bạn chưa đăng ký thiết bị nào. Vui lòng đăng ký thiết bị để xem dữ liệu.',
        data: {}
      });
    }

    const userFeeds = new Set(userDevices.flatMap(device => device.feeds));
    
    
    // Get latest entry from each feed collection
    for (const feedName of Array.from(userFeeds)) {
      const FeedModel = getFeedModel(feedName);
      const query = { userId };
      
      const latestEntry = await FeedModel.findOne(query)
        .sort({ createdAt: -1 })
        .limit(1);
      
      if (latestEntry) {
        results[feedName] = {
          value: latestEntry.value,
          timestamp: latestEntry.createdAt
        };
      } else {
        results[feedName] = { value: null, timestamp: null };
      }
    }
    
    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error('Error fetching latest data:', error);
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
    
    // Check if feedName is valid
    if (!FEED_NAMES.includes(feedName)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid feed name'
      });
    }
    
    // Kiểm tra thiết bị nếu có deviceId
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
    } else {
      // Kiểm tra xem người dùng có quyền sử dụng feed này không
      const userDevices = await Device.find({ userId });
      const userHasAccess = userDevices.some(device => device.feeds.includes(feedName));
      
      if (!userHasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Không có quyền điều khiển thiết bị này'
        });
      }
    }
    
    // Định dạng giá trị nếu có deviceId
    const commandValue = deviceId ? `${deviceId}:${value}` : value.toString();
    
    // Send the command to Adafruit
    const url = `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds/${feedName}/data`;
    const response = await axios.post(url, 
      { value: commandValue },
      { headers: { "X-AIO-Key": AIO_KEY } }
    );
    
    // Lưu lại lệnh đã gửi
    const FeedModel = getFeedModel(feedName);
    await FeedModel.create({
      userId,
      deviceId: deviceId || 'unknown',
      feedType: feedName,
      value: value.toString(),
      createdAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: `Command sent to ${feedName} ${deviceId ? 'for device ' + deviceId : ''} successfully`,
      adafruitResponse: response.data,
    });
    
  } catch (error) {
    console.error('Error sending command:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send command',
      error: error.message
    });
  }
};

const getHistoricalData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { feedName } = req.params;
    const { deviceId } = req.query;
    const limit = parseInt(req.query.limit) || 24; // Default to 24 entries
    
    // Validate the feed name
    if (!FEED_NAMES.includes(feedName)) {
      return res.status(404).json({
        success: false,
        message: `Feed ${feedName} not found`
      });
    }
    
    // Xây dựng query filters
    const filters = { userId };
    
    // Nếu có deviceId, kiểm tra và thêm vào filters
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
      // Kiểm tra xem user có thiết bị nào hỗ trợ feed này không
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
    
    // Get the feed model
    const FeedModel = getFeedModel(feedName);

    // Query for historical data with filters
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
    console.error(`Error fetching historical data for ${req.params.feedName}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error fetching historical data',
      error: error.message
    });
  }
};

/**
 * Get all data for a specific device
 */
const getDeviceData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.params;
    
    // Kiểm tra xem thiết bị có thuộc về người dùng không
    const device = await Device.findOne({ deviceId, userId });
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại hoặc không thuộc về bạn'
      });
    }
    
    // Kết quả sẽ chứa dữ liệu từ tất cả feed của thiết bị
    const results = [];
    
    // Lấy dữ liệu cho mỗi feed của thiết bị
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
    
    // Sắp xếp kết quả theo thời gian giảm dần
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
    console.error('Error fetching device data:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy dữ liệu thiết bị',
      error: error.message
    });
  }
};

/**
 * Get latest soil moisture data for a device
 */
const getLatestMoisture = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.params;
    
    // Kiểm tra xem thiết bị có thuộc về người dùng không
    const device = await Device.findOne({ deviceId, userId });
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại hoặc không thuộc về bạn'
      });
    }
    
    // Kiểm tra xem thiết bị có cảm biến độ ẩm đất không
    if (!device.feeds.includes('sensor-soil')) {
      return res.status(400).json({
        success: false,
        message: 'Thiết bị không có cảm biến độ ẩm đất'
      });
    }
    
    // Lấy dữ liệu độ ẩm đất mới nhất
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
    console.error('Error fetching latest moisture:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy dữ liệu độ ẩm đất',
      error: error.message
    });
  }
};


const getSingleFeedData = async (req, res) => {
  try {
    const { feedName } = req.params;
    
    // Lấy userId từ thông tin xác thực
    const userId = req.user.id;
    
    // Kiểm tra feed name hợp lệ
    const validFeeds = ['sensor-temp', 'sensor-humidity', 'sensor-soil', 'pump-motor', 'mode'];
    if (!validFeeds.includes(feedName)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid feed name'
      });
    }
    
    // Sử dụng getFeedModel thay vì SensorData
    const FeedModel = getFeedModel(feedName);
    
    // Lấy dữ liệu mới nhất của feed từ database
    const data = await FeedModel.findOne({ 
      userId 
    }).sort({ createdAt: -1 }); // Sort theo createdAt không phải timestamp
    
    if (!data) {
      return res.status(404).json({
        success: false,
        feedName: feedName,
        message: 'No data found for this feed'
      });
    }
    
    return res.status(200).json({
      success: true,
      feedName,
      value: data.value,
      timestamp: data.createdAt // Trả về createdAt thay vì timestamp
    });
    
  } catch (error) {
    console.error('Error fetching feed data:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching feed data',
      error: error.message
    });
  }
};




module.exports = {
  fetchData,              // Original function for internal use
  fetchDataFromAdafruit,  // Controller for /fetch route
  getLatestData,          // Controller for /latest route
  sendCommand,          // Controller for /command route
  initMqttClient,          // Function to initialize MQTT client
  getHistoricalData,        // Controller for /history route
  getDeviceData,          // Controller for /device/:deviceId route
  getSingleFeedData      // Controller for /feed/:feedName route
};