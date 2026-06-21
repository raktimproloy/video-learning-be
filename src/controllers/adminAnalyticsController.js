const adminAnalyticsService = require('../services/adminAnalyticsService');

class AdminAnalyticsController {
    /**
     * Get aggregated analytics data for the admin panel dashboard.
     * Takes an optional 'days' query parameter.
     */
    async getAnalyticsData(req, res) {
        try {
            const { days } = req.query;
            const stats = await adminAnalyticsService.getStats(days);
            res.json(stats);
        } catch (error) {
            console.error('Admin analytics data fetch error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminAnalyticsController();
