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

// Stream profile image (PUBLIC endpoint - must be before authMiddleware)
// Use regex to match paths with slashes (similar to course media route)
router.get(/^\/image\/(.+)$/, (req, res, next) => {
    req.params.key = decodeURIComponent(req.params[0]);
    return teacherProfileController.streamProfileImage(req, res, next);
});

// All other routes require authentication
router.use(authMiddleware);

// Get teacher profile
router.get('/', teacherProfileController.getProfile);

// Update teacher profile (with optional image uploads - profile image and certificate images)
// Support both single file (profileImage) and multiple files (certificate_images)
router.put('/', upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'certificate_images', maxCount: 10 }
]), teacherProfileController.updateProfile);

// Request OTP for verification
router.post('/verify/request', teacherProfileController.requestOTP);

// Verify OTP
router.post('/verify', teacherProfileController.verifyOTP);

// Get profile completion percentage
router.get('/completion', teacherProfileController.getProfileCompletion);

module.exports = router;
