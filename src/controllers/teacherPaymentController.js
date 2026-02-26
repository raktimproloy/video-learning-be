const teacherPaymentMethodService = require('../services/teacherPaymentMethodService');
const teacherWithdrawRequestService = require('../services/teacherWithdrawRequestService');

/**
 * GET /teacher/payment-methods - List teacher's payment methods
 */
async function listPaymentMethods(req, res) {
    try {
        const methods = await teacherPaymentMethodService.list(req.user.id);
        res.json(methods);
    } catch (error) {
        console.error('List payment methods error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /teacher/payment-methods - Add payment method
 * Body: { type: 'bank'|'card'|'bkash'|'nagad'|'rocket', displayLabel?, details }
 */
async function addPaymentMethod(req, res) {
    try {
        const { type, displayLabel, details } = req.body || {};
        const method = await teacherPaymentMethodService.add(req.user.id, { type, displayLabel, details });
        res.status(201).json(method);
    } catch (error) {
        if (error.message === 'Invalid payment method type') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Add payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * PATCH /teacher/payment-methods/:id - Update payment method
 */
async function updatePaymentMethod(req, res) {
    try {
        const { displayLabel, details } = req.body || {};
        const method = await teacherPaymentMethodService.update(req.params.id, req.user.id, { displayLabel, details });
        if (!method) return res.status(404).json({ error: 'Payment method not found' });
        res.json(method);
    } catch (error) {
        console.error('Update payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * DELETE /teacher/payment-methods/:id - Remove payment method
 */
async function deletePaymentMethod(req, res) {
    try {
        const deleted = await teacherPaymentMethodService.remove(req.params.id, req.user.id);
        if (!deleted) return res.status(404).json({ error: 'Payment method not found' });
        res.json({ message: 'Payment method removed' });
    } catch (error) {
        console.error('Delete payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /teacher/withdraw-requests - List teacher's withdrawal requests
 */
async function listWithdrawRequests(req, res) {
    try {
        const { status, limit, offset } = req.query || {};
        const list = await teacherWithdrawRequestService.listByTeacher(req.user.id, {
            status: status || undefined,
            limit: limit ? parseInt(limit, 10) : 50,
            offset: offset ? parseInt(offset, 10) : 0,
        });
        res.json(list);
    } catch (error) {
        console.error('List withdraw requests error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /teacher/withdraw-requests/:id - Get one request (teacher own)
 */
async function getWithdrawRequest(req, res) {
    try {
        const request = await teacherWithdrawRequestService.getById(req.params.id, req.user.id);
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
