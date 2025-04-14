const mongoose = require('mongoose');
const getFeedModel = require('../models/Feed');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');
const path = require('path');
const fs = require('fs');

const FONT_REGULAR = path.join(__dirname, "../assets/fonts/static/Roboto-Regular.ttf");
const FONT_BOLD = path.join(__dirname, "../assets/fonts/static/Roboto-Bold.ttf");
const { generateSensorChart, generateWateringChart, generateWaterDistributionChart } = require('../utils/chartGenerator');


// Get report data
exports.getReportData = async (req, res) => {
  try {
    let { startDate, endDate, dataType } = req.query;
    console.log('Query params:', { startDate, endDate, dataType });
    
    // Set default values if dates are not provided
    if (!startDate) {
      // Default to 7 days ago
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      startDate = sevenDaysAgo.toISOString().split('T')[0];
    }
    
    if (!endDate) {
      // Default to today
      endDate = new Date().toISOString().split('T')[0];
    }
    
    if (!dataType) {
      // Default to all data types
      dataType = 'all';
    }
    
    // Now we have valid dates to work with
    console.log('Using dates:', { startDate, endDate, dataType });
    
    // Convert string dates to Date objects
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include the entire end day
    
    console.log(`Date range: ${start.toISOString()} to ${end.toISOString()}`);
    
    // Base query for date range
    const dateQuery = { 
      createdAt: { 
        $gte: start, 
        $lte: end 
      } 
    };
    
    // Get data from the appropriate feed models - using EXACT collection names
    const feedsToQuery = [];
    
    if (dataType === 'all' || dataType === 'temperature') {
      feedsToQuery.push('sensor-temp');
    }
    
    if (dataType === 'all' || dataType === 'humidity') {
      feedsToQuery.push('sensor-humidity');
    }
    
    if (dataType === 'all' || dataType === 'soil') {
      feedsToQuery.push('sensor-soil');
    }
    
    // Get watering events based on pump activations
    const pumpEventsNeeded = (dataType === 'all' || dataType === 'watering');
    
    // Fetch data from each feed model
    const sensorData = {};
    let pumpEvents = [];
    
    // Map collection names to property names
    const propertyMap = {
      'sensor-temp': 'temperature',
      'sensor-humidity': 'humidity',
      'sensor-soil': 'soilMoisture'
    };
    
    console.log('About to query these feeds:', feedsToQuery);
    
    // Parallel fetch from all required feeds
    await Promise.all(feedsToQuery.map(async (feedName) => {
      try {
        // Use direct collection access for debugging
        const collection = mongoose.connection.db.collection(feedName);
        const count = await collection.countDocuments(dateQuery);
        console.log(`Found ${count} documents in ${feedName} for date range`);
        
        // Fetch using model
        const FeedModel = getFeedModel(feedName);
        const readings = await FeedModel.find(dateQuery).sort('createdAt');
        console.log(`Retrieved ${readings.length} readings from ${feedName}`);
        
        // Process readings into daily groups
        readings.forEach(reading => {
          const date = reading.createdAt.toISOString().split('T')[0];
          if (!sensorData[date]) {
            sensorData[date] = { date };
          }
          
          const property = propertyMap[feedName];
          if (!sensorData[date][property]) {
            sensorData[date][property] = [];
          }
          
          // Add the value to the appropriate array
          // Make sure to handle both numeric and string values
          const numValue = parseFloat(reading.value);
          if (!isNaN(numValue)) {
            sensorData[date][property].push(numValue);
          }
        });
      } catch (error) {
        console.error(`Error fetching ${feedName} data:`, error);
      }
    }));
    
    console.log('Sensor data object:', JSON.stringify(sensorData));
    
    // Fetch pump events if needed
    if (pumpEventsNeeded) {
        try {
          const PumpModel = getFeedModel('pump-motors');
          const ModeModel = getFeedModel('modes');
          
          // Get all pump events within the date range - FIX: changed variable name to rawPumpEvents
          const rawPumpEvents = await PumpModel.find(dateQuery).sort('createdAt');
          console.log(`Found ${rawPumpEvents.length} pump events`);
          
          // Get mode changes within the date range
          const modeChanges = await ModeModel.find(dateQuery).sort('createdAt');
          console.log(`Found ${modeChanges.length} mode changes`);
          
          // Create a map of system mode by time
          const modeMap = {};
          modeChanges.forEach(change => {
            const timestamp = change.createdAt.getTime();
            modeMap[timestamp] = change.value;
          });
          
          // Sort timestamps for binary search
          const modeTimestamps = Object.keys(modeMap).map(Number).sort((a, b) => a - b);
          
          // Function to find the system mode at a given time
          const getModeAtTime = (time) => {
            // Default mode if we can't determine
            let mode = 'unknown';
            
            if (modeTimestamps.length === 0) {
              return mode;
            }
            
            // Find the closest previous timestamp
            const timeMs = new Date(time).getTime();
            let left = 0;
            let right = modeTimestamps.length - 1;
            
            // If time is before our first recorded mode change
            if (timeMs < modeTimestamps[0]) {
              return modeMap[modeTimestamps[0]] || 'unknown';
            }
            
            // Binary search to find the closest previous timestamp
            while (left <= right) {
              const mid = Math.floor((left + right) / 2);
              
              if (modeTimestamps[mid] <= timeMs) {
                left = mid + 1;
              } else {
                right = mid - 1;
              }
            }
            
            // right will be the index of the closest timestamp less than or equal to timeMs
            if (right >= 0) {
              mode = modeMap[modeTimestamps[right]] || 'unknown';
            }
            
            return mode;
          };
          
          // Group pump events by activation/deactivation pairs
          const activations = [];
          const deactivations = [];
          
          // FIX: Use rawPumpEvents instead of pumpEvents
          rawPumpEvents.forEach(event => {
            if (event.value === '1') {
              activations.push(event);
            } else if (event.value === '0') {
              deactivations.push(event);
            }
          });
          
          // Process activations into watering events with durations
          // pumpEvents already declared with let above, so no redeclaration needed
          pumpEvents = [];
          
          activations.forEach(activation => {
            // Find next deactivation event after this activation
            const activationTime = new Date(activation.createdAt).getTime();
            let duration = 5; // Default 5 minutes if no matching deactivation
            let endTime = null;
            
            // Find the matching deactivation
            const matchingDeactivation = deactivations.find(deactivation => {
              const deactivationTime = new Date(deactivation.createdAt).getTime();
              return deactivationTime > activationTime;
            });
            
            if (matchingDeactivation) {
              // Calculate actual duration in minutes
              const deactivationTime = new Date(matchingDeactivation.createdAt).getTime();
              duration = Math.round((deactivationTime - activationTime) / (1000 * 60));
              endTime = matchingDeactivation.createdAt;
              
              // Remove this deactivation so we don't match it again
              deactivations.splice(deactivations.indexOf(matchingDeactivation), 1);
            }
            
            // Determine if this was automatic or manual
            const mode = getModeAtTime(activation.createdAt);
            const trigger = mode === '0' ? 'automatic' : 'manual';
            
            // Calculate water usage (0.5 liters per minute is an example rate)
            const waterRate = 0.5; // Liters per minute
            const waterUsed = duration * waterRate;
            
            pumpEvents.push({
              id: activation._id,
              timestamp: activation.createdAt,
              endTime: endTime || new Date(activationTime + (duration * 60 * 1000)),
              duration: duration,
              mode: mode,
              zone: 'Khu vườn chính', 
              trigger: trigger,
              waterUsed: waterUsed  // Add waterUsed to the response
            });
          });
          
        } catch (error) {
          console.error('Error fetching pump events:', error);
        }
    }
    
    // Process daily averages from the collected data
    const processedSensorData = Object.values(sensorData).map(day => {
      // Calculate averages for each property if data exists
      const processed = {
        date: day.date
      };
      
      if (day.temperature && day.temperature.length > 0) {
        processed.temperature = parseFloat(
          (day.temperature.reduce((sum, val) => sum + val, 0) / day.temperature.length).toFixed(1)
        );
      }
      
      if (day.humidity && day.humidity.length > 0) {
        processed.humidity = parseFloat(
          (day.humidity.reduce((sum, val) => sum + val, 0) / day.humidity.length).toFixed(1)
        );
      }
      
      if (day.soilMoisture && day.soilMoisture.length > 0) {
        processed.soilMoisture = parseFloat(
          (day.soilMoisture.reduce((sum, val) => sum + val, 0) / day.soilMoisture.length).toFixed(1)
        );
      }
      
      return processed;
    });
    
    // Sort by date
    processedSensorData.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    return res.json({
      success: true,
      sensorData: processedSensorData,
      wateringEvents: pumpEvents
    });
    
  } catch (error) {
    console.error('Error fetching report data:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi tải dữ liệu báo cáo' });
  }
};

// PDF export functionality
exports.exportPDF = async (req, res) => {
  try {
      let { startDate, endDate, dataType } = req.query;
      
      // Set default values if dates are not provided
      if (!startDate) {
        // Default to 7 days ago
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        startDate = sevenDaysAgo.toISOString().split('T')[0];
      }
      
      if (!endDate) {
        // Default to today
        endDate = new Date().toISOString().split('T')[0];
      }
      
      if (!dataType) {
        // Default to all data types
        dataType = 'all';
      }
      
      // Now we have valid dates to work with
      console.log('PDF Export - Using dates:', { startDate, endDate, dataType });
      
      // Convert string dates to Date objects
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Include the entire end day
      
      // Base query for date range
      const dateQuery = { 
        createdAt: { 
          $gte: start, 
          $lte: end 
        } 
      };
      
      // Get data from the appropriate feed models
      const feedsToQuery = [];
      
      if (dataType === 'all' || dataType === 'temperature') {
        feedsToQuery.push('sensor-temp');
      }
      
      if (dataType === 'all' || dataType === 'humidity') {
        feedsToQuery.push('sensor-humidity');
      }
      
      if (dataType === 'all' || dataType === 'soil') {
        feedsToQuery.push('sensor-soil');
      }
      
      const pumpEventsNeeded = (dataType === 'all' || dataType === 'watering');
      
      // Fetch data from each feed model
      const sensorData = {};
      let pumpEvents = [];
      
      // Map collection names to property names
      const propertyMap = {
        'sensor-temp': 'temperature',
        'sensor-humidity': 'humidity',
        'sensor-soil': 'soilMoisture'
      };
      
      // Parallel fetch from all required feeds
      await Promise.all(feedsToQuery.map(async (feedName) => {
        try {
          // Fetch using model
          const FeedModel = getFeedModel(feedName);
          const readings = await FeedModel.find(dateQuery).sort('createdAt');
          
          // Process readings into daily groups
          readings.forEach(reading => {
            const date = reading.createdAt.toISOString().split('T')[0];
            if (!sensorData[date]) {
              sensorData[date] = { date };
            }
            
            const property = propertyMap[feedName];
            if (!sensorData[date][property]) {
              sensorData[date][property] = [];
            }
            
            const numValue = parseFloat(reading.value);
            if (!isNaN(numValue)) {
              sensorData[date][property].push(numValue);
            }
          });
        } catch (error) {
          console.error(`Error fetching ${feedName} data for PDF:`, error);
        }
      }));
      
      // Process daily averages from the collected data
      const processedSensorData = Object.values(sensorData).map(day => {
        // Calculate averages for each property if data exists
        const processed = {
          date: day.date
        };
        
        if (day.temperature && day.temperature.length > 0) {
          processed.temperature = parseFloat(
            (day.temperature.reduce((sum, val) => sum + val, 0) / day.temperature.length).toFixed(1)
          );
        }
        
        if (day.humidity && day.humidity.length > 0) {
          processed.humidity = parseFloat(
            (day.humidity.reduce((sum, val) => sum + val, 0) / day.humidity.length).toFixed(1)
          );
        }
        
        if (day.soilMoisture && day.soilMoisture.length > 0) {
          processed.soilMoisture = parseFloat(
            (day.soilMoisture.reduce((sum, val) => sum + val, 0) / day.soilMoisture.length).toFixed(1)
          );
        }
        
        return processed;
      });
      
      // Sort by date
      processedSensorData.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // Fetch pump events if needed
      if (pumpEventsNeeded) {
        try {
          const PumpModel = getFeedModel('pump-motor');
          const ModeModel = getFeedModel('mode');
          
          // Get all pump events within the date range
          const rawPumpEvents = await PumpModel.find(dateQuery).sort('createdAt');
          console.log(`Found ${rawPumpEvents.length} pump events for PDF`);
          
          // Get mode changes
          const modeChanges = await ModeModel.find(dateQuery).sort('createdAt');
          
          // Create a map of system mode by time
          const modeMap = {};
          modeChanges.forEach(change => {
            const timestamp = change.createdAt.getTime();
            modeMap[timestamp] = change.value;
          });
          
          // Sort timestamps for binary search
          const modeTimestamps = Object.keys(modeMap).map(Number).sort((a, b) => a - b);
          
          // Function to find the system mode at a given time
          const getModeAtTime = (time) => {
            let mode = 'unknown';
            
            if (modeTimestamps.length === 0) return mode;
            
            const timeMs = new Date(time).getTime();
            let left = 0;
            let right = modeTimestamps.length - 1;
            
            if (timeMs < modeTimestamps[0]) {
              return modeMap[modeTimestamps[0]] || 'unknown';
            }
            
            while (left <= right) {
              const mid = Math.floor((left + right) / 2);
              
              if (modeTimestamps[mid] <= timeMs) {
                left = mid + 1;
              } else {
                right = mid - 1;
              }
            }
            
            if (right >= 0) {
              mode = modeMap[modeTimestamps[right]] || 'unknown';
            }
            
            return mode;
          };
          
          // Group pump events
          const activations = [];
          const deactivations = [];
          
          rawPumpEvents.forEach(event => {
            if (event.value === '1') {
              activations.push(event);
            } else if (event.value === '0') {
              deactivations.push(event);
            }
          });
          
          // Process activations into watering events with durations
          pumpEvents = [];
          
          activations.forEach(activation => {
            const activationTime = new Date(activation.createdAt).getTime();
            let duration = 5; // Default 5 minutes
            let endTime = null;
            
            const matchingDeactivation = deactivations.find(deactivation => {
              const deactivationTime = new Date(deactivation.createdAt).getTime();
              return deactivationTime > activationTime;
            });
            
            if (matchingDeactivation) {
              const deactivationTime = new Date(matchingDeactivation.createdAt).getTime();
              duration = Math.round((deactivationTime - activationTime) / (1000 * 60));
              endTime = matchingDeactivation.createdAt;
              deactivations.splice(deactivations.indexOf(matchingDeactivation), 1);
            }
            
            const mode = getModeAtTime(activation.createdAt);
            const trigger = mode === '0' ? 'automatic' : 'manual';
            
            const waterRate = 0.5; // Liters per minute
            const waterUsed = duration * waterRate;
            
            pumpEvents.push({
              id: activation._id,
              timestamp: activation.createdAt,
              endTime: endTime || new Date(activationTime + (duration * 60 * 1000)),
              duration: duration,
              mode: mode,
              zone: 'Khu vườn chính',
              trigger: trigger,
              waterUsed: waterUsed
            });
          });
        } catch (error) {
          console.error('Error fetching pump events for PDF:', error);
        }
      }
      
      // Generate charts based on the collected data
      let temperatureChart = null;
      let humidityChart = null;
      let soilMoistureChart = null;
      let wateringChart = null;
      let waterDistributionChart = null;
      
      // Only generate charts if we have data
      if (processedSensorData && processedSensorData.length > 0) {
        // Check which data types exist in the processed data
        const hasTemperature = processedSensorData.some(day => day.temperature !== undefined);
        const hasHumidity = processedSensorData.some(day => day.humidity !== undefined);
        const hasSoilMoisture = processedSensorData.some(day => day.soilMoisture !== undefined);
        
        // Generate charts for each data type as needed
        if (hasTemperature && (dataType === 'all' || dataType === 'temperature')) {
          temperatureChart = await generateSensorChart(processedSensorData, 'temperature');
        }
        
        if (hasHumidity && (dataType === 'all' || dataType === 'humidity')) {
          humidityChart = await generateSensorChart(processedSensorData, 'humidity');
        }
        
        if (hasSoilMoisture && (dataType === 'all' || dataType === 'soil')) {
          soilMoistureChart = await generateSensorChart(processedSensorData, 'soilMoisture');
        }
      }
      
      // Generate watering charts if we have pump events data
      if (pumpEvents && pumpEvents.length > 0 && (dataType === 'all' || dataType === 'watering')) {
        wateringChart = await generateWateringChart(pumpEvents);
        waterDistributionChart = await generateWaterDistributionChart(pumpEvents);
      }
      
      // Create a PDF document with font embedding for Vietnamese
      const doc = new PDFDocument({ 
          margin: 50,
          autoFirstPage: true,
          bufferPages: true,
          size: 'A4',
          lang: 'vi-VN',
          info: {
            Title: 'Báo Cáo Hệ Thống Vườn Thông Minh',
            Author: 'Smart Garden System'
          }
      });
      
      // Register fonts for Vietnamese support
      doc.registerFont('Roboto', FONT_REGULAR);
      doc.registerFont('Roboto-Bold', FONT_BOLD);
      
      const fontName = 'Roboto';
      const fontNameBold = 'Roboto-Bold';
      
      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=garden-report-${start.toISOString().split('T')[0]}-to-${end.toISOString().split('T')[0]}.pdf`);
      
      // Pipe the PDF to the response
      doc.pipe(res);
      
      // 1. CẢI TIẾN TRANG BÌA
      // ----------------------
      
      // Tạo trang bìa đẹp hơn
      doc.rect(0, 0, doc.page.width, doc.page.height / 3).fill('#4975d1');

      // Tiêu đề trên nền màu
      doc.fillColor('#ffffff');
      doc.font(fontNameBold).fontSize(28)
         .text('BÁO CÁO', doc.page.width / 2 - 100, doc.page.height / 6, { align: 'center' });
      doc.font(fontNameBold).fontSize(24)
         .text('HỆ THỐNG VƯỜN THÔNG MINH', doc.page.width / 2 - 200, doc.page.height / 6 + 40, { align: 'center' });

      // Phần thông tin báo cáo
      doc.fillColor('#333333');
      doc.font(fontNameBold).fontSize(16)
         .text('THỜI GIAN BÁO CÁO', doc.page.width / 2 - 100, doc.page.height / 2 - 40, { align: 'center' });

      doc.font(fontName).fontSize(14)
         .text(`Từ: ${start.toLocaleDateString('vi-VN')}`, doc.page.width / 2 - 100, doc.page.height / 2, { align: 'center' });
      doc.text(`Đến: ${end.toLocaleDateString('vi-VN')}`, doc.page.width / 2 - 100, doc.page.height / 2 + 30, { align: 'center' });

      // Thêm ngày tạo báo cáo
      const today = new Date();
      doc.font(fontName).fontSize(12)
         .text(`Báo cáo được tạo vào: ${today.toLocaleDateString('vi-VN')}`, doc.page.width / 2 - 100, doc.page.height / 2 + 80, { align: 'center' });

      // Thêm đường kẻ chân trang
      doc.moveTo(50, doc.page.height - 100)
         .lineTo(doc.page.width - 50, doc.page.height - 100)
         .stroke('#cccccc');

      // Thêm thông tin chân trang
      doc.font(fontName).fontSize(10).fillColor('#666666')
         .text('Hệ thống vườn thông minh - Báo cáo tự động', 50, doc.page.height - 80);
      doc.text('© 2025 Smart Garden System', doc.page.width - 200, doc.page.height - 80);
      
      // 2. THÊM MỤC LỤC
      // ----------------
      
      doc.addPage();
      doc.font(fontNameBold).fontSize(20).fillColor('#333333')
         .text('MỤC LỤC', { align: 'center' });
      doc.moveDown(2);

      // Danh sách mục lục với số trang
      const tocItems = [
        { title: 'Tổng quan dữ liệu cảm biến', page: 3 },
        { title: 'Biểu đồ nhiệt độ', page: 4 },
        { title: 'Biểu đồ độ ẩm không khí', page: 5 },
        { title: 'Biểu đồ độ ẩm đất', page: 6 },
        { title: 'Lịch sử tưới nước', page: 7 },
        { title: 'Biểu đồ sử dụng nước', page: 8 },
        { title: 'Phân tích và nhận xét', page: 9 }
      ];

      tocItems.forEach((item, index) => {
        // Vẽ chấm trang đẹp hơn
        doc.font(fontNameBold).fontSize(12)
           .text(`${index + 1}. ${item.title}`, 70, null, { continued: true })
           .font(fontName)
           .font(fontNameBold)
           .text(` ${item.page}`, { align: 'right' });
        
        doc.moveDown(1);
      });
      
      // 3. CẢI TIẾN PHẦN BẢNG DỮ LIỆU
      // --------------------------
      
      doc.addPage();
      
      // Sensor data section với thiết kế đẹp hơn
      if (processedSensorData && processedSensorData.length > 0) {
          // Tiêu đề section với nền màu
          doc.rect(50, 50, doc.page.width - 100, 40).fill('#f2f7ff');
          doc.fillColor('#333333');
          doc.font(fontNameBold).fontSize(16)
             .text('DỮ LIỆU CẢM BIẾN', 50, 65, { align: 'center', width: doc.page.width - 100 });
            
          doc.moveDown(2);
          
          const tableWidth = doc.page.width - 100;
          const colWidth = tableWidth / 4;
          const rowHeight = 30;
          const startX = 50;
          let startY = doc.y;
          
          // Header row with background color
          doc.rect(startX, startY, tableWidth, rowHeight).fill('#4975d1');
          doc.fillColor('#ffffff');
          doc.font(fontNameBold).fontSize(12);
          
          // Header columns
          doc.text('Ngày', startX + 10, startY + 10, { width: colWidth - 20 });
          doc.text('Nhiệt Độ (°C)', startX + colWidth + 10, startY + 10, { width: colWidth - 20 });
          doc.text('Độ Ẩm (%)', startX + 2 * colWidth + 10, startY + 10, { width: colWidth - 20 });
          doc.text('Độ Ẩm Đất (%)', startX + 3 * colWidth + 10, startY + 10, { width: colWidth - 20 });
          
          startY += rowHeight;
          
          // Vẽ các dòng dữ liệu
          processedSensorData.forEach((day, index) => {
              // Màu nền xen kẽ cho các dòng
              doc.rect(startX, startY, tableWidth, rowHeight).fill(index % 2 === 0 ? '#f8f8f8' : '#ffffff');
              doc.fillColor('#333333');
              doc.font(fontName).fontSize(11);
              
              // Hiển thị dữ liệu
              doc.text(new Date(day.date).toLocaleDateString('vi-VN'), startX + 10, startY + 10);
              doc.text(day.temperature !== undefined ? day.temperature.toString() : '-', startX + colWidth + 10, startY + 10);
              doc.text(day.humidity !== undefined ? day.humidity.toString() : '-', startX + 2 * colWidth + 10, startY + 10);
              doc.text(day.soilMoisture !== undefined ? day.soilMoisture.toString() : '-', startX + 3 * colWidth + 10, startY + 10);
              
              startY += rowHeight;
              
              // Thêm trang mới nếu cần thiết
              if (startY > doc.page.height - 100 && index < processedSensorData.length - 1) {
                  doc.addPage();
                  startY = 50;
                  
                  // Thêm lại header khi sang trang mới
                  doc.rect(startX, startY, tableWidth, rowHeight).fill('#4975d1');
                  doc.fillColor('#ffffff');
                  doc.font(fontNameBold).fontSize(12);
                  
                  doc.text('Ngày', startX + 10, startY + 10, { width: colWidth - 20 });
                  doc.text('Nhiệt Độ (°C)', startX + colWidth + 10, startY + 10, { width: colWidth - 20 });
                  doc.text('Độ Ẩm (%)', startX + 2 * colWidth + 10, startY + 10, { width: colWidth - 20 });
                  doc.text('Độ Ẩm Đất (%)', startX + 3 * colWidth + 10, startY + 10, { width: colWidth - 20 });
                  
                  startY += rowHeight;
              }
          });
          
      } else {
          doc.moveDown(4);
          doc.rect(50, doc.y, doc.page.width - 100, 60).fill('#f9f9f9');
          doc.fillColor('#666666');
          doc.font(fontName).fontSize(14)
             .text('Không có dữ liệu cảm biến trong khoảng thời gian này.', { align: 'center' });
      }
      
      // 4. CẢI TIẾN PHẦN BIỂU ĐỒ
      // ----------------------
      
      // Add temperature chart with improved layout
      if (temperatureChart) {
        doc.addPage();
        
        // Tạo header cho trang biểu đồ
        doc.rect(50, 50, doc.page.width - 100, 40).fill('#f2f7ff');
        doc.fillColor('#333333');
        doc.font(fontNameBold).fontSize(16)
           .text('BIỂU ĐỒ NHIỆT ĐỘ', 50, 65, { align: 'center', width: doc.page.width - 100 });
        
        // Thêm khoảng cách giữa tiêu đề và biểu đồ
        const chartY = 120;
        
        // Vẽ khung chứa biểu đồ để tạo viền trắng xung quanh
        doc.rect(75, chartY - 10, 450, 320).fill('#ffffff').stroke('#e0e0e0');
        
        // Chèn biểu đồ vào khung
        doc.image(temperatureChart, {
          x: 75,
          y: chartY,
          fit: [450, 300],
          align: 'center'
        });
        
        // Thêm chú thích dưới biểu đồ với khoảng cách đủ
        doc.font(fontName).fontSize(12)
           .fillColor('#555555')
           .text('Biểu đồ trên thể hiện sự biến đổi nhiệt độ theo thời gian trong khoảng thời gian báo cáo.', 
                 75, chartY + 320, { align: 'center', width: 450 });
      }
      
      // Add humidity chart with improved layout
      if (humidityChart) {
        doc.addPage();
        
        // Tạo header cho trang biểu đồ
        doc.rect(50, 50, doc.page.width - 100, 40).fill('#f2f7ff');
        doc.fillColor('#333333');
        doc.font(fontNameBold).fontSize(16)
           .text('BIỂU ĐỒ ĐỘ ẨM KHÔNG KHÍ', 50, 65, { align: 'center', width: doc.page.width - 100 });
        
        // Thêm khoảng cách giữa tiêu đề và biểu đồ
        const chartY = 120;
        
        // Vẽ khung chứa biểu đồ để tạo viền trắng xung quanh
        doc.rect(75, chartY - 10, 450, 320).fill('#ffffff').stroke('#e0e0e0');
        
        // Chèn biểu đồ vào khung
        doc.image(humidityChart, {
          x: 75,
          y: chartY,
          fit: [450, 300],
          align: 'center'
        });
        
        // Thêm chú thích dưới biểu đồ với khoảng cách đủ
        doc.font(fontName).fontSize(12)
           .fillColor('#555555')
           .text('Biểu đồ trên thể hiện sự biến đổi độ ẩm không khí theo thời gian trong khoảng thời gian báo cáo.', 
                 75, chartY + 320, { align: 'center', width: 450 });
      }
      
      // Add soil moisture chart with improved layout
      if (soilMoistureChart) {
        doc.addPage();
        
        // Tạo header cho trang biểu đồ
        doc.rect(50, 50, doc.page.width - 100, 40).fill('#f2f7ff');
        doc.fillColor('#333333');
        doc.font(fontNameBold).fontSize(16)
           .text('BIỂU ĐỒ ĐỘ ẨM ĐẤT', 50, 65, { align: 'center', width: doc.page.width - 100 });
        
        // Thêm khoảng cách giữa tiêu đề và biểu đồ
        const chartY = 120;
        
        // Vẽ khung chứa biểu đồ để tạo viền trắng xung quanh
        doc.rect(75, chartY - 10, 450, 320).fill('#ffffff').stroke('#e0e0e0');
        
        // Chèn biểu đồ vào khung
        doc.image(soilMoistureChart, {
          x: 75,
          y: chartY,
          fit: [450, 300],
          align: 'center'
        });
        
        // Thêm chú thích dưới biểu đồ với khoảng cách đủ
        doc.font(fontName).fontSize(12)
           .fillColor('#555555')
           .text('Biểu đồ trên thể hiện sự biến đổi độ ẩm đất theo thời gian trong khoảng thời gian báo cáo.', 
                 75, chartY + 320, { align: 'center', width: 450 });
      }
      
      // 5. CẢI TIẾN PHẦN LỊCH SỬ TƯỚI NƯỚC
      // -----------------------------
      
      // Watering events section with improved layout
      if (pumpEvents && pumpEvents.length > 0) {
        doc.addPage();
        
        // Tiêu đề section với nền màu
        doc.rect(50, 50, doc.page.width - 100, 40).fill('#f2f7ff');
        doc.fillColor('#333333');
        doc.font(fontNameBold).fontSize(16)
           .text('LỊCH SỬ TƯỚI NƯỚC', 50, 65, { align: 'center', width: doc.page.width - 100 });
        
        doc.moveDown(2);
        
        // Vẽ bảng đẹp hơn
        const tableWidth = doc.page.width - 100;
        const colWidth = tableWidth / 4;
        const rowHeight = 40; // Cao hơn để chứa thời gian
        const startX = 50;
        let startY = doc.y;
        
        // Vẽ header bảng
        doc.rect(startX, startY, tableWidth, rowHeight).fill('#4975d1');
        doc.fillColor('#ffffff');
        doc.font(fontNameBold).fontSize(11);
        
        // Header columns
        doc.text('Thời Gian', startX + 10, startY + 15, { width: colWidth - 20 });
        doc.text('Thời Lượng (phút)', startX + colWidth + 10, startY + 15, { width: colWidth - 20 });
        doc.text('Khu Vực', startX + 2 * colWidth + 10, startY + 15, { width: colWidth - 20 });
        doc.text('Lượng Nước (lít)', startX + 3 * colWidth + 10, startY + 15, { width: colWidth - 20 });
        
        startY += rowHeight;
        
        // Vẽ các dòng dữ liệu
        pumpEvents.forEach((event, index) => {
          // Màu nền xen kẽ cho các dòng
          doc.rect(startX, startY, tableWidth, rowHeight).fill(index % 2 === 0 ? '#f8f8f8' : '#ffffff');
          doc.fillColor('#333333');
          doc.font(fontName).fontSize(10);
          
          // Hiển thị dữ liệu
          doc.text(new Date(event.timestamp).toLocaleString('vi-VN'), startX + 10, startY + 15);
          doc.text(event.duration.toString(), startX + colWidth + 10, startY + 15);
          doc.text(event.zone, startX + 2 * colWidth + 10, startY + 15);
          doc.text(event.waterUsed.toFixed(1), startX + 3 * colWidth + 10, startY + 15);
          
          startY += rowHeight;
          
          // Thêm trang mới nếu cần thiết
          if (startY > doc.page.height - 100 && index < pumpEvents.length - 1) {
              doc.addPage();
              startY = 50;
              
              // Thêm lại header khi sang trang mới
              doc.rect(startX, startY, tableWidth, rowHeight).fill('#4975d1');
              doc.fillColor('#ffffff');
              doc.font(fontNameBold).fontSize(11);
              
              doc.text('Thời Gian', startX + 10, startY + 15, { width: colWidth - 20 });
              doc.text('Thời Lượng (phút)', startX + colWidth + 10, startY + 15, { width: colWidth - 20 });
              doc.text('Khu Vực', startX + 2 * colWidth + 10, startY + 15, { width: colWidth - 20 });
              doc.text('Lượng Nước (lít)', startX + 3 * colWidth + 10, startY + 15, { width: colWidth - 20 });
              
              startY += rowHeight;
          }
        });
        
        // Viền cho bảng
        doc.rect(startX, doc.y - (Math.min(pumpEvents.length, 10) * rowHeight), tableWidth, Math.min(pumpEvents.length, 10) * rowHeight)
           .lineWidth(1)
           .stroke('#cccccc');
        
        // Summary of water usage
        doc.moveDown(2);
        const totalWater = pumpEvents.reduce((sum, event) => sum + event.waterUsed, 0);
        
        // Lưu vị trí Y hiện tại
        const boxY = doc.y;
        
        // Tạo box tổng kết
        doc.rect(doc.page.width/2 - 100, boxY, 200, 40)
           .fill('#eff8ff')
           .lineWidth(1)
           .stroke('#4975d1');
        
        // Đặt text trong box với vị trí y = boxY + 15 (để căn giữa theo chiều dọc)
        doc.fillColor('#333333');
        doc.font(fontNameBold).fontSize(12)
           .text(`Tổng Lượng Nước: ${totalWater.toFixed(1)} lít`, 
                 doc.page.width/2 - 90, 
                 boxY + 15, 
                 { width: 180, align: 'center' });
        
        // Add watering charts
        if (wateringChart) {
          doc.addPage();
          
          // Tạo header cho trang biểu đồ
          doc.rect(50, 50, doc.page.width - 100, 40).fill('#f2f7ff');
          doc.fillColor('#333333');
          doc.font(fontNameBold).fontSize(16)
             .text('BIỂU ĐỒ TƯỚI NƯỚC THEO NGÀY', 50, 65, { align: 'center', width: doc.page.width - 100 });
          
          const chartY = 120;
          doc.rect(75, chartY - 10, 450, 320).fill('#ffffff').stroke('#e0e0e0');
          
          doc.image(wateringChart, {
            x: 75,
            y: chartY,
            fit: [450, 300],
            align: 'center'
          });
          
          doc.font(fontName).fontSize(12)
             .fillColor('#555555')
             .text('Biểu đồ trên thể hiện lượng nước sử dụng và thời gian tưới theo từng ngày.', 
                   75, chartY + 320, { align: 'center', width: 450 });
        }
        
        if (waterDistributionChart) {
          doc.addPage();
          
          // Tạo header cho trang biểu đồ
          doc.rect(50, 50, doc.page.width - 100, 40).fill('#f2f7ff');
          doc.fillColor('#333333');
          doc.font(fontNameBold).fontSize(16)
             .text('PHÂN BỐ SỬ DỤNG NƯỚC THEO KHU VỰC', 50, 65, { align: 'center', width: doc.page.width - 100 });
          
          const chartY = 120;
          doc.rect(100, chartY - 10, 400, 400).fill('#ffffff').stroke('#e0e0e0');
          
          doc.image(waterDistributionChart, {
            x: 100,
            y: chartY,
            fit: [400, 400],
            align: 'center'
          });
          
          doc.font(fontName).fontSize(12)
             .fillColor('#555555')
             .text('Biểu đồ trên thể hiện tỷ lệ sử dụng nước của từng khu vực.', 
                   75, chartY + 410, { align: 'center', width: 450 });
        }
      } else if (dataType === 'all' || dataType === 'watering') {
        if (processedSensorData && processedSensorData.length > 0) {
            doc.addPage();
        }
        
        // Tiêu đề section với nền màu
        doc.rect(50, 50, doc.page.width - 100, 40).fill('#f2f7ff');
        doc.fillColor('#333333');
        doc.font(fontNameBold).fontSize(16)
           .text('LỊCH SỬ TƯỚI NƯỚC', 50, 65, { align: 'center', width: doc.page.width - 100 });
        
        doc.moveDown(4);
        doc.rect(50, doc.y, doc.page.width - 100, 60).fill('#f9f9f9');
        doc.fillColor('#666666');
        doc.font(fontName).fontSize(14)
           .text('Không có dữ liệu tưới nước trong khoảng thời gian này.', { align: 'center' });
      }
      
      // 6. CẢI TIẾN PHẦN PHÂN TÍCH & NHẬN XÉT
      // ---------------------------------
      
      // Add statistical analysis page with improved layout
      // 6. CẢI TIẾN PHẦN PHÂN TÍCH & NHẬN XÉT
      // ---------------------------------

      // Add statistical analysis page with improved layout
      doc.addPage();
      doc.font(fontNameBold).fontSize(18).fillColor('#333333')
        .text('PHÂN TÍCH & NHẬN XÉT', { align: 'center' });

      // Tạo header đẹp cho phần thống kê - SỬA LỖI TRÙNG CHỮ
      doc.moveDown(1);
      const statsHeaderY = doc.y;
      doc.rect(50, statsHeaderY, doc.page.width - 100, 40).fill('#f2f7ff');
      doc.fillColor('#333333');
      doc.font(fontNameBold).fontSize(14)
        .text('Thống Kê Chỉ Số', 60, statsHeaderY + 15);
        
      // Thêm khoảng cách sau header
      doc.moveDown(2);
              
      // Create statistics table data
      const statTable = {
        headers: ['Chỉ số', 'Giá trị trung bình', 'Giá trị thấp nhất', 'Giá trị cao nhất'],
        rows: []
      };

      if (processedSensorData && processedSensorData.length > 0) {
        // Temperature statistics
        const tempValues = processedSensorData
          .filter(day => day.temperature !== undefined)
          .map(day => day.temperature);
          
        if (tempValues.length > 0) {
          const avgTemp = (tempValues.reduce((sum, val) => sum + val, 0) / tempValues.length).toFixed(1);
          const minTemp = Math.min(...tempValues).toFixed(1);
          const maxTemp = Math.max(...tempValues).toFixed(1);
          statTable.rows.push(['Nhiệt độ (°C)', avgTemp, minTemp, maxTemp]);
        }
        
        // Humidity statistics
        const humValues = processedSensorData
          .filter(day => day.humidity !== undefined)
          .map(day => day.humidity);
          
        if (humValues.length > 0) {
          const avgHum = (humValues.reduce((sum, val) => sum + val, 0) / humValues.length).toFixed(1);
          const minHum = Math.min(...humValues).toFixed(1);
          const maxHum = Math.max(...humValues).toFixed(1);
          statTable.rows.push(['Độ ẩm không khí (%)', avgHum, minHum, maxHum]);
        }
        
        // Soil moisture statistics
        const soilValues = processedSensorData
          .filter(day => day.soilMoisture !== undefined)
          .map(day => day.soilMoisture);
          
        if (soilValues.length > 0) {
          const avgSoil = (soilValues.reduce((sum, val) => sum + val, 0) / soilValues.length).toFixed(1);
          const minSoil = Math.min(...soilValues).toFixed(1);
          const maxSoil = Math.max(...soilValues).toFixed(1);
          statTable.rows.push(['Độ ẩm đất (%)', avgSoil, minSoil, maxSoil]);
        }
      }

      if (pumpEvents && pumpEvents.length > 0) {
        const totalEvents = pumpEvents.length;
        const totalWater = pumpEvents.reduce((sum, event) => sum + event.waterUsed, 0).toFixed(1);
        const totalDuration = pumpEvents.reduce((sum, event) => sum + event.duration, 0);
        const avgDuration = (totalDuration / totalEvents).toFixed(1);
        
        statTable.rows.push(['Số lần tưới', totalEvents.toString(), '', '']);
        statTable.rows.push(['Tổng lượng nước (lít)', totalWater, '', '']);
        statTable.rows.push(['Thời gian tưới TB (phút)', avgDuration, '', '']);
      }

      // Vẽ bảng thống kê đẹp hơn
      const tableWidth = doc.page.width - 100;
      const colWidth = tableWidth / 4;
      const rowHeight = 35;
      const startX = 50;
      let startY = doc.y;

      // Vẽ header của bảng
      doc.rect(startX, startY, tableWidth, rowHeight).fill('#4975d1');
      doc.fillColor('#ffffff');
      doc.font(fontNameBold).fontSize(12);
      statTable.headers.forEach((header, i) => {
        doc.text(header, startX + (i * colWidth) + 10, startY + 12, { width: colWidth - 20, align: 'center' });
      });

      // Vẽ các dòng dữ liệu
      startY += rowHeight;
      doc.font(fontName).fontSize(11);

      statTable.rows.forEach((row, rowIndex) => {
        // Màu nền xen kẽ cho các hàng
        doc.rect(startX, startY, tableWidth, rowHeight).fill(rowIndex % 2 === 0 ? '#f8f8f8' : '#ffffff');
        doc.fillColor('#333333');
        
        // Dữ liệu từng cột
        row.forEach((cell, cellIndex) => {
          doc.text(cell, startX + (cellIndex * colWidth) + 10, startY + 12, { width: colWidth - 20, align: 'center' });
        });
        
        startY += rowHeight;
      });

      // Viền bảng
      doc.rect(startX, startY - (statTable.rows.length + 1) * rowHeight, tableWidth, (statTable.rows.length + 1) * rowHeight)
        .lineWidth(1)
        .stroke('#cccccc');

      // Thêm khoảng cách trước phần nhận xét
      doc.moveDown(3);

      // Sửa lỗi header phần nhận xét
      const commentsHeaderY = doc.y;
      doc.rect(50, commentsHeaderY, doc.page.width - 100, 40).fill('#f2f7ff');
      doc.fillColor('#333333');
      doc.font(fontNameBold).fontSize(14)
        .text('Nhận Xét & Khuyến Nghị', 60, commentsHeaderY + 15);
        
      // Thêm khoảng cách sau header
      doc.moveDown(2);

      // Generate comments based on the data
      const comments = [];

      if (processedSensorData && processedSensorData.length > 0) {
        const tempValues = processedSensorData
          .filter(day => day.temperature !== undefined)
          .map(day => day.temperature);
          
        if (tempValues.length > 0) {
          const avgTemp = (tempValues.reduce((sum, val) => sum + val, 0) / tempValues.length);
          
          if (avgTemp > 30) {
            comments.push('- Nhiệt độ trung bình cao (> 30°C) có thể gây stress cho cây trồng. Nên tăng tần suất tưới nước và cân nhắc che nắng.');
          } else if (avgTemp < 20) {
            comments.push('- Nhiệt độ trung bình thấp (< 20°C) có thể làm chậm quá trình phát triển của một số loại cây. Nên giảm lượng nước tưới.');
          } else {
            comments.push('- Nhiệt độ duy trì ở mức phù hợp cho sự phát triển của cây trồng.');
          }
        }
        
        const soilValues = processedSensorData
          .filter(day => day.soilMoisture !== undefined)
          .map(day => day.soilMoisture);
          
        if (soilValues.length > 0) {
          const avgSoil = (soilValues.reduce((sum, val) => sum + val, 0) / soilValues.length);
          
          if (avgSoil < 40) {
            comments.push('- Độ ẩm đất trung bình thấp (< 40%). Cần tăng lượng nước và thời gian tưới.');
          } else if (avgSoil > 75) {
            comments.push('- Độ ẩm đất trung bình cao (> 75%). Cần giảm lượng nước tưới để tránh úng.');
          } else {
            comments.push('- Độ ẩm đất duy trì ở mức phù hợp cho cây trồng.');
          }
        }
      }

      // Add watering-related comments
      if (pumpEvents && pumpEvents.length > 0) {
        const totalEvents = pumpEvents.length;
        const daysInReport = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        const eventsPerDay = totalEvents / daysInReport;
        
        if (eventsPerDay > 3) {
          comments.push('- Tần suất tưới nước cao (> 3 lần/ngày). Nên xem xét tăng thời gian tưới mỗi lần và giảm số lần tưới.');
        } else if (eventsPerDay < 1) {
          comments.push('- Tần suất tưới nước thấp (< 1 lần/ngày). Cần đảm bảo cây nhận đủ nước, đặc biệt trong thời tiết nắng nóng.');
        }
        
        // Calculate automatic vs. manual watering stats
        const autoEvents = pumpEvents.filter(e => e.trigger === 'automatic').length;
        const manualEvents = totalEvents - autoEvents;
        const autoPercent = (autoEvents / totalEvents * 100).toFixed(0);
        
        comments.push(`- ${autoPercent}% lần tưới nước được thực hiện tự động, ${100-autoPercent}% thủ công.`);
      }

      // Add general recommendations
      comments.push('- Nên theo dõi thường xuyên độ ẩm đất để đảm bảo cây được tưới đúng lúc, tránh lãng phí nước.');
      comments.push('- Cập nhật ngưỡng tưới tự động theo mùa và loại cây trồng để tối ưu hiệu quả sử dụng nước.');
      comments.push('- Theo dõi sự kết hợp giữa nhiệt độ và độ ẩm để điều chỉnh chế độ tưới phù hợp với điều kiện môi trường.');

      // Tạo box màu nhẹ chứa nhận xét
      doc.rect(50, doc.y, doc.page.width - 100, comments.length * 30 + 20)
        .fillAndStroke('#f9f9f9', '#e0e0e0');

      // Thêm nhận xét với bullet points và định dạng rõ ràng
      doc.moveDown(0.5);

      // Theo dõi vị trí Y của bullet point
      let bulletY = doc.y + 6;

      comments.forEach((comment, index) => {
        // Màu của bullet tùy theo loại nhận xét
        let bulletColor = '#4975d1'; // màu mặc định
        
        if (comment.includes('cao') || comment.includes('thấp') || comment.includes('tăng') || comment.includes('giảm')) {
          bulletColor = comment.includes('cao') || comment.includes('tăng') ? '#e74c3c' : '#27ae60';
        }
        
        // Vẽ bullet point ở vị trí chính xác
        doc.fillColor(bulletColor);
        doc.circle(60, bulletY, 4).fill();
        
        // Đặt văn bản ở bên phải bullet point
        doc.fillColor('#333333');
        doc.font(fontName).fontSize(11);
        
        // Loại bỏ dấu gạch đầu dòng từ nội dung và định dạng lại
        const cleanComment = comment.replace(/^[- ]+/, '');
        doc.text(cleanComment, 75, bulletY - 5, { width: doc.page.width - 130 });
        
        // Cập nhật vị trí Y cho bullet point tiếp theo
        doc.moveDown(0.8);
        bulletY = doc.y + 6;
      });

      // Thêm phần kết luận với nền màu nhẹ
      doc.moveDown();

      // Sử dụng vị trí Y chính xác để vẽ box kết luận
      const conclusionY = doc.y;
      doc.rect(50, conclusionY, doc.page.width - 100, 80).fill('#eff8ff');

      // Thêm tiêu đề kết luận
      doc.fillColor('#333333');
      doc.font(fontNameBold).fontSize(12)
        .text('Kết luận:', 60, conclusionY + 15);
        
      // Thêm nội dung kết luận
      doc.font(fontName).fontSize(11)
        .text('Dựa trên dữ liệu thu thập và phân tích, hệ thống vườn thông minh đang hoạt động hiệu quả. Việc tiếp tục theo dõi các chỉ số môi trường và điều chỉnh lịch tưới nước theo mùa sẽ giúp tối ưu hóa sức khỏe cây trồng và tiết kiệm tài nguyên nước.', 
              60, conclusionY + 35, { width: doc.page.width - 120 });
      
      // Kết thúc tài liệu PDF
      doc.end();
      
  } catch (error) {
      console.error('Error exporting PDF:', error);
      if (!res.headersSent) {
          res.status(500).json({ 
              success: false, 
              message: 'Lỗi khi xuất báo cáo PDF',
              error: error.message
          });
      } else {
          // If headers were already sent, we can't send a JSON response
          console.error('Headers already sent, cannot send error response');
      }
  }
};

// CSV Export functionality
exports.exportCSV = async (req, res) => {
  try {
      let { startDate, endDate, dataType } = req.query;
      
      // Set default values if dates are not provided
      if (!startDate) {
        // Default to 7 days ago
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        startDate = sevenDaysAgo.toISOString().split('T')[0];
      }
      
      if (!endDate) {
        // Default to today
        endDate = new Date().toISOString().split('T')[0];
      }
      
      if (!dataType) {
        // Default to all data types
        dataType = 'all';
      }
      
      // Convert string dates to Date objects
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Include the entire end day
      
      // Base query for date range
      const dateQuery = { 
        createdAt: { 
          $gte: start, 
          $lte: end 
        } 
      };
      
      // Get data from the appropriate feed models
      const feedsToQuery = [];
      
      if (dataType === 'all' || dataType === 'temperature') {
        feedsToQuery.push('sensor-temp');
      }
      
      if (dataType === 'all' || dataType === 'humidity') {
        feedsToQuery.push('sensor-humidity');
      }
      
      if (dataType === 'all' || dataType === 'soil') {
        feedsToQuery.push('sensor-soil');
      }
      
      const pumpEventsNeeded = (dataType === 'all' || dataType === 'watering');
      
      // Fetch data from each feed model
      const sensorData = {};
      let pumpEvents = [];
      
      // Map collection names to property names
      const propertyMap = {
        'sensor-temp': 'temperature',
        'sensor-humidity': 'humidity',
        'sensor-soil': 'soilMoisture'
      };
      
      // Parallel fetch from all required feeds
      await Promise.all(feedsToQuery.map(async (feedName) => {
        try {
          // Fetch using model
          const FeedModel = getFeedModel(feedName);
          const readings = await FeedModel.find(dateQuery).sort('createdAt');
          
          // Process readings into daily groups
          readings.forEach(reading => {
            const date = reading.createdAt.toISOString().split('T')[0];
            if (!sensorData[date]) {
              sensorData[date] = { date };
            }
            
            const property = propertyMap[feedName];
            if (!sensorData[date][property]) {
              sensorData[date][property] = [];
            }
            
            const numValue = parseFloat(reading.value);
            if (!isNaN(numValue)) {
              sensorData[date][property].push(numValue);
            }
          });
        } catch (error) {
          console.error(`Error fetching ${feedName} data for CSV:`, error);
        }
      }));
      
      // Process daily averages from the collected data
      let processedSensorData = Object.values(sensorData).map(day => {
        // Calculate averages for each property if data exists
        const processed = {
          date: day.date
        };
        
        if (day.temperature && day.temperature.length > 0) {
          processed.temperature = parseFloat(
            (day.temperature.reduce((sum, val) => sum + val, 0) / day.temperature.length).toFixed(1)
          );
        }
        
        if (day.humidity && day.humidity.length > 0) {
          processed.humidity = parseFloat(
            (day.humidity.reduce((sum, val) => sum + val, 0) / day.humidity.length).toFixed(1)
          );
        }
        
        if (day.soilMoisture && day.soilMoisture.length > 0) {
          processed.soilMoisture = parseFloat(
            (day.soilMoisture.reduce((sum, val) => sum + val, 0) / day.soilMoisture.length).toFixed(1)
          );
        }
        
        return processed;
      });
      
      // Sort by date
      processedSensorData.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // Fetch pump events if needed
      if (pumpEventsNeeded) {
        try {
          const PumpModel = getFeedModel('pump-motor');
          const ModeModel = getFeedModel('mode');
          
          // Get all pump events within the date range
          const rawPumpEvents = await PumpModel.find(dateQuery).sort('createdAt');
          
          // Get mode changes
          const modeChanges = await ModeModel.find(dateQuery).sort('createdAt');
          
          // Create a map of system mode by time
          const modeMap = {};
          modeChanges.forEach(change => {
            const timestamp = change.createdAt.getTime();
            modeMap[timestamp] = change.value;
          });
          
          // Sort timestamps for binary search
          const modeTimestamps = Object.keys(modeMap).map(Number).sort((a, b) => a - b);
          
          // Function to find the system mode at a given time
          const getModeAtTime = (time) => {
            let mode = 'unknown';
            
            if (modeTimestamps.length === 0) return mode;
            
            const timeMs = new Date(time).getTime();
            let left = 0;
            let right = modeTimestamps.length - 1;
            
            if (timeMs < modeTimestamps[0]) {
              return modeMap[modeTimestamps[0]] || 'unknown';
            }
            
            while (left <= right) {
              const mid = Math.floor((left + right) / 2);
              
              if (modeTimestamps[mid] <= timeMs) {
                left = mid + 1;
              } else {
                right = mid - 1;
              }
            }
            
            if (right >= 0) {
              mode = modeMap[modeTimestamps[right]] || 'unknown';
            }
            
            return mode;
          };
          
          // Group pump events
          const activations = [];
          const deactivations = [];
          
          rawPumpEvents.forEach(event => {
            if (event.value === '1') {
              activations.push(event);
            } else if (event.value === '0') {
              deactivations.push(event);
            }
          });
          
          // Process activations into watering events with durations
          pumpEvents = [];
          
          activations.forEach(activation => {
            const activationTime = new Date(activation.createdAt).getTime();
            let duration = 5; // Default 5 minutes
            let endTime = null;
            
            const matchingDeactivation = deactivations.find(deactivation => {
              const deactivationTime = new Date(deactivation.createdAt).getTime();
              return deactivationTime > activationTime;
            });
            
            if (matchingDeactivation) {
              const deactivationTime = new Date(matchingDeactivation.createdAt).getTime();
              duration = Math.round((deactivationTime - activationTime) / (1000 * 60));
              endTime = matchingDeactivation.createdAt;
              deactivations.splice(deactivations.indexOf(matchingDeactivation), 1);
            }
            
            const mode = getModeAtTime(activation.createdAt);
            const trigger = mode === '0' ? 'automatic' : 'manual';
            
            const waterRate = 0.5; // Liters per minute
            const waterUsed = duration * waterRate;
            
            pumpEvents.push({
              timestamp: activation.createdAt.toISOString(),
              endTime: (endTime || new Date(activationTime + (duration * 60 * 1000))).toISOString(),
              duration: duration,
              mode: mode,
              zone: 'Khu vườn chính',
              trigger: trigger,
              waterUsed: waterUsed
            });
          });
        } catch (error) {
          console.error('Error fetching pump events for CSV:', error);
        }
      }
      
      // Format the sensor data for CSV export (with friendly date display)
      if (processedSensorData.length > 0) {
        processedSensorData = processedSensorData.map(day => ({
          date: new Date(day.date).toLocaleDateString('vi-VN'),
          temperature: day.temperature !== undefined ? day.temperature : '',
          humidity: day.humidity !== undefined ? day.humidity : '',
          soilMoisture: day.soilMoisture !== undefined ? day.soilMoisture : ''
        }));
      }
      
      // Format pump events for CSV export
      if (pumpEvents.length > 0) {
        pumpEvents = pumpEvents.map(event => ({
          timestamp: new Date(event.timestamp).toLocaleString('vi-VN'),
          duration: event.duration,
          zone: event.zone,
          trigger: event.trigger === 'automatic' ? 'Tự động' : 'Thủ công',
          waterUsed: event.waterUsed.toFixed(1)
        }));
      }
      
      // Create CSV based on data type
      let csvData = '';
      let csvFields = [];
      
      // Generate different CSV files based on dataType
      if ((dataType === 'all' || dataType === 'temperature' || 
           dataType === 'humidity' || dataType === 'soil') && 
           processedSensorData.length > 0) {
          
          // Vietnamese field headers for sensor data
          csvFields = [
            { label: 'Ngày', value: 'date' },
            { label: 'Nhiệt độ (°C)', value: 'temperature' },
            { label: 'Độ ẩm không khí (%)', value: 'humidity' },
            { label: 'Độ ẩm đất (%)', value: 'soilMoisture' }
          ];
          
          const opts = { 
            fields: csvFields,
            withBOM: true // Include BOM for Excel to correctly display Vietnamese
          };
          
          try {
              const parser = new Parser(opts);
              csvData = parser.parse(processedSensorData);
          } catch (err) {
              console.error('Error parsing sensor data to CSV:', err);
          }
      }
      else if ((dataType === 'all' || dataType === 'watering') && pumpEvents.length > 0) {
          // Vietnamese field headers for watering events
          csvFields = [
            { label: 'Thời gian', value: 'timestamp' },
            { label: 'Thời lượng (phút)', value: 'duration' },
            { label: 'Khu vực', value: 'zone' },
            { label: 'Kiểu kích hoạt', value: 'trigger' },
            { label: 'Lượng nước (lít)', value: 'waterUsed' }
          ];
          
          const opts = { 
            fields: csvFields,
            withBOM: true // Include BOM for Excel to correctly display Vietnamese
          };
          
          try {
              const parser = new Parser(opts);
              csvData = parser.parse(pumpEvents);
          } catch (err) {
              console.error('Error parsing watering events to CSV:', err);
          }
      }
      else {
          // No data available
          csvData = 'Không có dữ liệu trong khoảng thời gian đã chọn';
      }
      
      // Set response headers for CSV download
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=garden-report-${startDate}-to-${endDate}.csv`);
      
      // Send the CSV data
      return res.send(csvData);
      
  } catch (error) {
      console.error('Error exporting CSV:', error);
      res.status(500).json({ 
          success: false, 
          message: 'Lỗi khi xuất báo cáo CSV',
          error: error.message
      });
  }
};