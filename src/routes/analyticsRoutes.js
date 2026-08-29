const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const optionalAuth = require('../middleware/optionalAuthMiddleware');
const { analyticsHeartbeatLimiter } = require('../middleware/rateLimit');

// Log a page view (links to user if logged in)
router.post('/pageview', optionalAuth, analyticsController.logPageView);

// Log page view heartbeat duration updates
router.post('/heartbeat', analyticsHeartbeatLimiter, analyticsController.logHeartbeat);

// Video playback TTFF metrics (watch page startup)
router.post('/video-playback', optionalAuth, analyticsController.logVideoPlayback);

module.exports = router;
