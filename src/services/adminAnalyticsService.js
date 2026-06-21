const db = require('../../db');

class AdminAnalyticsService {
    /**
     * Compile all stats for the given date range.
     * @param {number} days - Number of days in history (e.g. 7, 30, 90).
     */
    async getStats(days = 7) {
        const daysInt = parseInt(days, 10) || 7;
        
        // Define date bounds
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysInt + 1);
        startDate.setHours(0, 0, 0, 0);

        const [
            overview,
            realtime,
            dailyChart,
            topPages,
            exitPages,
            referrers,
            devices,
            browsers,
            oss,
            countries
        ] = await Promise.all([
            this._getOverviewStats(startDate, endDate),
            this._getRealtimeActiveUsers(),
            this._getDailyChartData(startDate, endDate, daysInt),
            this._getTopPages(startDate, endDate, 15),
            this._getExitPages(startDate, endDate, 15),
            this._getReferrers(startDate, endDate, 10),
            this._getBreakdownStats('device_type', startDate, endDate, 5),
            this._getBreakdownStats('browser', startDate, endDate, 10),
            this._getBreakdownStats('os', startDate, endDate, 10),
            this._getBreakdownStats('country', startDate, endDate, 10)
        ]);

        return {
            totalPageViews: overview.totalPageViews,
            uniqueVisitors: overview.uniqueVisitors,
            averageDuration: overview.averageDuration,
            activeUsers: realtime,
            dailyChart,
            topPages,
            exitPages,
            referrers,
            devices,
            browsers,
            oss,
            countries
        };
    }

    /**
     * Get aggregate overview statistics
     */
    async _getOverviewStats(startDate, endDate) {
        const res = await db.query(
            `SELECT 
                COUNT(*)::int as views,
                COUNT(DISTINCT session_id)::int as visitors,
                COALESCE(ROUND(AVG(duration_seconds)), 0)::int as avg_duration
             FROM page_views 
             WHERE created_at >= $1 AND created_at <= $2`,
            [startDate, endDate]
        );
        const row = res.rows[0];
        return {
            totalPageViews: row?.views || 0,
            uniqueVisitors: row?.visitors || 0,
            averageDuration: row?.avg_duration || 0
        };
    }

    /**
     * Get active users (distinct session IDs in the last 5 minutes)
     */
    async _getRealtimeActiveUsers() {
        const res = await db.query(
            `SELECT COUNT(DISTINCT session_id)::int as active_users 
             FROM page_views 
             WHERE updated_at >= NOW() - INTERVAL '5 minutes'`
        );
        return res.rows[0]?.active_users || 0;
    }

    /**
     * Get day-by-day views and unique visitor statistics.
     * Generates a complete daily array in JS to guarantee all days are filled with 0s if no visits occurred.
     */
    async _getDailyChartData(startDate, endDate, daysCount) {
        // Query database
        const res = await db.query(
            `SELECT 
                DATE(created_at AT TIME ZONE 'UTC')::text as date,
                COUNT(*)::int as views,
                COUNT(DISTINCT session_id)::int as visitors
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2
             GROUP BY DATE(created_at AT TIME ZONE 'UTC')
             ORDER BY DATE(created_at AT TIME ZONE 'UTC') ASC`,
            [startDate, endDate]
        );

        const dbMap = {};
        res.rows.forEach(r => {
            dbMap[r.date] = { views: r.views, visitors: r.visitors };
        });

        // Construct complete list of days
        const chartData = [];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        for (let i = 0; i < daysCount; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            
            chartData.push({
                date: dateStr,
                dayName: dayNames[d.getDay()],
                views: dbMap[dateStr]?.views || 0,
                visitors: dbMap[dateStr]?.visitors || 0
            });
        }

        return chartData;
    }

    /**
     * Get pages visited sorted by highest pageview count
     */
    async _getTopPages(startDate, endDate, limit) {
        const res = await db.query(
            `SELECT 
                page_path,
                COUNT(*)::int as views,
                COUNT(DISTINCT session_id)::int as unique_visitors,
                COALESCE(ROUND(AVG(duration_seconds)), 0)::int as avg_duration
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2
             GROUP BY page_path
             ORDER BY views DESC
             LIMIT $3`,
            [startDate, endDate, limit]
        );
        return res.rows;
    }

    /**
     * Get exit pages (the last page a user visited in a session before leaving)
     */
    async _getExitPages(startDate, endDate, limit) {
        const res = await db.query(
            `WITH session_exits AS (
                SELECT DISTINCT ON (session_id) 
                    page_path, 
                    id
                FROM page_views
                WHERE created_at >= $1 AND created_at <= $2
                ORDER BY session_id, created_at DESC
            )
            SELECT 
                page_path,
                COUNT(*)::int as exits
            FROM session_exits
            GROUP BY page_path
            ORDER BY exits DESC
            LIMIT $3`,
            [startDate, endDate, limit]
        );
        return res.rows;
    }

    /**
     * Get referrers breakdown
     */
    async _getReferrers(startDate, endDate, limit) {
        const res = await db.query(
            `SELECT 
                COALESCE(referrer_domain, 'Direct / Bookmark') as referrer,
                COUNT(*)::int as views
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2
             GROUP BY referrer_domain
             ORDER BY views DESC
             LIMIT $3`,
            [startDate, endDate, limit]
        );
        return res.rows;
    }

    /**
     * Helper to get generic counts for dimension breakdowns (e.g. browser, device_type, os, country)
     */
    async _getBreakdownStats(columnName, startDate, endDate, limit) {
        // Safe identifier injection since columnName is hardcoded dynamically in service code, not from request
        const res = await db.query(
            `SELECT 
                COALESCE(${columnName}, 'Unknown') as label,
                COUNT(*)::int as value
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2
             GROUP BY ${columnName}
             ORDER BY value DESC
             LIMIT $3`,
            [startDate, endDate, limit]
        );
        return res.rows;
    }
}

module.exports = new AdminAnalyticsService();
