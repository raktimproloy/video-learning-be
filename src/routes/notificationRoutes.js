const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const notificationController = require('../controllers/notificationController');

router.use(authMiddleware);
router.get('/', requireRole(['student', 'teacher']), notificationController.list);
router.get('/unread-count', requireRole(['student', 'teacher']), notificationController.getUnreadCount);
router.post('/:id/read', requireRole(['student', 'teacher']), notificationController.markAsRead);

module.exports = router;
