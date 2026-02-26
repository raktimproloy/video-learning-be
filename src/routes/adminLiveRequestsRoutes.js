const express = require('express');
const router = express.Router();
const adminLiveRequestsController = require('../controllers/adminLiveRequestsController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);

router.get('/', adminLiveRequestsController.list);
router.patch('/:id/accept', adminLiveRequestsController.accept);
router.patch('/:id/decline', adminLiveRequestsController.decline);

module.exports = router;
