const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({ storage: multer.diskStorage({
    destination: function (req, file, cb) { cb(null, UPLOADS_DIR); },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
}) });

// All routes below require a valid user token + teacher (or teacher_staff with 'courses' permission)
router.use(authMiddleware);

// ─── R2 Multipart upload helpers (used by frontend GlobalUploadContext) ─────────
router.post('/r2-multipart/init', requireTeacherPermission('courses'), adminController.initVideoMultipartUpload);
router.post('/r2-multipart/part-url', requireTeacherPermission('courses'), adminController.getVideoMultipartPartUrl);
router.post('/r2-multipart/complete', requireTeacherPermission('courses'), adminController.completeVideoMultipartUpload);
router.post('/r2-multipart/abort', requireTeacherPermission('courses'), adminController.abortVideoMultipartUpload);

// ─── Create a new video record (initialize before R2 upload) ─────────────────
router.post(
    '/',
    requireTeacherPermission('courses'),
    upload.any(),
    [
        check('title', 'Video title is required').trim().not().isEmpty(),
        check('lesson_id', 'Lesson ID is required and must be a valid UUID').optional().isUUID(),
        check('order', 'Order must be a number').optional().isInt(),
    ],
    adminController.addVideo
);

// ─── Finalize / update an existing video record (after R2 upload) ────────────
router.put(
    '/:id',
    requireTeacherPermission('courses'),
    upload.any(),
    [
        check('id', 'Video ID is required').isUUID(),
        check('title', 'Title is required').optional().not().isEmpty(),
        check('order', 'Order must be an integer').optional().isInt(),
    ],
    adminController.updateVideo
);

// ─── Get processing status (polled by GlobalUploadContext) ───────────────────
router.get(
    '/:id/processing-status',
    requireTeacherPermission('courses'),
    [check('id', 'Video ID is required').isUUID()],
    adminController.getProcessingStatus
);

// ─── Delete a video ───────────────────────────────────────────────────────────
router.delete(
    '/:id',
    requireTeacherPermission('courses'),
    [check('id', 'Video ID is required').isUUID()],
    adminController.deleteVideo
);

// ─── Get a single video (for edit page) ──────────────────────────────────────
router.get(
    '/:id',
    requireTeacherPermission('courses'),
    [check('id', 'Video ID is required').isUUID()],
    adminController.getVideo
);

// ─── Video versions ───────────────────────────────────────────────────────────
router.get(
    '/:id/versions',
    requireTeacherPermission('courses'),
    [check('id', 'Video ID is required').isUUID()],
    adminController.getVideoVersions
);

router.post(
    '/:id/restore-version/:versionId',
    requireTeacherPermission('courses'),
    [
        check('id', 'Video ID is required').isUUID(),
        check('versionId', 'Version ID is required').isUUID(),
    ],
    adminController.restoreVideoVersion
);

router.delete(
    '/:id/versions/:versionId',
    requireTeacherPermission('courses'),
    [
        check('id', 'Video ID is required').isUUID(),
        check('versionId', 'Version ID is required').isUUID(),
    ],
    adminController.deleteVideoVersion
);

module.exports = router;
