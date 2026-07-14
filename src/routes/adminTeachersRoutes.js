const express = require('express');
const router = express.Router();
const adminTeachersController = require('../controllers/adminTeachersController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);
router.get('/', adminTeachersController.list);
router.get('/:id/full-report', adminTeachersController.getFullReport);
router.get('/:id', adminTeachersController.getById);
router.put('/:id', adminTeachersController.update);
router.put('/:id/percentage', adminTeachersController.updatePercentage);
router.delete('/:id', adminTeachersController.delete);

module.exports = router;
