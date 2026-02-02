const express = require('express');
const router = express.Router();
const lessonController = require('../controllers/lessonController');
const authMiddleware = require('../middleware/authMiddleware');

// Public/Authenticated routes
router.get('/course/:courseId', authMiddleware, lessonController.getLessonsByCourse);
router.get('/:id', authMiddleware, lessonController.getLessonById);

// Teacher only routes
router.post('/', authMiddleware, lessonController.createLesson);
router.put('/:id', authMiddleware, lessonController.updateLesson);
router.delete('/:id', authMiddleware, lessonController.deleteLesson);

module.exports = router;
