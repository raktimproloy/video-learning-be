const paymentRequestService = require('../services/paymentRequestService');

class AdminPaymentRequestsController {
    async list(req, res) {
        try {
            const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
            const status = req.query.status || null;
            const search = req.query.search || req.query.q || null;

            const { requests, total } = await paymentRequestService.listPaymentRequests({
                skip,
                limit,
                status,
                search,
            });
            res.json({ requests, total });
        } catch (error) {
            console.error('Admin payment requests list error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async accept(req, res) {
        try {
            const adminUserId = req.user?.id;
            const { reason } = req.body || {};
            const trimmedReason = typeof reason === "string" ? reason.trim() : "";
            const result = await paymentRequestService.acceptPaymentRequest(
                req.params.id,
                adminUserId,
                trimmedReason || null
            );
            if (!result) {
                return res.status(404).json({ error: 'Request not found or already processed' });
            }
            if (result.error) {
                return res.status(400).json({ error: result.error });
            }
            res.json({ message: 'Payment accepted; student has been enrolled.', requestId: result.requestId });
        } catch (error) {
            console.error('Admin accept payment request error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async reject(req, res) {
        try {
            const adminUserId = req.user?.id;
            const { reason } = req.body || {};
            const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
            const result = await paymentRequestService.rejectPaymentRequest(
                req.params.id,
                adminUserId,
                trimmedReason || null
            );
            if (!result) {
                return res.status(404).json({ error: 'Request not found or already processed' });
            }
            res.json({
                message: 'Payment request rejected.',
                requestId: result.requestId,
                rejectionReason: trimmedReason || null,
            });
        } catch (error) {
            console.error('Admin reject payment request error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminPaymentRequestsController();
