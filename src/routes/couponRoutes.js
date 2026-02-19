const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const couponController = require('../controllers/couponController');

router.get('/', authMiddleware, requireRole(['teacher']), couponController.list);
router.get('/:id', authMiddleware, requireRole(['teacher']), couponController.getById);
router.post('/', authMiddleware, requireRole(['teacher']), couponController.create);
router.put('/:id', authMiddleware, requireRole(['teacher']), couponController.update);
router.patch('/:id/status', authMiddleware, requireRole(['teacher']), couponController.updateStatus);
router.delete('/:id', authMiddleware, requireRole(['teacher']), couponController.delete);

module.exports = router;
