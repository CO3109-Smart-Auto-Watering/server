const Schedule = require('../models/Schedule');
const schedule = require('node-schedule');
const axios = require('axios');

// Adafruit API details
const AIO_USERNAME = process.env.AIO_USERNAME;
const AIO_KEY = process.env.AIO_KEY;
const SCHEDULE_FEED = 'schedule-status';

// Store active schedule jobs
const activeJobs = {};

// Cập nhật hàm sendToAdafruit để chỉ định thiết bị
const sendToAdafruit = async (value, deviceId) => {
  try {
    const url = `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds/${SCHEDULE_FEED}/data`;
    // Format dữ liệu với deviceId: value
    const dataValue = `${deviceId}:${value}`;
    
    await axios.post(
      url, 
      { value: dataValue },
      { headers: { "X-AIO-Key": AIO_KEY } }
    );
    
    console.log(`Sent ${dataValue} to Adafruit IO (${SCHEDULE_FEED})`);
    return true;
  } catch (error) {
    console.error('Error sending data to Adafruit:', error);
    return false;
  }
};

// Cập nhật hàm scheduleJob để sử dụng deviceId
const scheduleJob = (scheduleDoc) => {
  // Cancel any existing job for this schedule
  if (activeJobs[scheduleDoc._id]) {
    activeJobs[scheduleDoc._id].cancel();
  }
  
  // Only schedule if active and not completed
  if (!scheduleDoc.isActive || scheduleDoc.isCompleted) {
    console.log(`Schedule ${scheduleDoc._id} is inactive or completed, not scheduling`);
    return;
  }
  
  // Handle different schedule types
  if (scheduleDoc.scheduleType === 'onetime') {
    // One-time specific date/time scheduling
    const scheduledDate = new Date(scheduleDoc.scheduledDateTime);
    
    // Don't schedule if date is in the past
    if (scheduledDate <= new Date()) {
      console.log(`Schedule ${scheduleDoc._id} is in the past, marking as completed`);
      Schedule.findByIdAndUpdate(
        scheduleDoc._id, 
        { isCompleted: true },
        { new: true }
      ).catch(err => console.error('Error updating schedule:', err));
      return;
    }
    
    console.log(`Scheduling one-time job for ${scheduledDate}, Device: ${scheduleDoc.deviceId}`);
    
    activeJobs[scheduleDoc._id] = schedule.scheduleJob(scheduledDate, async () => {
      console.log(`Executing one-time schedule: ${scheduleDoc.name}`);
      
      // Send ON signal (1) to the specific device
      await sendToAdafruit(1, scheduleDoc.deviceId);
      
      // Schedule turning OFF after duration minutes
      setTimeout(async () => {
        console.log(`Turning off pump for schedule: ${scheduleDoc.name}`);
        await sendToAdafruit(0, scheduleDoc.deviceId);
        
        // Mark as completed
        await Schedule.findByIdAndUpdate(
          scheduleDoc._id,
          { isCompleted: true },
          { new: true }
        );
      }, scheduleDoc.duration * 60 * 1000); // Convert minutes to milliseconds
    });
    
  } else {
    // Recurring weekly schedule
    const [hours, minutes] = scheduleDoc.startTime.split(':').map(Number);
    
    // Create cron expression: mins hours * * dayOfWeek
    const daysOfWeekStr = scheduleDoc.daysOfWeek.join(',');
    const cronExpression = `${minutes} ${hours} * * ${daysOfWeekStr}`;
    
    console.log(`Scheduling recurring job: ${cronExpression}, Device: ${scheduleDoc.deviceId}`);
    
    // Schedule the job
    activeJobs[scheduleDoc._id] = schedule.scheduleJob(cronExpression, async () => {
      console.log(`Executing recurring schedule: ${scheduleDoc.name}`);
      
      // Send ON signal (1) to the specific device
      await sendToAdafruit(1, scheduleDoc.deviceId);
      
      // Schedule turning OFF after duration minutes
      setTimeout(async () => {
        console.log(`Turning off pump for schedule: ${scheduleDoc.name}`);
        await sendToAdafruit(0, scheduleDoc.deviceId);
      }, scheduleDoc.duration * 60 * 1000); // Convert minutes to milliseconds
    });
  }
};

const initializeSchedules = async () => {
    try {
      const schedules = await Schedule.find({ 
        $or: [
          { scheduleType: 'recurring', isActive: true },
          { scheduleType: 'onetime', isActive: true, isCompleted: false }
        ]
      });
      console.log(`Found ${schedules.length} active schedules to initialize`);
      
      schedules.forEach(scheduleDoc => {
        scheduleJob(scheduleDoc);
      });
      
      return { success: true, count: schedules.length };
    } catch (error) {
      console.error('Error initializing schedules:', error);
      return { success: false, error: error.message };
    }
};
  
// Create a new schedule
const createSchedule = async (req, res) => {
  try {
    // Get schedule data from request body
    const scheduleData = req.body;
    
    // Add the authenticated user's ID to the schedule data
    scheduleData.userId = req.user.id;
    
    // Create the new schedule
    const schedule = new Schedule(scheduleData);
    await schedule.save();
    
    // Initialize the scheduled job
    scheduleJob(schedule);
    
    res.status(201).json({
      success: true,
      message: 'Lịch tưới cây đã được tạo thành công',
      schedule
    });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(400).json({
      success: false,
      message: 'Error creating schedule',
      error: error.message
    });
  }
};

// Get all schedules
const getAllSchedules = async (req, res) => {
  try {
    const schedules = await Schedule.find({ userId: req.user.id });
    
    res.status(200).json({
      success: true,
      count: schedules.length,
      schedules
    });
  } catch (error) {
    console.error('Error getting schedules:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving schedules',
      error: error.message
    });
  }
};
  
// Get a single schedule
const getScheduleById = async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }
    
    res.status(200).json({
      success: true,
      schedule
    });
  } catch (error) {
    console.error('Error getting schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving schedule',
      error: error.message
    });
  }
};

const updateSchedule = async (req, res) => {
  try {
    const { 
      name, 
      startTime, 
      scheduledDateTime,  
      scheduleType,       
      duration, 
      daysOfWeek, 
      isActive,
      deviceId,     // Thêm trường thiết bị
      areaId,       // Thêm trường khu vực
      plantIndex    // Thêm trường chỉ mục cây trồng
    } = req.body;
  
    // Find and update the schedule
    const updatedSchedule = await Schedule.findByIdAndUpdate(
      req.params.id,
      {
        name,
        startTime,
        scheduledDateTime: scheduledDateTime ? new Date(scheduledDateTime) : undefined,
        scheduleType,
        duration,
        daysOfWeek,
        isActive,
        deviceId,      // Cập nhật ID thiết bị
        areaId,        // Cập nhật ID khu vực
        plantIndex,    // Cập nhật chỉ mục cây trồng
        updatedAt: Date.now()
      },
      { new: true, runValidators: true }
    );
    
    if (!updatedSchedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }
    
    // Re-schedule the job
    scheduleJob(updatedSchedule);
    
    res.status(200).json({
      success: true,
      message: 'Schedule updated successfully',
      schedule: updatedSchedule
    });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating schedule',
      error: error.message
    });
  }
};
  
// Delete a schedule
const deleteSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }
    
    // Cancel the job if it exists
    if (activeJobs[schedule._id]) {
      activeJobs[schedule._id].cancel();
      delete activeJobs[schedule._id];
    }
    
    await Schedule.findByIdAndDelete(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Schedule deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting schedule',
      error: error.message
    });
  }
};

// Toggle schedule active status
const toggleSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }
    
    schedule.isActive = !schedule.isActive;
    await schedule.save();
    
    // Re-schedule or cancel job
    if (schedule.isActive) {
      scheduleJob(schedule);
    } else if (activeJobs[schedule._id]) {
      activeJobs[schedule._id].cancel();
      delete activeJobs[schedule._id];
    }
    
    res.status(200).json({
      success: true,
      message: `Schedule ${schedule.isActive ? 'activated' : 'deactivated'} successfully`,
      schedule
    });
  } catch (error) {
    console.error('Error toggling schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling schedule',
      error: error.message
    });
  }
};
  
module.exports = {
  createSchedule,
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
  initializeSchedules
};