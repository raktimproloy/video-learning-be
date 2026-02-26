const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const courseController = require('../controllers/courseController');
const teacherPaymentController = require('../controllers/teacherPaymentController');
const authMiddleware = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuthMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

// Configure multer for course file uploads
const COURSES_UPLOAD_DIR = path.resolve(__dirname, '../../uploads/courses');
if (!fs.existsSync(COURSES_UPLOAD_DIR)) {
    fs.mkdirSync(COURSES_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, COURSES_UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow images for thumbnail
        if (file.fieldname === 'thumbnail') {
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Thumbnail must be an image file'));
            }
        }
        // Allow videos for intro video
        else if (file.fieldname === 'introVideo') {
            if (file.mimetype.startsWith('video/')) {
                cb(null, true);
            } else {
                cb(new Error('Intro video must be a video file'));
            }
        } else {
            cb(null, true);
        }
    }
});

// Student routes
router.get('/student/purchased', authMiddleware, requireRole(['student', 'teacher']), courseController.getPurchasedCourses);
router.get('/student/purchase-history', authMiddleware, requireRole(['student', 'teacher']), courseController.getStudentPurchaseHistory);
router.get('/student/available', authMiddleware, requireRole(['student', 'teacher']), courseController.getAvailableCourses);
router.get('/:id/assignments-notes', authMiddleware, requireRole(['student', 'teacher']), courseController.getCourseAssignmentsAndNotes);
router.post('/:id/purchase', authMiddleware, requireRole(['student', 'teacher']), courseController.purchaseCourse);
router.post('/:id/payment-request', authMiddleware, requireRole(['student', 'teacher']), courseController.createPaymentRequest);

// Course media streaming from R2 - PUBLIC (no auth) so img/video tags work
// Thumbnails and intro videos are preview content, R2 keys are not guessable
// GET /v1/courses/media/teachers/.../thumbnail/image.jpg
router.get(/^\/media\/(.+)$/, (req, res, next) => {
    req.params.key = decodeURIComponent(req.params[0]);
    return courseController.streamCourseMedia(req, res, next);
});

// Public/Authenticated routes - optionalAuth allows public access but sets req.user if authenticated
router.get('/', optionalAuth, courseController.getAllCourses);
router.get('/search', optionalAuth, courseController.searchCourses);
router.get('/by-invite/:code', courseController.getCourseByInviteCode);
router.get('/:id/details', optionalAuth, courseController.getCourseDetails);
router.get('/:id/teacher/live-report', authMiddleware, requireRole(['teacher']), courseController.getCourseLiveReport);
router.get('/:id', optionalAuth, courseController.getCourseById);

// Teacher only routes
router.get('/teacher/my-courses', authMiddleware, requireRole(['teacher']), courseController.getMyCourses);
router.get('/teacher/my-students', authMiddleware, requireRole(['teacher']), courseController.getMyStudents);
router.get('/teacher/revenue', authMiddleware, requireRole(['teacher']), courseController.getTeacherRevenue);
router.get('/teacher/purchase-history', authMiddleware, requireRole(['teacher']), courseController.getTeacherPurchaseHistory);
router.get('/teacher/dashboard-stats', authMiddleware, requireRole(['teacher']), courseController.getTeacherDashboardStats);
router.get('/teacher/payment-methods', authMiddleware, requireRole(['teacher']), teacherPaymentController.listPaymentMethods);
router.post('/teacher/payment-methods', authMiddleware, requireRole(['teacher']), teacherPaymentController.addPaymentMethod);
router.patch('/teacher/payment-methods/:id', authMiddleware, requireRole(['teacher']), teacherPaymentController.updatePaymentMethod);
router.delete('/teacher/payment-methods/:id', authMiddleware, requireRole(['teacher']), teacherPaymentController.deletePaymentMethod);
router.get('/teacher/withdraw-requests', authMiddleware, requireRole(['teacher']), teacherPaymentController.listWithdrawRequests);
router.get('/teacher/withdraw-requests/:id', authMiddleware, requireRole(['teacher']), teacherPaymentController.getWithdrawRequest);
router.post('/teacher/withdraw', authMiddleware, requireRole(['teacher']), courseController.requestWithdraw);
router.post('/', 
    authMiddleware, 
    requireRole(['teacher']), 
    upload.fields([
        { name: 'thumbnail', maxCount: 1 },
        { name: 'introVideo', maxCount: 1 }
    ]),
    courseController.createCourse
);
router.put('/:id', 
    authMiddleware, 
    requireRole(['teacher']), 
    upload.fields([
        { name: 'thumbnail', maxCount: 1 },
        { name: 'introVideo', maxCount: 1 }
    ]),
    courseController.updateCourse
);
router.post('/:id/request-live', authMiddleware, requireRole(['teacher']), courseController.requestLive);
router.delete('/:id', authMiddleware, requireRole(['teacher']), courseController.deleteCourse);

module.exports = router;
