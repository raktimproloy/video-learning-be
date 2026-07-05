const express = require('express');
const router = express.Router();
const adminWithdrawController = require('../controllers/adminWithdrawController');
const verifyToken = require('../middleware/authMiddleware');
const multer = require('multer');

// Simple memory storage for receipt upload before saving to disk
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Protect all routes with JWT and admin role check
const restrictTo = (role) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
};

router.use(verifyToken, restrictTo('admin'));

router.get('/', adminWithdrawController.list);
router.patch('/:id/accept', upload.single('receipt'), adminWithdrawController.accept);
router.patch('/:id/reject', adminWithdrawController.reject);

module.exports = router;
