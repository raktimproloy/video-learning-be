const express = require('express');
const router = express.Router();
const adminStudentsController = require('../controllers/adminStudentsController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);
router.get('/', adminStudentsController.list);
router.get('/:id', adminStudentsController.getById);

module.exports = router;
