const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');
const announcementController = require('../controllers/announcementController');

router.post('/', authMiddleware, requireTeacherPermission('announcements'), announcementController.create);
router.get('/teacher', authMiddleware, requireTeacherPermission('announcements'), announcementController.getByTeacher);

module.exports = router;
