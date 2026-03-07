const express = require('express');
const router = express.Router();
const teacherReviewController = require('../controllers/teacherReviewController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

// Public: list reviews for a teacher (no auth)
router.get('/teacher/:teacherId', teacherReviewController.listByTeacher);
// Public: summary (total + average rating) for a teacher - must be before :teacherId to avoid "summary" as id
router.get('/teacher/:teacherId/summary', teacherReviewController.getSummary);

// Eligibility: optional auth (if no auth, returns "please log in")
router.get('/eligibility/:teacherId', authMiddleware.optional, teacherReviewController.getEligibility);

// Auth required below
router.use(authMiddleware);

// My review for this teacher
router.get('/teacher/:teacherId/my-review', teacherReviewController.getMyReview);

// Create or update review (student only)
router.post('/teacher/:teacherId', requireRole(['student']), teacherReviewController.createReview);

module.exports = router;
