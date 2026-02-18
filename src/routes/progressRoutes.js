const express = require('express');
const router = express.Router();
const progressController = require('../controllers/progressController');
const verifyToken = require('../middleware/authMiddleware');

router.post('/video', verifyToken, progressController.saveVideoProgress);
router.get('/video/:videoId', verifyToken, progressController.getVideoProgress);
router.get('/course/:courseId', verifyToken, progressController.getCourseProgress);
router.get('/recent', verifyToken, progressController.getRecentActivity);
router.get('/dashboard', verifyToken, progressController.getDashboardStats);

module.exports = router;
