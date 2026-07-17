const teacherPaymentMethodService = require('../services/teacherPaymentMethodService');
const teacherWithdrawRequestService = require('../services/teacherWithdrawRequestService');

function teacherId(req) {
    return req.effectiveTeacherId || req.user.id;
}

async function listPaymentMethods(req, res) {
    try {
        const methods = await teacherPaymentMethodService.list(teacherId(req));
        res.json(methods);
    } catch (error) {
        console.error('List payment methods error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function addPaymentMethod(req, res) {
    try {
        const { type, displayLabel, details } = req.body || {};
        const method = await teacherPaymentMethodService.add(teacherId(req), { type, displayLabel, details });
        res.status(201).json(method);
    } catch (error) {
        if (error.message === 'Invalid payment method type') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Add payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function updatePaymentMethod(req, res) {
    try {
        const { displayLabel, details } = req.body || {};
        const method = await teacherPaymentMethodService.update(req.params.id, teacherId(req), { displayLabel, details });
        if (!method) return res.status(404).json({ error: 'Payment method not found' });
        res.json(method);
    } catch (error) {
        console.error('Update payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function deletePaymentMethod(req, res) {
    try {
        const deleted = await teacherPaymentMethodService.remove(req.params.id, teacherId(req));
        if (!deleted) return res.status(404).json({ error: 'Payment method not found' });
        res.json({ message: 'Payment method removed' });
    } catch (error) {
        console.error('Delete payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function listWithdrawRequests(req, res) {
    try {
        const { status, limit, offset, page } = req.query || {};
        const limitNum = limit ? parseInt(limit, 10) : 10;
        const pageNum = Math.max(1, page ? parseInt(page, 10) : 1);
        const offsetNum = offset !== undefined ? parseInt(offset, 10) : (pageNum - 1) * limitNum;
        const effectiveLimit = Math.min(50, Math.max(1, limitNum));
        const effectiveOffset = Math.max(0, offsetNum);
        const { requests, total } = await teacherWithdrawRequestService.listByTeacher(teacherId(req), {
            status: status || undefined,
            limit: effectiveLimit,
            offset: effectiveOffset,
        });
        const totalPages = Math.ceil(total / effectiveLimit) || 1;
        res.json({
            requests,
            total,
            page: pageNum,
            limit: effectiveLimit,
            totalPages,
        });
    } catch (error) {
        console.error('List withdraw requests error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function getWithdrawRequest(req, res) {
    try {
        const request = await teacherWithdrawRequestService.getById(req.params.id, teacherId(req));
        if (!request) return res.status(404).json({ error: 'Withdrawal request not found' });
        res.json(request);
    } catch (error) {
        console.error('Get withdraw request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = {
    listPaymentMethods,
    addPaymentMethod,
    updatePaymentMethod,
    deletePaymentMethod,
    listWithdrawRequests,
    getWithdrawRequest,
};
