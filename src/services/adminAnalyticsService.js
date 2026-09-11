const db = require('../../db');

const VALID_PLATFORMS = new Set(['web', 'app']);
const VALID_ROLES = new Set(['guest', 'student', 'teacher']);

class AdminAnalyticsService {
    /**
     * Compile all stats for the given filters.
     * @param {object} [opts]
     * @param {Date|string} [opts.startDate]
     * @param {Date|string} [opts.endDate]
     * @param {'web'|'app'} [opts.platform]
     * @param {'guest'|'student'|'teacher'} [opts.role]
     * @param {number} [opts.days] - back-compat: used only when startDate/endDate are absent.
     */
    async getStats(opts = {}) {
        const { startDate, endDate } = this._resolveRange(opts);
        const platform = VALID_PLATFORMS.has(opts.platform) ? opts.platform : null;
        const role = VALID_ROLES.has(opts.role) ? opts.role : null;
        const filter = this._buildFilterClause(platform, role, 3); // $1=startDate, $2=endDate

        const [
            overview,
            realtime,
            dailyChart,
            topPages,
            entryPages,
            exitPages,
            referrers,
            campaigns,
            newVsReturning,
            devices,
            browsers,
            oss,
            countries,
        ] = await Promise.all([
            this._getOverviewStats(startDate, endDate, filter),
            this._getRealtimeActiveUsers(platform, role),
            this._getDailyChartData(startDate, endDate, filter),
            this._getTopPages(startDate, endDate, filter, 15),
            this._getEntryPages(startDate, endDate, filter, 15),
            this._getExitPages(startDate, endDate, filter, 15),
            this._getReferrers(startDate, endDate, filter, 10),
            this._getCampaigns(startDate, endDate, filter, 10),
            this._getNewVsReturning(startDate, endDate, filter),
            this._getBreakdownStats('device_type', startDate, endDate, filter, 5),
            this._getBreakdownStats('browser', startDate, endDate, filter, 10),
            this._getBreakdownStats('os', startDate, endDate, filter, 10),
            this._getBreakdownStats('country', startDate, endDate, filter, 10),
        ]);

        return {
            totalPageViews: overview.totalPageViews,
            uniqueVisitors: overview.uniqueVisitors,
            averageDuration: overview.averageDuration,
            activeUsers: realtime,
            newVisitors: newVsReturning.newVisitors,
            returningVisitors: newVsReturning.returningVisitors,
            dailyChart,
            topPages,
            entryPages,
            exitPages,
            referrers,
            campaigns,
            devices,
            browsers,
            oss,
            countries,
        };
    }

    /**
     * `days` (legacy) or an explicit `startDate`/`endDate` pair. Explicit dates win.
     */
    _resolveRange({ startDate, endDate, days }) {
        if (startDate && endDate) {
            const s = new Date(startDate);
            s.setHours(0, 0, 0, 0);
            const e = new Date(endDate);
            e.setHours(23, 59, 59, 999);
            return { startDate: s, endDate: e };
        }
        const daysInt = parseInt(days, 10) || 7;
        const e = new Date();
        const s = new Date();
        s.setDate(s.getDate() - daysInt + 1);
        s.setHours(0, 0, 0, 0);
        return { startDate: s, endDate: e };
    }

    /**
     * Optional `platform`/`role` filter as a SQL fragment + its own params,
     * starting at `paramIndex` (every query puts startDate/endDate at $1/$2, this
     * clause next, then any of the query's own trailing params like LIMIT).
     * `role: 'guest'` means "role IS NULL" (no user_id) — it needs no param.
     */
    _buildFilterClause(platform, role, paramIndex) {
        const clauses = [];
        const params = [];
        let idx = paramIndex;
        if (platform) {
            clauses.push(`platform = $${idx++}`);
            params.push(platform);
        }
        if (role === 'guest') {
            clauses.push(`role IS NULL`);
        } else if (role) {
            clauses.push(`role = $${idx++}`);
            params.push(role);
        }
        return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params, nextIndex: idx };
    }

    /**
     * Get aggregate overview statistics
     */
    async _getOverviewStats(startDate, endDate, filter) {
        const res = await db.query(
            `SELECT
                COUNT(*)::int as views,
                COUNT(DISTINCT session_id)::int as visitors,
                COALESCE(ROUND(AVG(duration_seconds)), 0)::int as avg_duration
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2${filter.sql}`,
            [startDate, endDate, ...filter.params]
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
    async _getRealtimeActiveUsers(platform, role) {
        const filter = this._buildFilterClause(platform, role, 1);
        const res = await db.query(
            `SELECT COUNT(DISTINCT session_id)::int as active_users
             FROM page_views
             WHERE updated_at >= NOW() - INTERVAL '5 minutes'${filter.sql}`,
            filter.params
        );
        return res.rows[0]?.active_users || 0;
    }

    /**
     * Get day-by-day views and unique visitor statistics.
     * Generates a complete daily array in JS to guarantee all days are filled with 0s if no visits occurred.
     */
    async _getDailyChartData(startDate, endDate, filter) {
        // Query database
        const res = await db.query(
            `SELECT
                DATE(created_at AT TIME ZONE 'UTC')::text as date,
                COUNT(*)::int as views,
                COUNT(DISTINCT session_id)::int as visitors
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2${filter.sql}
             GROUP BY DATE(created_at AT TIME ZONE 'UTC')
             ORDER BY DATE(created_at AT TIME ZONE 'UTC') ASC`,
            [startDate, endDate, ...filter.params]
        );

        const dbMap = {};
        res.rows.forEach(r => {
            dbMap[r.date] = { views: r.views, visitors: r.visitors };
        });

        // Construct complete list of days spanning the requested range (inclusive).
        // Compare calendar days (not raw ms, which would undercount by one since
        // startDate is midnight and endDate is 23:59:59.999 the same day for a
        // single-day range).
        const chartData = [];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        const daysCount = Math.max(1, Math.round((endDay - startDay) / 86400000) + 1);

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
     * Get pages visited sorted by highest pageview count. Grouped by the
     * normalized `page_template` (e.g. `/watch/:id`) so a real course site
     * doesn't drown the table in one-off UUIDs.
     */
    async _getTopPages(startDate, endDate, filter, limit) {
        const limitIdx = filter.nextIndex;
        const res = await db.query(
            `SELECT
                COALESCE(page_template, page_path) as path,
                COUNT(*)::int as views,
                COUNT(DISTINCT session_id)::int as unique_visitors,
                COALESCE(ROUND(AVG(duration_seconds)), 0)::int as avg_duration
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2${filter.sql}
             GROUP BY COALESCE(page_template, page_path)
             ORDER BY views DESC
             LIMIT $${limitIdx}`,
            [startDate, endDate, ...filter.params, limit]
        );
        return res.rows;
    }

    /**
     * Get entry pages (the first page a user visited in a session — their
     * "landing page"). Mirrors `_getExitPages`.
     */
    async _getEntryPages(startDate, endDate, filter, limit) {
        const limitIdx = filter.nextIndex;
        const res = await db.query(
            `WITH session_entries AS (
                SELECT DISTINCT ON (session_id)
                    COALESCE(page_template, page_path) as path,
                    id
                FROM page_views
                WHERE created_at >= $1 AND created_at <= $2${filter.sql}
                ORDER BY session_id, created_at ASC
            )
            SELECT
                path,
                COUNT(*)::int as entries
            FROM session_entries
            GROUP BY path
            ORDER BY entries DESC
            LIMIT $${limitIdx}`,
            [startDate, endDate, ...filter.params, limit]
        );
        return res.rows;
    }

    /**
     * Get exit pages (the last page a user visited in a session before leaving)
     */
    async _getExitPages(startDate, endDate, filter, limit) {
        const limitIdx = filter.nextIndex;
        const res = await db.query(
            `WITH session_exits AS (
                SELECT DISTINCT ON (session_id)
                    COALESCE(page_template, page_path) as path,
                    id
                FROM page_views
                WHERE created_at >= $1 AND created_at <= $2${filter.sql}
                ORDER BY session_id, created_at DESC
            )
            SELECT
                path,
                COUNT(*)::int as exits
            FROM session_exits
            GROUP BY path
            ORDER BY exits DESC
            LIMIT $${limitIdx}`,
            [startDate, endDate, ...filter.params, limit]
        );
        return res.rows;
    }

    /**
     * Get referrers breakdown (domain-level — see `_getCampaigns` for UTM-level)
     */
    async _getReferrers(startDate, endDate, filter, limit) {
        const limitIdx = filter.nextIndex;
        const res = await db.query(
            `SELECT
                COALESCE(referrer_domain, 'Direct / Bookmark') as referrer,
                COUNT(*)::int as views
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2${filter.sql}
             GROUP BY referrer_domain
             ORDER BY views DESC
             LIMIT $${limitIdx}`,
            [startDate, endDate, ...filter.params, limit]
        );
        return res.rows;
    }

    /**
     * Campaign/source breakdown from UTM params (marketing-campaign level,
     * distinct from the raw referrer domain — e.g. two different Facebook ad
     * campaigns both have referrer_domain 'facebook.com' but different
     * utm_campaign values).
     */
    async _getCampaigns(startDate, endDate, filter, limit) {
        const limitIdx = filter.nextIndex;
        const res = await db.query(
            `SELECT
                COALESCE(utm_source, 'None') as source,
                COALESCE(utm_medium, '') as medium,
                COALESCE(utm_campaign, '') as campaign,
                COUNT(*)::int as views
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2 AND utm_source IS NOT NULL${filter.sql}
             GROUP BY utm_source, utm_medium, utm_campaign
             ORDER BY views DESC
             LIMIT $${limitIdx}`,
            [startDate, endDate, ...filter.params, limit]
        );
        return res.rows;
    }

    /**
     * New vs returning visitors in the range, by first-seen `visitor_id`.
     * A visitor is "new" if their earliest page_view ever falls inside the
     * requested range; "returning" if it's from before the range started.
     * Visits with no visitor_id (not yet instrumented / pre-migration rows)
     * are excluded from this specific breakdown rather than miscounted.
     */
    async _getNewVsReturning(startDate, endDate, filter) {
        const res = await db.query(
            `WITH in_range AS (
                SELECT DISTINCT visitor_id
                FROM page_views
                WHERE created_at >= $1 AND created_at <= $2 AND visitor_id IS NOT NULL${filter.sql}
             ),
             first_seen AS (
                SELECT visitor_id, MIN(created_at) as first_seen_at
                FROM page_views
                WHERE visitor_id IN (SELECT visitor_id FROM in_range)
                GROUP BY visitor_id
             )
             SELECT
                COUNT(*) FILTER (WHERE first_seen_at >= $1)::int as new_visitors,
                COUNT(*) FILTER (WHERE first_seen_at < $1)::int as returning_visitors
             FROM first_seen`,
            [startDate, endDate, ...filter.params]
        );
        const row = res.rows[0];
        return {
            newVisitors: row?.new_visitors || 0,
            returningVisitors: row?.returning_visitors || 0,
        };
    }

    /**
     * One user's own page-view trail, most recent first — lets an admin open a
     * specific student/teacher and see exactly what they did (support/"what did
     * this user need" investigations). Cursor-paginated on `created_at`.
     */
    async getUserActivity(userId, { limit = 50, before } = {}) {
        const params = [userId];
        let sql = `SELECT id, page_path, page_template, platform, duration_seconds, created_at
                   FROM page_views WHERE user_id = $1`;
        if (before) {
            params.push(before);
            sql += ` AND created_at < $${params.length}`;
        }
        const limitVal = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
        params.push(limitVal);
        sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

        const res = await db.query(sql, params);
        return res.rows.map((r) => ({
            id: r.id,
            path: r.page_path,
            template: r.page_template || r.page_path,
            platform: r.platform,
            durationSeconds: r.duration_seconds,
            createdAt: r.created_at,
        }));
    }

    /**
     * Helper to get generic counts for dimension breakdowns (e.g. browser, device_type, os, country)
     */
    async _getBreakdownStats(columnName, startDate, endDate, filter, limit) {
        const limitIdx = filter.nextIndex;
        // Safe identifier injection since columnName is hardcoded dynamically in service code, not from request
        const res = await db.query(
            `SELECT
                COALESCE(${columnName}, 'Unknown') as label,
                COUNT(*)::int as value
             FROM page_views
             WHERE created_at >= $1 AND created_at <= $2${filter.sql}
             GROUP BY ${columnName}
             ORDER BY value DESC
             LIMIT $${limitIdx}`,
            [startDate, endDate, ...filter.params, limit]
        );
        return res.rows;
    }
}

module.exports = new AdminAnalyticsService();
