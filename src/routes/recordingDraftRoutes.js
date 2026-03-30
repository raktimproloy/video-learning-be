const express = require('express');
const { check } = require('express-validator');
const verifyToken = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const recordingDraftController = require('../controllers/recordingDraftController');

const router = express.Router();

router.use(verifyToken, requireRole(['teacher']));

router.get('/drafts', recordingDraftController.list);
router.get('/drafts/:id', [check('id').isUUID()], recordingDraftController.getById);
router.get('/drafts/:id/source-url', [check('id').isUUID()], recordingDraftController.getSignedSourceUrl);
router.post(
    '/drafts',
    [
        check('title').optional().isString(),
        check('source_object_key', 'source_object_key is required').not().isEmpty(),
        check('source_prefix', 'source_prefix is required').not().isEmpty(),
    ],
    recordingDraftController.create
);
router.put(
    '/drafts/:id',
    [
        check('id').isUUID(),
        check('title').optional().isString(),
        check('trim_start_seconds').optional().isFloat({ min: 0 }),
        check('trim_end_seconds').optional().isFloat({ min: 0 }),
    ],
    recordingDraftController.update
);
router.post(
    '/drafts/:id/publish',
    [
        check('id').isUUID(),
        check('lesson_id').optional().isUUID(),
        check('order').optional().isInt({ min: 0 }),
    ],
    recordingDraftController.publish
);

module.exports = router;

