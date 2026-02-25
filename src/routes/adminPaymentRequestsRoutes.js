const express = require('express');
const router = express.Router();
const adminPaymentRequestsController = require('../controllers/adminPaymentRequestsController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);
router.get('/', adminPaymentRequestsController.list);
router.patch('/:id/accept', adminPaymentRequestsController.accept);
router.patch('/:id/reject', adminPaymentRequestsController.reject);

module.exports = router;
