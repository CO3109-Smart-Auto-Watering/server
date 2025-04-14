const express = require('express');
const router = express.Router();
const { authenticate } = require('../controllers/authController');
const reportsController = require('../controllers/reportsController');

router.use(authenticate);

// Get report data
router.get('/', reportsController.getReportData);
router.get('/export-pdf', reportsController.exportPDF);
router.get('/export-csv', reportsController.exportCSV);

module.exports = router;