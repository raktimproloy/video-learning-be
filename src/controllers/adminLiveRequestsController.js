const liveClassRequestService = require('../services/liveClassRequestService');

class AdminLiveRequestsController {
    async list(req, res) {
        try {
            const status = req.query.status || 'pending';
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

            const { requests, total } = await liveClassRequestService.listForAdmin({ status, limit, offset });
            res.json({ requests, total });
        } catch (error) {
            console.error('Admin live requests list error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async accept(req, res) {
        try {
            const id = req.params.id;
            const adminUserId = req.user?.id;
            const updated = await liveClassRequestService.accept(id, adminUserId);
            if (!updated) {
                return res.status(404).json({ error: 'Request not found' });
            }
            res.json({ message: 'Live class request accepted. Course live class has been enabled.', request: updated });
        } catch (error) {
            if (error.message === 'Request is not pending') {
                return res.status(400).json({ error: error.message });
            }
            console.error('Admin accept live request error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async decline(req, res) {
        try {
            const id = req.params.id;
            const adminUserId = req.user?.id;
            const updated = await liveClassRequestService.decline(id, adminUserId);
            if (!updated) {
                return res.status(404).json({ error: 'Request not found' });
            }
            res.json({ message: 'Live class request declined.', request: updated });
        } catch (error) {
            if (error.message === 'Request is not pending') {
                return res.status(400).json({ error: error.message });
            }
            console.error('Admin decline live request error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminLiveRequestsController();
