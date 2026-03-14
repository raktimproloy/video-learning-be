const express = require('express');
const router = express.Router();
const adminCoursesController = require('../controllers/adminCoursesController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);
router.get('/', adminCoursesController.list);
// More specific routes first (before /:id)
router.get('/:id/stats', adminCoursesController.getStats);
router.get('/:id/reviews', adminCoursesController.getReviews);
router.put('/:id/reviews/:reviewId', adminCoursesController.updateReview);
router.delete('/:id/reviews/:reviewId', adminCoursesController.deleteReview);
router.put('/:id/videos/:videoId/view-count', adminCoursesController.setVideoViewCount);
router.get('/:id/enrollments', adminCoursesController.getEnrollments);
router.post('/:id/dummy-enrollments', adminCoursesController.addDummyEnrollments);
router.post('/:id/reviews', adminCoursesController.addReview);
router.get('/:id/content', adminCoursesController.getContent);
router.get('/:id', adminCoursesController.getById);
router.put('/:id', adminCoursesController.update);
router.delete('/:id', adminCoursesController.delete);

module.exports = router;
