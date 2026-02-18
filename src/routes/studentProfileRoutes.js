const express = require('express');
const router = express.Router();
const studentProfileController = require('../controllers/studentProfileController');
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
    return studentProfileController.streamProfileImage(req, res, next);
});

// All other routes require authentication
router.use(authMiddleware);

// Get student profile
router.get('/', studentProfileController.getProfile);

// Update student profile (with optional image upload)
router.put('/', upload.single('profileImage'), studentProfileController.updateProfile);

// Change password
router.post('/change-password', studentProfileController.changePassword);

module.exports = router;
