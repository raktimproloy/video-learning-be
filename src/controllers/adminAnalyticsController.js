const adminAnalyticsService = require('../services/adminAnalyticsService');

class AdminAnalyticsController {
    /**
     * Get aggregated analytics data for the admin panel dashboard.
     * Accepts either `startDate`/`endDate` (YYYY-MM-DD, inclusive) for a real
     * custom/month range, or the legacy `days` integer as a fallback. Optional
     * `platform` (web|app) and `role` (guest|student|teacher) filter every panel.
     */
    async getAnalyticsData(req, res) {
        try {
            const { days, startDate, endDate, platform, role } = req.query;
            const stats = await adminAnalyticsService.getStats({ days, startDate, endDate, platform, role });
            res.json(stats);
        } catch (error) {
            console.error('Admin analytics data fetch error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * One user's page-view trail (most recent first) for the student/teacher
     * detail page's "Recent Activity" panel. `before` (ISO timestamp) pages
     * further back; `limit` caps the page size (default/max enforced in service).
     */
    async getUserActivity(req, res) {
        try {
            const { userId } = req.params;
            const { limit, before } = req.query;
            const activity = await adminAnalyticsService.getUserActivity(userId, { limit, before });
            res.json({ activity });
        } catch (error) {
            console.error('Admin user activity fetch error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminAnalyticsController();
