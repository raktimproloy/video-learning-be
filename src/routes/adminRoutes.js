const express = require('express');
const router = express.Router();
const fs = require('fs');
const { check } = require('express-validator');
const adminController = require('../controllers/adminController');
const verifyToken = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 550 * 1024 * 1024 }, // 550MB for video + notes/assignments
});

// Protect admin routes with JWT
router.use(verifyToken);

router.post(
    '/videos',
    upload.any(), // video + note_file_N + assignment_file_N
    [
        check('title', 'Title is required').not().isEmpty(),
        check('lesson_id', 'Lesson ID must be a UUID').optional().isUUID(),
        check('order', 'Order must be an integer').optional().isInt(),
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

router.get(
    '/videos/:id',
    [
        check('id', 'Video ID is required').isUUID()
    ],
    adminController.getVideo
);

router.get(
    '/videos/:id/processing-status',
    [
        check('id', 'Video ID is required').isUUID()
    ],
    adminController.getProcessingStatus
);

router.put(
    '/videos/:id',
    upload.any(),
    [
        check('id', 'Video ID is required').isUUID(),
        check('title', 'Title is required').optional().not().isEmpty(),
        check('order', 'Order must be an integer').optional().isInt(),
    ],
    adminController.updateVideo
);

module.exports = router;
