const express = require('express');
const router = express.Router();
const adminAnalyticsController = require('../controllers/adminAnalyticsController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

// Apply admin token check middleware
router.use(verifyAdmin);

// Fetch admin analytics
router.get('/', adminAnalyticsController.getAnalyticsData);

// One user's own page-view trail (student/teacher detail page "Recent Activity")
router.get('/user/:userId', adminAnalyticsController.getUserActivity);

module.exports = router;
