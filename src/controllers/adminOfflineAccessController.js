const adminOfflineAccessService = require('../services/adminOfflineAccessService');

class AdminOfflineAccessController {
    async listPurchases(req, res) {
        try {
            const { skip, limit, status, search } = req.query;
            const result = await adminOfflineAccessService.listAllPurchases({
                skip: parseInt(skip, 10) || 0,
                limit: parseInt(limit, 10) || 20,
                status,
                search
            });
            res.json(result);
        } catch (error) {
            console.error('List admin offline access purchases error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async acceptPurchase(req, res) {
        try {
            const result = await adminOfflineAccessService.acceptPurchase(req.params.id, req.user.id);
            res.json({ message: 'Purchase accepted', purchase: result });
        } catch (error) {
            console.error('Accept purchase error:', error);
            res.status(400).json({ error: error.message || 'Failed to accept purchase' });
        }
    }

    async rejectPurchase(req, res) {
        try {
            const { reason } = req.body;
            if (!reason) return res.status(400).json({ error: 'Reason is required' });

            const result = await adminOfflineAccessService.rejectPurchase(req.params.id, req.user.id, reason);
            res.json({ message: 'Purchase rejected', purchase: result });
        } catch (error) {
            console.error('Reject purchase error:', error);
            res.status(400).json({ error: error.message || 'Failed to reject purchase' });
        }
    }

    async toggleActive(req, res) {
        try {
            const { isActive } = req.body;
            if (isActive === undefined) return res.status(400).json({ error: 'isActive is required' });

            const result = await adminOfflineAccessService.toggleActiveStatus(req.params.id, req.user.id, isActive);
            res.json(result);
        } catch (error) {
            console.error('Toggle active error:', error);
            res.status(400).json({ error: error.message || 'Failed to toggle active status' });
        }
    }

    async updateLimit(req, res) {
        try {
            const { limit } = req.body;
            if (!limit) return res.status(400).json({ error: 'limit is required' });

            const result = await adminOfflineAccessService.updateStudentLimit(req.params.id, limit);
            res.json({ message: 'Limit updated successfully', purchase: result });
        } catch (error) {
            console.error('Update limit error:', error);
            res.status(400).json({ error: error.message || 'Failed to update limit' });
        }
    }

    async listAssignedStudents(req, res) {
        try {
            const students = await adminOfflineAccessService.listAssignedStudents(req.params.id);
            res.json(students);
        } catch (error) {
            console.error('List assigned students error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminOfflineAccessController();
