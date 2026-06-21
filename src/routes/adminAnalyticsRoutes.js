const express = require('express');
const router = express.Router();
const adminAnalyticsController = require('../controllers/adminAnalyticsController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

// Apply admin token check middleware
router.use(verifyAdmin);

// Fetch admin analytics
router.get('/', adminAnalyticsController.getAnalyticsData);

module.exports = router;
