const path = require('path');
const fs = require('fs');
const teacherWithdrawRequestService = require('../services/teacherWithdrawRequestService');
const marketerWithdrawRequestService = require('../services/marketerWithdrawRequestService');

const WITHDRAW_RECEIPTS_DIR = path.resolve(__dirname, '../../uploads/withdraw-receipts');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function list(req, res) {
    try {
        const { status, limit, offset } = req.query || {};
        const tLimit = limit ? parseInt(limit, 10) : 50;
        const tOffset = offset ? parseInt(offset, 10) : 0;
        
        const tList = await teacherWithdrawRequestService.listForAdmin({ status, limit: tLimit + tOffset, offset: 0 });
        const mList = await marketerWithdrawRequestService.listForAdmin({ status, limit: tLimit + tOffset, offset: 0 });
        
        const combined = [
            ...tList.map(t => ({ 
                ...t, 
                user_type: 'teacher',
                userId: t.teacherId,
                userName: t.teacherName,
                userEmail: t.teacherEmail
            })),
            ...mList.map(m => ({ 
                ...m, 
                user_type: 'reference',
                userId: m.marketerId,
                userName: m.marketerName,
                userEmail: m.marketerEmail
            }))
        ];
        
        combined.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        const paginated = combined.slice(tOffset, tOffset + tLimit);
        
        res.json(paginated);
    } catch (error) {
        console.error('Admin list withdraw error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function accept(req, res) {
    try {
        const requestId = req.params.id;
        const { userType } = req.body || {}; 
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
        
        let updated;
        if (userType === 'teacher') {
            updated = await teacherWithdrawRequestService.accept(requestId, adminUserId, receiptImagePath);
        } else if (userType === 'reference') {
            updated = await marketerWithdrawRequestService.accept(requestId, adminUserId, receiptImagePath);
        } else {
            try { fs.unlinkSync(filePath); } catch (_) {}
            return res.status(400).json({ error: 'Invalid userType. Must be teacher or reference' });
        }
        
        if (!updated) {
            try { fs.unlinkSync(filePath); } catch (_) {}
            return res.status(404).json({ error: 'Request not found or already processed' });
        }
        res.json({ ...updated, userType });
    } catch (error) {
        console.error('Admin accept withdraw error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function reject(req, res) {
    try {
        const requestId = req.params.id;
        const { userType, rejection_reason: rejectionReason } = req.body || {};
        const adminUserId = req.user?.id;
        
        let updated;
        if (userType === 'teacher') {
            updated = await teacherWithdrawRequestService.reject(requestId, adminUserId, rejectionReason);
        } else if (userType === 'reference') {
            updated = await marketerWithdrawRequestService.reject(requestId, adminUserId, rejectionReason);
        } else {
            return res.status(400).json({ error: 'Invalid userType. Must be teacher or reference' });
        }
        
        if (!updated) {
            return res.status(404).json({ error: 'Request not found or already processed' });
        }
        res.json({ ...updated, userType });
    } catch (error) {
        console.error('Admin reject withdraw error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { list, accept, reject };
