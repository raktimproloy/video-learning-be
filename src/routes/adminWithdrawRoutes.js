const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const adminWithdrawController = require('../controllers/adminWithdrawController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');
const multer = require('multer');

const WITHDRAW_RECEIPTS_DIR = path.resolve(__dirname, '../../uploads/withdraw-receipts');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function safeExt(originalname) {
    const ext = path.extname(originalname || '') || '';
    return ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
}

const storage = multer.diskStorage({
    destination(_req, _file, cb) {
        ensureDir(WITHDRAW_RECEIPTS_DIR);
        cb(null, WITHDRAW_RECEIPTS_DIR);
    },
    filename(req, file, cb) {
        cb(null, `${req.params.id}${safeExt(file.originalname)}`);
    },
});

const upload = multer({ storage });

router.use(verifyAdmin);

router.get('/', adminWithdrawController.list);
router.patch('/:id/accept', upload.single('receipt'), adminWithdrawController.accept);
router.patch('/:id/reject', adminWithdrawController.reject);

module.exports = router;
