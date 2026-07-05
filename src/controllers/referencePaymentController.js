const marketerPaymentMethodService = require('../services/marketerPaymentMethodService');
const marketerWithdrawRequestService = require('../services/marketerWithdrawRequestService');

/**
 * GET /reference/dashboard/payment-methods
 */
async function listPaymentMethods(req, res) {
    try {
        const methods = await marketerPaymentMethodService.list(req.user.id);
        res.json(methods);
    } catch (error) {
        console.error('List marketer payment methods error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /reference/dashboard/payment-methods
 */
async function addPaymentMethod(req, res) {
    try {
        const { type, displayLabel, details } = req.body || {};
        const method = await marketerPaymentMethodService.add(req.user.id, { type, displayLabel, details });
        res.status(201).json(method);
    } catch (error) {
        if (error.message === 'Invalid payment method type') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Add marketer payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * PATCH /reference/dashboard/payment-methods/:id
 */
async function updatePaymentMethod(req, res) {
    try {
        const { displayLabel, details } = req.body || {};
        const method = await marketerPaymentMethodService.update(req.params.id, req.user.id, { displayLabel, details });
        if (!method) return res.status(404).json({ error: 'Payment method not found' });
        res.json(method);
    } catch (error) {
        console.error('Update marketer payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * DELETE /reference/dashboard/payment-methods/:id
 */
async function deletePaymentMethod(req, res) {
    try {
        const deleted = await marketerPaymentMethodService.remove(req.params.id, req.user.id);
        if (!deleted) return res.status(404).json({ error: 'Payment method not found' });
        res.json({ message: 'Payment method removed' });
    } catch (error) {
        console.error('Delete marketer payment method error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /reference/dashboard/withdraw-requests
 */
async function listWithdrawRequests(req, res) {
    try {
        const { status, limit, offset, page } = req.query || {};
        const limitNum = limit ? parseInt(limit, 10) : 10;
        const pageNum = Math.max(1, page ? parseInt(page, 10) : 1);
        const offsetNum = offset !== undefined ? parseInt(offset, 10) : (pageNum - 1) * limitNum;
        const effectiveLimit = Math.min(50, Math.max(1, limitNum));
        const effectiveOffset = Math.max(0, offsetNum);
        const { requests, total } = await marketerWithdrawRequestService.listByMarketer(req.user.id, {
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
        console.error('List marketer withdraw requests error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /reference/dashboard/withdraw-requests
 */
async function createWithdrawRequest(req, res) {
    try {
        const request = await marketerWithdrawRequestService.create(req.user.id, req.body);
        res.status(201).json(request);
    } catch (error) {
        if (error.message === 'No balance to withdraw' || error.message === 'Payment method not found' || error.message === 'Payment method is required') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Create marketer withdraw request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /reference/dashboard/withdraw-requests/:id
 */
async function getWithdrawRequest(req, res) {
    try {
        const request = await marketerWithdrawRequestService.getById(req.params.id, req.user.id);
        if (!request) return res.status(404).json({ error: 'Withdrawal request not found' });
        res.json(request);
    } catch (error) {
        console.error('Get marketer withdraw request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = {
    listPaymentMethods,
    addPaymentMethod,
    updatePaymentMethod,
    deletePaymentMethod,
    listWithdrawRequests,
    createWithdrawRequest,
    getWithdrawRequest,
};
