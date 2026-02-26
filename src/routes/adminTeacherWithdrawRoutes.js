const express = require('express');
const multer = require('multer');
const adminTeacherWithdrawController = require('../controllers/adminTeacherWithdrawController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Receipt must be an image file (jpg, png, etc.)'));
        }
    },
});

const router = express.Router();
router.use(verifyAdmin);

router.get('/', adminTeacherWithdrawController.list);
router.patch('/:id/accept', upload.single('receipt'), adminTeacherWithdrawController.accept);
router.patch('/:id/reject', adminTeacherWithdrawController.reject);

module.exports = router;
