const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const announcementController = require('../controllers/announcementController');

router.post('/', authMiddleware, requireRole(['teacher']), announcementController.create);
router.get('/teacher', authMiddleware, requireRole(['teacher']), announcementController.getByTeacher);

module.exports = router;
