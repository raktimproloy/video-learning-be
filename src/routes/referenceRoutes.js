const express = require('express');
const { body } = require('express-validator');
const referenceAuthController = require('../controllers/referenceAuthController');
const referenceDashboardController = require('../controllers/referenceDashboardController');
const referenceCourseController = require('../controllers/referenceCourseController');
const verifyToken = require('../middleware/authMiddleware');

const restrictTo = (role) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
};
const router = express.Router();

// --- Auth Routes ---
router.post('/auth/register',
    [
        body('name', 'Name is required').notEmpty(),
        body('email', 'Please include a valid email').isEmail(),
        body('phone', 'Phone is required').notEmpty(),
        body('password', 'Please enter a password with 6 or more characters').isLength({ min: 6 })
    ],
    referenceAuthController.register
);

router.post('/auth/login',
    referenceAuthController.login
);

// --- Dashboard Routes ---
router.use('/dashboard', verifyToken, restrictTo('marketer'));
router.get('/dashboard/stats', referenceDashboardController.getStats);
router.get('/dashboard/teachers', referenceDashboardController.getTeachers);
router.get('/dashboard/courses', referenceDashboardController.getCourses);
router.get('/dashboard/students', referenceDashboardController.getStudents);
router.get('/dashboard/earnings', referenceDashboardController.getEarnings);

// --- Course Editing Routes ---
router.post('/dashboard/courses', referenceCourseController.createCourse);
router.get('/dashboard/courses/:courseId', referenceCourseController.getCourseDetails);
router.put('/dashboard/courses/:courseId', referenceCourseController.updateCourse);
router.put('/dashboard/courses/:courseId/lessons/:lessonId', referenceCourseController.updateLesson);
router.put('/dashboard/courses/:courseId/videos/:videoId', referenceCourseController.updateVideo);

router.post('/dashboard/courses/:courseId/lessons', referenceCourseController.createLesson);
router.post('/dashboard/courses/:courseId/videos', referenceCourseController.createVideo);

module.exports = router;
