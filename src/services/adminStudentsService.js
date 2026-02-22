const db = require('../../db');

class AdminStudentsService {
    async list(skip = 0, limit = 10, q = null) {
        let whereClause = "WHERE u.role = 'student'";
        const params = [];
        if (q && String(q).trim()) {
            const search = `%${String(q).trim().replace(/%/g, '\\%')}%`;
            whereClause += ' AND (u.email ILIKE $1 OR sp.name ILIKE $1)';
            params.push(search);
        }
        params.push(limit, skip);

        const result = await db.query(
            `SELECT 
                u.id,
                u.email,
                u.created_at,
                COALESCE(sp.name, u.email) as name,
                (SELECT COUNT(*)::int FROM course_enrollments ce WHERE ce.user_id = u.id) as enrolled_count
             FROM users u
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             ${whereClause}
             ORDER BY u.created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        const progressTableExists = await db.query(`
            SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'progress_summaries')
        `);
        const hasProgressTable = progressTableExists.rows[0]?.exists || false;

        const completedMap = {};
        if (hasProgressTable && result.rows.length > 0) {
            const ids = result.rows.map(r => r.id);
            const compRes = await db.query(
                `SELECT user_id, COUNT(*)::int as c FROM progress_summaries 
                 WHERE user_id = ANY($1::uuid[]) AND completed = true GROUP BY user_id`,
                [ids]
            );
            compRes.rows.forEach(r => { completedMap[r.user_id] = parseInt(r.c, 10) || 0; });
        }

        const students = result.rows.map(row => ({
            id: row.id,
            email: row.email,
            name: row.name || row.email,
            enrolledCourses: parseInt(row.enrolled_count, 10) || 0,
            completedCourses: completedMap[row.id] || 0,
            joinedAt: row.created_at,
        }));

        const countParams = params.slice(0, Math.max(0, params.length - 2));
        const countResult = await db.query(
            `SELECT COUNT(*)::int as total FROM users u LEFT JOIN student_profiles sp ON u.id = sp.user_id ${whereClause}`,
            countParams
        );
        const total = countResult.rows[0]?.total || 0;

        return { students, total };
    }

    async getById(id) {
        const result = await db.query(
            `SELECT 
                u.id,
                u.email,
                u.created_at,
                sp.name,
                sp.bio
             FROM users u
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             WHERE u.id = $1 AND u.role = 'student'`,
            [id]
        );
        const row = result.rows[0];
        if (!row) return null;

        const enrollResult = await db.query(
            `SELECT COUNT(*)::int as c FROM course_enrollments WHERE user_id = $1`,
            [id]
        );
        const enrolledCourses = parseInt(enrollResult.rows[0]?.c, 10) || 0;

        let completedCourses = 0;
        const progressCheck = await db.query(`
            SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'progress_summaries')
        `);
        if (progressCheck.rows[0]?.exists) {
            const compResult = await db.query(
                `SELECT COUNT(*)::int as c FROM progress_summaries ps
                 JOIN course_enrollments ce ON ce.user_id = ps.user_id AND ce.course_id = ps.course_id
                 WHERE ps.user_id = $1 AND ps.completed = true`,
                [id]
            );
            completedCourses = parseInt(compResult.rows[0]?.c, 10) || 0;
        }

        return {
            id: row.id,
            email: row.email,
            name: row.name || row.email,
            bio: row.bio || null,
            enrolledCourses,
            completedCourses,
            completionRate: enrolledCourses > 0 ? Math.round((completedCourses / enrolledCourses) * 100) : 0,
            joinedAt: row.created_at,
        };
    }
}

module.exports = new AdminStudentsService();
