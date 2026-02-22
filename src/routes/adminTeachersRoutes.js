const express = require('express');
const router = express.Router();
const adminTeachersController = require('../controllers/adminTeachersController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);
router.get('/', adminTeachersController.list);
router.get('/:id', adminTeachersController.getById);

module.exports = router;
