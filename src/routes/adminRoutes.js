const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const adminController = require('../controllers/adminController');
const verifyToken = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

// Configure Multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Make sure this directory exists
    },
    filename: function (req, file, cb) {
        // Use timestamp + original name to avoid collisions
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Protect admin routes with JWT 
// (In a real app, you'd check for an 'admin' role too)
router.use(verifyToken);

router.post(
    '/videos',
    upload.single('video'), // Expect a field named 'video'
    [
        check('title', 'Title is required').not().isEmpty(),
        // storage_path is no longer required from client, we'll generate it
    ],
    adminController.addVideo
);

router.post(
    '/permissions',
    [
        check('user_id', 'User ID is required').isUUID(),
        check('video_id', 'Video ID is required').isUUID(),
        check('duration_seconds', 'Duration must be an integer').optional().isInt()
    ],
    adminController.grantPermission
);

router.post(
    '/processing-tasks',
    [
        check('video_id', 'Video ID is required').isUUID(),
        check('codec_preference', 'Codec must be h264 or h265').isIn(['h264', 'h265']),
        check('resolutions', 'Resolutions must be an array').isArray(),
        check('resolutions.*', 'Invalid resolution').isIn(['360p', '720p', '1080p']),
        check('crf', 'CRF must be an integer').optional().isInt({ min: 0, max: 51 }),
        check('compress', 'Compress must be a boolean').optional().isBoolean()
    ],
    adminController.createProcessingTask
);

router.delete(
    '/videos/:id',
    [
        check('id', 'Video ID is required').isUUID()
    ],
    adminController.deleteVideo
);

module.exports = router;
