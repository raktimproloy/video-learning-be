const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const optionalAuth = require('../middleware/optionalAuthMiddleware');

// Log a page view (links to user if logged in)
router.post('/pageview', optionalAuth, analyticsController.logPageView);

// Log page view heartbeat duration updates
router.post('/heartbeat', analyticsController.logHeartbeat);

module.exports = router;
