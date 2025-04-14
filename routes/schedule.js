const express = require('express');
const router = express.Router();
const { authenticate } = require('../controllers/authController');
const { 
  createSchedule,
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  toggleSchedule
} = require('../controllers/scheduleController');

router.use(authenticate);

// Create a new schedule
router.post('/', createSchedule);

// Get all schedules
router.get('/', getAllSchedules);

// Get a specific schedule
router.get('/:id', getScheduleById);

// Update a schedule
router.put('/:id', updateSchedule);

// Delete a schedule
router.delete('/:id', deleteSchedule);

// Toggle schedule active status
router.patch('/:id/toggle', toggleSchedule);

module.exports = router;