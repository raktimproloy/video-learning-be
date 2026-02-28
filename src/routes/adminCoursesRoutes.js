const express = require('express');
const router = express.Router();
const adminCoursesController = require('../controllers/adminCoursesController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);
router.get('/', adminCoursesController.list);
router.get('/:id', adminCoursesController.getById);
router.delete('/:id', adminCoursesController.delete);

module.exports = router;
