const db = require('../../db');

/**
 * Get dashboard stats for admin panel:
 * - totalAdmins, totalTeachers, totalStudents, totalCourses
 * - salesThisWeek: { invited, normal }
 * - salesByDay: [{ day, invited, normal }] for the current week
 */
class AdminDashboardService {
    async getStats() {
        const [
            adminsCount,
            teachersCount,
            studentsCount,
            coursesCount,
            salesThisWeek,
            salesByDay
        ] = await Promise.all([
            this._countAdmins(),
            this._countTeachers(),
            this._countStudents(),
            this._countCourses(),
            this._salesThisWeek(),
            this._salesByDayThisWeek()
        ]);

        return {
            totalAdmins: adminsCount,
            totalTeachers: teachersCount,
            totalStudents: studentsCount,
            totalCourses: coursesCount,
            salesThisWeek: salesThisWeek,
            salesByDay: salesByDay,
        };
    }

    async _countAdmins() {
        const r = await db.query(
            `SELECT COUNT(*)::int as c FROM users WHERE role = 'admin'`
        );
        return r.rows[0]?.c || 0;
    }

    async _countTeachers() {
        const r = await db.query(
            `SELECT COUNT(*)::int as c FROM users WHERE role = 'teacher'`
        );
        return r.rows[0]?.c || 0;
    }

    async _countStudents() {
        const r = await db.query(
            `SELECT COUNT(*)::int as c FROM users WHERE role = 'student'`
        );
        return r.rows[0]?.c || 0;
    }

    async _countCourses() {
        const r = await db.query(
            `SELECT COUNT(*)::int as c FROM courses WHERE COALESCE(status, 'active') = 'active'`
        );
        return r.rows[0]?.c || 0;
    }

    /**
     * Check if course_enrollments has is_invited column
     */
    async _hasIsInvitedColumn() {
        const r = await db.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'course_enrollments' AND column_name = 'is_invited'
        `);
        return r.rows.length > 0;
    }

    async _salesThisWeek() {
        const hasIsInvited = await this._hasIsInvitedColumn();
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);

        if (hasIsInvited) {
            const r = await db.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE COALESCE(is_invited, false) = true)::int as invited,
                    COUNT(*) FILTER (WHERE COALESCE(is_invited, false) = false)::int as normal
                 FROM course_enrollments 
                 WHERE enrolled_at >= $1`,
                [weekStart]
            );
            const row = r.rows[0];
            return { invited: row?.invited || 0, normal: row?.normal || 0 };
        }

        const r = await db.query(
            `SELECT COUNT(*)::int as total FROM course_enrollments WHERE enrolled_at >= $1`,
            [weekStart]
        );
        const total = r.rows[0]?.total || 0;
        return { invited: 0, normal: total };
    }

    async _salesByDayThisWeek() {
        const hasIsInvited = await this._hasIsInvitedColumn();
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const days = [];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            days.push({
                date: d.toISOString().split('T')[0],
                dayName: dayNames[d.getDay()],
                dayIndex: i,
            });
        }

        const dayStarts = days.map(d => d.date);

        if (hasIsInvited) {
            const r = await db.query(
                `SELECT 
                    DATE(enrolled_at)::text as day,
                    COUNT(*) FILTER (WHERE COALESCE(is_invited, false) = true)::int as invited,
                    COUNT(*) FILTER (WHERE COALESCE(is_invited, false) = false)::int as normal
                 FROM course_enrollments 
                 WHERE enrolled_at >= $1 AND enrolled_at < $2
                 GROUP BY DATE(enrolled_at)`,
                [weekStart, new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)]
            );
            const map = {};
            r.rows.forEach(row => {
                map[row.day] = { invited: row.invited || 0, normal: row.normal || 0 };
            });
            return days.map(d => ({
                day: d.dayName,
                date: d.date,
                invited: (map[d.date]?.invited || 0),
                normal: (map[d.date]?.normal || 0),
            }));
        }

        const r = await db.query(
            `SELECT DATE(enrolled_at)::text as day, COUNT(*)::int as total
             FROM course_enrollments 
             WHERE enrolled_at >= $1 AND enrolled_at < $2
             GROUP BY DATE(enrolled_at)`,
            [weekStart, new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)]
        );
        const map = {};
        r.rows.forEach(row => { map[row.day] = row.total || 0; });
        return days.map(d => ({
            day: d.dayName,
            date: d.date,
            invited: 0,
            normal: map[d.date] || 0,
        }));
    }
}

module.exports = new AdminDashboardService();
