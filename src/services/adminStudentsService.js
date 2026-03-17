const db = require('../../db');
const adminTeachersService = require('./adminTeachersService');

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
                u.role,
                u.created_at,
                sp.name,
                sp.bio,
                sp.phone,
                sp.profile_image_path,
                EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.user_id = u.id) AS has_teacher_profile
             FROM users u
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             WHERE u.id = $1`,
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

        const isAlsoTeacher = row.role === 'teacher' || row.has_teacher_profile === true;

        return {
            id: row.id,
            email: row.email,
            name: row.name || row.email,
            bio: row.bio || null,
            phone: row.phone || null,
            profileImagePath: row.profile_image_path || null,
            enrolledCourses,
            completedCourses,
            completionRate: enrolledCourses > 0 ? Math.round((completedCourses / enrolledCourses) * 100) : 0,
            joinedAt: row.created_at,
            isAlsoTeacher,
        };
    }

    /**
     * Update basic student fields (email and profile name).
     * Returns the updated student detail or null if not found.
     */
    async updateStudent(id, payload) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            if (payload.email !== undefined) {
                await client.query(
                    'UPDATE users SET email = $1 WHERE id = $2',
                    [payload.email, id]
                );
            }

            if (payload.name !== undefined) {
                const existing = await client.query(
                    'SELECT user_id FROM student_profiles WHERE user_id = $1',
                    [id]
                );
                if (existing.rows.length > 0) {
                    await client.query(
                        'UPDATE student_profiles SET name = $1, updated_at = NOW() WHERE user_id = $2',
                        [payload.name, id]
                    );
                } else {
                    await client.query(
                        'INSERT INTO student_profiles (user_id, name) VALUES ($1, $2)',
                        [id, payload.name]
                    );
                }
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        return this.getById(id);
    }

    /**
     * Permanently delete a student and all associated data.
     * If the user is also a teacher, delegate to AdminTeachersService.deleteTeacher
     * so that teacher-owned courses, videos, and storage objects are cleaned up too.
     */
    async deleteStudent(id) {
        const userRes = await db.query(
            `SELECT 
                u.id,
                u.role,
                EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.user_id = u.id) AS has_teacher_profile
             FROM users u
             WHERE u.id = $1`,
            [id]
        );
        const userRow = userRes.rows[0];
        if (!userRow) {
            throw new Error('Student not found');
        }

        const isAlsoTeacher = userRow.role === 'teacher' || userRow.has_teacher_profile === true;

        if (isAlsoTeacher) {
            const result = await adminTeachersService.deleteTeacher(id);
            return {
                message: result.message || 'Student (who was also a teacher) and all associated data have been permanently removed.',
                wasAlsoTeacher: true,
            };
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            const delRes = await client.query('DELETE FROM users WHERE id = $1', [id]);
            if (delRes.rowCount === 0) {
                throw new Error('Student not found');
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        return { message: 'Student and all associated data have been permanently removed.', wasAlsoTeacher: false };
    }
}

module.exports = new AdminStudentsService();
