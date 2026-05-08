const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const adminCoursesController = require('../controllers/adminCoursesController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

const COURSES_UPLOAD_DIR = path.resolve(__dirname, '../../uploads/courses');
if (!fs.existsSync(COURSES_UPLOAD_DIR)) {
    fs.mkdirSync(COURSES_UPLOAD_DIR, { recursive: true });
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, COURSES_UPLOAD_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.fieldname !== 'thumbnail') {
            return cb(new Error('Unexpected file field'));
        }
        if (file.mimetype && file.mimetype.startsWith('image/')) {
            return cb(null, true);
        }
        const name = (file.originalname || '').toLowerCase();
        if (/\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(name)) {
            return cb(null, true);
        }
        return cb(new Error('Thumbnail must be an image (JPEG, PNG, GIF, WebP, or similar).'));
    },
});

router.use(verifyAdmin);
router.get('/', adminCoursesController.list);
router.post(
    '/url',
    upload.fields([{ name: 'thumbnail', maxCount: 1 }]),
    adminCoursesController.createUrlCourse
);
// More specific routes first (before /:id)
router.post('/external/generate-visitors', adminCoursesController.generateExternalVisitors);
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
