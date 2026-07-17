const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');
const couponController = require('../controllers/couponController');

router.post('/validate', authMiddleware, requireRole(['student']), couponController.validate);
router.post('/apply', authMiddleware, requireRole(['student']), couponController.apply);
router.get('/', authMiddleware, requireTeacherPermission('coupons'), couponController.list);
router.get('/:id', authMiddleware, requireTeacherPermission('coupons'), couponController.getById);
router.post('/', authMiddleware, requireTeacherPermission('coupons'), couponController.create);
router.put('/:id', authMiddleware, requireTeacherPermission('coupons'), couponController.update);
router.patch('/:id/status', authMiddleware, requireTeacherPermission('coupons'), couponController.updateStatus);
router.delete('/:id', authMiddleware, requireTeacherPermission('coupons'), couponController.delete);

module.exports = router;
