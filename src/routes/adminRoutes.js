const express = require('express');
const router = express.Router();
const fs = require('fs');
const { check } = require('express-validator');
const adminController = require('../controllers/adminController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');
const multer = require('multer');
const path = require('path');

const ADMIN_VIDEO_UPLOAD_MAX_MB = Math.max(1, parseInt(process.env.ADMIN_VIDEO_UPLOAD_MAX_MB || '500', 10));
const ADMIN_VIDEO_UPLOAD_MAX_BYTES = ADMIN_VIDEO_UPLOAD_MAX_MB * 1024 * 1024;

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
    // Normal (non-live) video upload limit removed for unlimited uploads
});

// Protect admin routes with JWT
router.use(verifyAdmin);

router.post(
    '/videos/r2-multipart/init',
    adminController.initVideoMultipartUpload
);

router.post(
    '/videos/r2-multipart/part-url',
    adminController.getVideoMultipartPartUrl
);

router.post(
    '/videos/r2-multipart/complete',
    adminController.completeVideoMultipartUpload
);

router.post(
    '/videos/r2-multipart/abort',
    adminController.abortVideoMultipartUpload
);

router.post(
    '/videos',
    upload.any(), // video + note_file_N + assignment_file_N
    [
        check('title', 'Video title is required').trim().not().isEmpty(),
        check('lesson_id', 'Lesson ID is required and must be a valid UUID').optional().isUUID(),
        check('order', 'Order must be a number').optional().isInt(),
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

router.get(
    '/videos/:id/versions',
    [
        check('id', 'Video ID is required').isUUID()
    ],
    adminController.getVideoVersions
);

router.post(
    '/videos/:id/restore-version/:versionId',
    [
        check('id', 'Video ID is required').isUUID(),
        check('versionId', 'Version ID is required').isUUID()
    ],
    adminController.restoreVideoVersion
);

router.delete(
    '/videos/:id/versions/:versionId',
    [
        check('id', 'Video ID is required').isUUID(),
        check('versionId', 'Version ID is required').isUUID()
    ],
    adminController.deleteVideoVersion
);

// Admin specific routes for full view (bypass ownership)
router.get(
    '/videos/:id/stream',
    [check('id', 'Video ID is required').isUUID()],
    adminController.streamAdminVideo
);
router.get(
    '/videos/:id/admin-detail',
    [check('id', 'Video ID is required').isUUID()],
    adminController.getAdminVideoDetail
);
router.get(
    '/videos/:id/admin-viewers',
    [check('id', 'Video ID is required').isUUID()],
    adminController.getAdminVideoViewers
);
router.put(
    '/videos/:id/admin-status',
    [check('id', 'Video ID is required').isUUID(), check('status').not().isEmpty()],
    adminController.updateAdminVideoStatus
);
router.get(
    '/lessons/:id/admin-detail',
    [check('id', 'Lesson ID is required').isUUID()],
    adminController.getAdminLessonDetail
);
router.put(
    '/lessons/:id/admin-status',
    [check('id', 'Lesson ID is required').isUUID(), check('status').not().isEmpty()],
    adminController.updateAdminLessonStatus
);

router.get(
    '/exams/:id/admin-results',
    [check('id', 'Exam ID is required').isUUID()],
    adminController.getAdminExamResults
);

// Admin offline access routes
const adminOfflineAccessController = require('../controllers/adminOfflineAccessController');
router.get('/offline-access', adminOfflineAccessController.listPurchases);
router.post('/offline-access/:id/accept', adminOfflineAccessController.acceptPurchase);
router.post('/offline-access/:id/reject', adminOfflineAccessController.rejectPurchase);
router.patch('/offline-access/:id/toggle-active', adminOfflineAccessController.toggleActive);
router.patch('/offline-access/:id/limit', adminOfflineAccessController.updateLimit);
router.get('/offline-access/:id/students', adminOfflineAccessController.listAssignedStudents);

module.exports = router;
