const express = require('express');
const router = express.Router();
const adminDashboardController = require('../controllers/adminDashboardController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);
router.get('/', adminDashboardController.getStats);

module.exports = router;
