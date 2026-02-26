const path = require('path');
const fs = require('fs');
const teacherWithdrawRequestService = require('../services/teacherWithdrawRequestService');

const WITHDRAW_RECEIPTS_DIR = path.resolve(__dirname, '../../uploads/withdraw-receipts');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * GET / - List teacher withdrawal requests (admin)
 */
async function list(req, res) {
    try {
        const { status, limit, offset } = req.query || {};
        const list = await teacherWithdrawRequestService.listForAdmin({
            status: status || undefined,
            limit: limit ? parseInt(limit, 10) : 50,
            offset: offset ? parseInt(offset, 10) : 0,
        });
        res.json(list);
    } catch (error) {
        console.error('Admin list teacher withdraw error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * PATCH /:id/accept - Accept request; requires receipt image upload
 */
async function accept(req, res) {
    try {
        const requestId = req.params.id;
        const adminUserId = req.user?.id;
        const file = req.file;
        if (!file || !file.buffer) {
            return res.status(400).json({ error: 'Receipt image is required. Upload an image file.' });
        }
        ensureDir(WITHDRAW_RECEIPTS_DIR);
        const ext = path.extname(file.originalname || '') || (file.mimetype?.startsWith('image/') ? '.jpg' : '.jpg');
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext.toLowerCase()) ? ext : '.jpg';
        const filename = `${requestId}${safeExt}`;
        const filePath = path.join(WITHDRAW_RECEIPTS_DIR, filename);
        fs.writeFileSync(filePath, file.buffer);
        const receiptImagePath = `withdraw-receipts/${filename}`;
        const updated = await teacherWithdrawRequestService.accept(requestId, adminUserId, receiptImagePath);
        if (!updated) {
            try { fs.unlinkSync(filePath); } catch (_) {}
            return res.status(404).json({ error: 'Request not found or already processed' });
        }
        res.json(updated);
    } catch (error) {
        console.error('Admin accept teacher withdraw error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * PATCH /:id/reject - Reject request with reason
 */
async function reject(req, res) {
    try {
        const requestId = req.params.id;
        const adminUserId = req.user?.id;
        const { rejection_reason: rejectionReason } = req.body || {};
        const updated = await teacherWithdrawRequestService.reject(requestId, adminUserId, rejectionReason);
        if (!updated) {
            return res.status(404).json({ error: 'Request not found or already processed' });
        }
        res.json(updated);
    } catch (error) {
        console.error('Admin reject teacher withdraw error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { list, accept, reject };
