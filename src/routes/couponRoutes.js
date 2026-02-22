const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const couponController = require('../controllers/couponController');

router.post('/validate', authMiddleware, requireRole(['student']), couponController.validate);
router.post('/apply', authMiddleware, requireRole(['student']), couponController.apply);
router.get('/', authMiddleware, requireRole(['teacher']), couponController.list);
router.get('/:id', authMiddleware, requireRole(['teacher']), couponController.getById);
router.post('/', authMiddleware, requireRole(['teacher']), couponController.create);
router.put('/:id', authMiddleware, requireRole(['teacher']), couponController.update);
router.patch('/:id/status', authMiddleware, requireRole(['teacher']), couponController.updateStatus);
router.delete('/:id', authMiddleware, requireRole(['teacher']), couponController.delete);

module.exports = router;
