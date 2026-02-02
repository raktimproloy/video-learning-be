const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const authMiddleware = require('../middleware/authMiddleware');

// Student routes
router.get('/student/purchased', authMiddleware, courseController.getPurchasedCourses);
router.get('/student/available', authMiddleware, courseController.getAvailableCourses);
router.post('/:id/purchase', authMiddleware, courseController.purchaseCourse);

// Public/Authenticated routes
router.get('/', authMiddleware, courseController.getAllCourses);
router.get('/:id', authMiddleware, courseController.getCourseById);

// Teacher only routes
router.get('/teacher/my-courses', authMiddleware, courseController.getMyCourses);
router.post('/', authMiddleware, courseController.createCourse);
router.put('/:id', authMiddleware, courseController.updateCourse);
router.delete('/:id', authMiddleware, courseController.deleteCourse);

module.exports = router;
