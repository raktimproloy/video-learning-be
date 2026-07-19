const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const adminUserModerationController = require('../controllers/adminUserModerationController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);

router.get('/:id/sessions', [check('id', 'Invalid user ID').isUUID()], adminUserModerationController.getSessions);

router.get('/:id/moderation-history', [check('id', 'Invalid user ID').isUUID()], adminUserModerationController.getHistory);

router.post(
    '/:id/suspend',
    [check('id', 'Invalid user ID').isUUID(), check('reason', 'A suspension reason is required').notEmpty()],
    adminUserModerationController.suspend
);

router.post('/:id/reactivate', [check('id', 'Invalid user ID').isUUID()], adminUserModerationController.reactivate);

router.delete(
    '/:id/sessions/:sessionId',
    [check('id', 'Invalid user ID').isUUID(), check('sessionId', 'Invalid session ID').isUUID()],
    adminUserModerationController.revokeSession
);

module.exports = router;
