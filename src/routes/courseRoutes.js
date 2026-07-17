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
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');

const COURSE_UPLOAD_MAX_MB = Math.max(1, parseInt(process.env.COURSE_UPLOAD_MAX_MB || '500', 10));
const COURSE_UPLOAD_MAX_BYTES = COURSE_UPLOAD_MAX_MB * 1024 * 1024;

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
        fileSize: COURSE_UPLOAD_MAX_BYTES
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
router.get('/student/payment-requests', authMiddleware, requireRole(['student', 'teacher']), courseController.getStudentPaymentRequests);
router.get('/student/payment-requests/:id', authMiddleware, requireRole(['student', 'teacher']), courseController.getStudentPaymentRequestById);
router.post('/student/payment-requests/:id/complete', authMiddleware, requireRole(['student', 'teacher']), courseController.completeStudentPaymentRequest);
router.get('/student/available', authMiddleware, requireRole(['student', 'teacher']), courseController.getAvailableCourses);
router.get('/:id/assignments-notes', authMiddleware, requireRole(['student', 'teacher']), courseController.getCourseAssignmentsAndNotes);
router.post('/:id/purchase', authMiddleware, requireRole(['student', 'teacher']), courseController.purchaseCourse);
router.post('/:id/payment-request', authMiddleware, requireRole(['student', 'teacher']), courseController.createPaymentRequest);

// UddoktaPay payment gateway endpoints
router.post('/:id/uddoktapay/initiate', authMiddleware, requireRole(['student', 'teacher']), courseController.initiateUddoktaPay);
router.post('/uddoktapay/verify', authMiddleware, requireRole(['student', 'teacher']), courseController.verifyUddoktaPay);
router.post('/uddoktapay/webhook', courseController.handleUddoktaPayWebhook);


// Course media streaming from R2 - PUBLIC (no auth) so img/video tags work
// Thumbnails and intro videos are preview content, R2 keys are not guessable
// GET /v1/courses/media/teachers/.../thumbnail/image.jpg
router.get(/^\/media\/(.+)$/, (req, res, next) => {
    req.params.key = decodeURIComponent(req.params[0]);
    return courseController.streamCourseMedia(req, res, next);
});

// Public/Authenticated routes - optionalAuth allows public access but sets req.user if authenticated
router.get('/', optionalAuth, courseController.getAllCourses);
router.get('/home-sections', optionalAuth, courseController.getHomeSections);
router.get('/home-analytics', optionalAuth, courseController.getHomeAnalytics);
router.get('/popular', optionalAuth, courseController.getPopularCourses);
router.get('/search', optionalAuth, courseController.searchCourses);
router.get('/by-invite/:code', courseController.getCourseByInviteCode);
router.get('/:id/details', optionalAuth, courseController.getCourseDetails);
router.post('/:id/external-click', optionalAuth, courseController.recordExternalClick);
router.post(
    '/:id/open-external',
    optionalAuth,
    courseController.openExternalCourse
);
router.get('/:id/teacher/live-report', authMiddleware, requireTeacherPermission('courses'), courseController.getCourseLiveReport);
router.get('/:id', optionalAuth, courseController.getCourseById);

// Teacher only routes (owner teacher or staff with permissions)
router.get('/teacher/my-courses', authMiddleware, requireTeacherPermission('courses'), courseController.getMyCourses);
router.get('/teacher/my-students', authMiddleware, requireTeacherPermission('students'), courseController.getMyStudents);
router.get('/teacher/revenue', authMiddleware, requireTeacherPermission('payments'), courseController.getTeacherRevenue);
router.get('/teacher/purchase-history', authMiddleware, requireTeacherPermission('payments'), courseController.getTeacherPurchaseHistory);
router.get('/teacher/dashboard-stats', authMiddleware, requireTeacherPermission('dashboard'), courseController.getTeacherDashboardStats);
router.get('/teacher/payment-methods', authMiddleware, requireTeacherPermission('payments'), teacherPaymentController.listPaymentMethods);
router.post('/teacher/payment-methods', authMiddleware, requireTeacherPermission('payments'), teacherPaymentController.addPaymentMethod);
router.patch('/teacher/payment-methods/:id', authMiddleware, requireTeacherPermission('payments'), teacherPaymentController.updatePaymentMethod);
router.delete('/teacher/payment-methods/:id', authMiddleware, requireTeacherPermission('payments'), teacherPaymentController.deletePaymentMethod);
router.get('/teacher/withdraw-requests', authMiddleware, requireTeacherPermission('payments'), teacherPaymentController.listWithdrawRequests);
router.get('/teacher/withdraw-requests/:id', authMiddleware, requireTeacherPermission('payments'), teacherPaymentController.getWithdrawRequest);
router.post('/teacher/withdraw', authMiddleware, requireTeacherPermission('payments'), courseController.requestWithdraw);
router.post('/', 
    authMiddleware, 
    requireTeacherPermission('courses'), 
    upload.fields([
        { name: 'thumbnail', maxCount: 1 },
        { name: 'introVideo', maxCount: 1 }
    ]),
    courseController.createCourse
);
router.put('/:id', 
    authMiddleware, 
    requireTeacherPermission('courses'), 
    upload.fields([
        { name: 'thumbnail', maxCount: 1 },
        { name: 'introVideo', maxCount: 1 }
    ]),
    courseController.updateCourse
);
router.post('/:id/intro-video',
    authMiddleware,
    requireTeacherPermission('courses'),
    upload.single('introVideo'),
    courseController.uploadIntroVideo
);
router.post('/:id/request-live', authMiddleware, requireTeacherPermission('courses'), courseController.requestLive);
router.delete('/:id', authMiddleware, requireTeacherPermission('courses'), courseController.deleteCourse);

module.exports = router;
