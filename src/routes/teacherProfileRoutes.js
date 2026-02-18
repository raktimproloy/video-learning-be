const express = require('express');
const router = express.Router();
const teacherProfileController = require('../controllers/teacherProfileController');
const authMiddleware = require('../middleware/authMiddleware');
const multer = require('multer');

// Configure multer for profile image upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// PUBLIC ROUTES (must be before authMiddleware)
// Stream profile image (PUBLIC endpoint)
router.get(/^\/image\/(.+)$/, (req, res, next) => {
    req.params.key = decodeURIComponent(req.params[0]);
    return teacherProfileController.streamProfileImage(req, res, next);
});

// Get public teacher profile (PUBLIC endpoint - no auth required)
router.get('/public/:userId', teacherProfileController.getPublicProfile);

// All other routes require authentication
router.use(authMiddleware);

// Get teacher profile (authenticated)
router.get('/', teacherProfileController.getProfile);

// Update teacher profile (with optional profile image upload only)
router.put('/', upload.fields([
    { name: 'profileImage', maxCount: 1 }
]), teacherProfileController.updateProfile);

// Request OTP for verification
router.post('/verify/request', teacherProfileController.requestOTP);

// Verify OTP
router.post('/verify', teacherProfileController.verifyOTP);

// Get profile completion percentage
router.get('/completion', teacherProfileController.getProfileCompletion);

// Change password
router.post('/change-password', teacherProfileController.changePassword);

module.exports = router;
