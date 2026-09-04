const express = require('express');
const router = express.Router();
const adminLiveSessionsController = require('../controllers/adminLiveSessionsController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);

router.get('/', adminLiveSessionsController.list);
router.get('/diagnostics', adminLiveSessionsController.getDiagnostics);
router.patch('/:id/stop', adminLiveSessionsController.stop);

module.exports = router;
