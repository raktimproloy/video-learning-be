const db = require('../../db');
const adminTeachersService = require('./adminTeachersService');
const { hasColumn } = require('../utils/dbSchemaCache');

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
                COALESCE(u.core_member, false) as core_member,
                u.created_at,
                u.status,
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
            coreMember: !!row.core_member,
            status: row.status || 'active',
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
        const hasBio = await hasColumn('student_profiles', 'bio');
        const bioSelect = hasBio ? 'sp.bio' : 'NULL::text as bio';
        const result = await db.query(
            `SELECT 
                u.id,
                u.email,
                u.role,
                COALESCE(u.core_member, false) as core_member,
                u.created_at,
                u.status,
                u.suspended_reason,
                u.suspended_at,
                sp.name,
                ${bioSelect},
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
            coreMember: !!row.core_member,
            status: row.status || 'active',
            suspendedReason: row.suspended_reason || null,
            suspendedAt: row.suspended_at || null,
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

            if (payload.coreMember !== undefined) {
                await client.query(
                    'UPDATE users SET core_member = $1 WHERE id = $2',
                    [!!payload.coreMember, id]
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
    async getFullReport(id) {
        const student = await this.getById(id);
        if (!student) return null;

        // 1. Enrollments
        const enrollmentsRes = await db.query(
            `SELECT ce.created_at as enrolled_at, c.id as course_id, c.title as course_title, 
                    COALESCE(tp.name, u.email) as teacher_name, ce.price_paid, ce.currency
             FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id
             JOIN users u ON c.teacher_id = u.id
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE ce.user_id = $1
             ORDER BY ce.created_at DESC`,
            [id]
        );

        // Try to get completion data if progress_summaries exists
        let enrollments = enrollmentsRes.rows;
        const progressCheck = await db.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'progress_summaries')`);
        if (progressCheck.rows[0]?.exists) {
            const progRes = await db.query(
                `SELECT course_id, completed, completed_lessons, total_lessons, last_activity_at 
                 FROM progress_summaries WHERE user_id = $1`,
                [id]
            );
            const progMap = {};
            progRes.rows.forEach(p => { progMap[p.course_id] = p; });
            enrollments = enrollments.map(e => ({
                ...e,
                completed: progMap[e.course_id]?.completed || false,
                completed_lessons: progMap[e.course_id]?.completed_lessons || 0,
                total_lessons: progMap[e.course_id]?.total_lessons || 0,
                last_activity_at: progMap[e.course_id]?.last_activity_at || null,
                completion_rate: progMap[e.course_id]?.total_lessons > 0 ? Math.round((progMap[e.course_id].completed_lessons / progMap[e.course_id].total_lessons) * 100) : 0
            }));
        }

        // 2. Payment Requests
        const paymentsRes = await db.query(
            `SELECT id, amount, currency, payment_method, status, created_at, updated_at
             FROM payment_requests
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [id]
        );

        // 3. Exam Submissions
        const examsRes = await db.query(
            `SELECT es.id, es.score, es.percentage, es.time_taken_ms, es.submitted_at, 
                    e.title as exam_title, e.total_marks, c.title as course_title
             FROM exam_submissions es
             JOIN exams e ON es.exam_id = e.id
             LEFT JOIN courses c ON e.course_id = c.id
             WHERE es.student_id = $1
             ORDER BY es.submitted_at DESC`,
            [id]
        );

        // 4. Video Watches (Sessions)
        const watchesRes = await db.query(
            `SELECT vw.last_position_updated_at AS last_watched_at, v.title as video_title, c.title as course_title
             FROM video_watch_progress vw
             JOIN videos v ON vw.video_id = v.id
             LEFT JOIN lessons l ON v.lesson_id = l.id
             LEFT JOIN courses c ON l.course_id = c.id
             WHERE vw.user_id = $1
             ORDER BY vw.last_position_updated_at DESC
             LIMIT 50`,
            [id]
        );

        return {
            student,
            enrollments,
            paymentRequests: paymentsRes.rows,
            examSubmissions: examsRes.rows,
            recentActivity: watchesRes.rows
        };
    }
}

module.exports = new AdminStudentsService();
