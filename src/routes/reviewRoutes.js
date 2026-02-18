const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

// All routes require authentication
router.use(authMiddleware);

// Create or update review
router.post('/course/:courseId', requireRole(['student', 'teacher']), reviewController.createOrUpdateReview);

// Get my review for a course
router.get('/course/:courseId/my-review', requireRole(['student', 'teacher']), reviewController.getMyReview);

// Get all reviews for teacher's courses (teacher only)
router.get('/teacher/my-reviews', requireRole(['teacher']), reviewController.getMyCourseReviews);

// Get all reviews for a course (public, but requires auth for now)
router.get('/course/:courseId', authMiddleware, reviewController.getCourseReviews);

// Get course rating statistics
router.get('/course/:courseId/stats', authMiddleware, reviewController.getCourseRatingStats);

// Delete review
router.delete('/course/:courseId', requireRole(['student', 'teacher']), reviewController.deleteReview);

module.exports = router;
