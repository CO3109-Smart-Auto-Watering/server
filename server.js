const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

//Import controllers
const { initMqttClient } = require('./controllers/fetchDataController');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const sensorDataRoutes = require('./routes/fetchData'); 
const scheduleRoutes = require('./routes/schedule');
const deviceRoutes = require('./routes/device');
const reportRoutes = require('./routes/reports');
const areaRoutes = require('./routes/area');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
  })
  .catch(err => console.error('MongoDB Connection Error:', err));

// Initialize MQTT client for real-time updates from Adafruit IO
initMqttClient();


// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sensor-data', sensorDataRoutes); 
app.use('/api/schedules', scheduleRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/areas', areaRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});