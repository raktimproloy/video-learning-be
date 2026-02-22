const adminDashboardService = require('../services/adminDashboardService');

class AdminDashboardController {
    async getStats(req, res) {
        try {
            const stats = await adminDashboardService.getStats();
            res.json(stats);
        } catch (error) {
            console.error('Admin dashboard stats error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminDashboardController();
