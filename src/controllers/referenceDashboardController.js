const db = require('../../db');

class ReferenceDashboardController {
    async getStats(req, res) {
        try {
            const marketerId = req.user.id;

            // Marketer profile
            const profileRes = await db.query('SELECT * FROM marketers WHERE id = $1', [marketerId]);
            const profile = profileRes.rows[0];
            if (!profile) return res.status(404).json({ error: 'Profile not found' });

            // Total teachers referred
            const teacherRes = await db.query('SELECT COUNT(*) as count FROM teacher_profiles WHERE referred_by = $1', [marketerId]);
            const totalTeachers = parseInt(teacherRes.rows[0].count) || 0;

            // Total courses by these teachers
            const courseRes = await db.query(
                `SELECT COUNT(*) as count FROM courses c
                 JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
                 WHERE tp.referred_by = $1`, [marketerId]
            );
            const totalCourses = parseInt(courseRes.rows[0].count) || 0;

            // Total students enrolled in these courses
            const studentRes = await db.query(
                `SELECT COUNT(DISTINCT ce.user_id) as count FROM course_enrollments ce
                 JOIN courses c ON ce.course_id = c.id
                 JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
                 WHERE tp.referred_by = $1`, [marketerId]
            );
            const totalStudents = parseInt(studentRes.rows[0].count) || 0;

            // Earning stats from course_commissions
            const earningRes = await db.query(
                `SELECT SUM(marketer_commission) as total FROM course_commissions WHERE marketer_id = $1`, [marketerId]
            );
            const calculatedTotalEarnings = parseFloat(earningRes.rows[0].total) || 0;

            res.json({
                referralCode: profile.referral_code,
                totalTeachers,
                totalCourses,
                totalStudents,
                totalEarnings: profile.total_earnings > 0 ? parseFloat(profile.total_earnings) : calculatedTotalEarnings,
                withdrawnAmount: parseFloat(profile.withdrawn_amount) || 0
            });
        } catch (error) {
            console.error('Reference Stats error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getTeachers(req, res) {
        try {
            const marketerId = req.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const search = req.query.search || '';
            const offset = (page - 1) * limit;

            let queryParams = [marketerId];
            let searchCondition = '';
            
            if (search) {
                searchCondition = ` AND (tp.name ILIKE $2 OR tp.original_phone ILIKE $2 OR u.email ILIKE $2)`;
                queryParams.push(`%${search}%`);
            }

            const countQuery = `
                 SELECT COUNT(*) FROM users u
                 JOIN teacher_profiles tp ON u.id = tp.user_id
                 WHERE tp.referred_by = $1 ${searchCondition}`;
            
            const totalRes = await db.query(countQuery, queryParams);
            const total = parseInt(totalRes.rows[0].count);

            let dataQuery = `
                 SELECT u.id, u.email, tp.name, tp.original_phone as phone, tp.created_at,
                 (SELECT COUNT(*) FROM courses c WHERE c.teacher_id = u.id) as course_count
                 FROM users u
                 JOIN teacher_profiles tp ON u.id = tp.user_id
                 WHERE tp.referred_by = $1 ${searchCondition}
                 ORDER BY tp.created_at DESC
                 LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
            
            const dataRes = await db.query(dataQuery, [...queryParams, limit, offset]);

            res.json({
                data: dataRes.rows,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            });
        } catch (error) {
            console.error('Reference Teachers error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getCourses(req, res) {
        try {
            const marketerId = req.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const search = req.query.search || '';
            const teacherId = req.query.teacher_id || '';
            const offset = (page - 1) * limit;

            let queryParams = [marketerId];
            let conditions = 'tp.referred_by = $1';
            
            if (search) {
                queryParams.push(`%${search}%`);
                conditions += ` AND (c.title ILIKE $${queryParams.length})`;
            }
            if (teacherId) {
                queryParams.push(teacherId);
                conditions += ` AND (c.teacher_id = $${queryParams.length})`;
            }

            const countQuery = `
                 SELECT COUNT(*) FROM courses c
                 JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
                 WHERE ${conditions}`;
            
            const totalRes = await db.query(countQuery, queryParams);
            const total = parseInt(totalRes.rows[0].count);

            const dataQuery = `
                 SELECT c.id, c.title, c.price, c.discount_price, c.status, c.created_at, tp.name as teacher_name,
                 (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id) as enrollments
                 FROM courses c
                 JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
                 WHERE ${conditions}
                 ORDER BY c.created_at DESC
                 LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
            
            const dataRes = await db.query(dataQuery, [...queryParams, limit, offset]);

            res.json({
                data: dataRes.rows,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            });
        } catch (error) {
            console.error('Reference Courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getStudents(req, res) {
        try {
            const marketerId = req.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const search = req.query.search || '';
            const teacherId = req.query.teacher_id || '';
            const courseId = req.query.course_id || '';
            const offset = (page - 1) * limit;

            let queryParams = [marketerId];
            let conditions = 'tp.referred_by = $1';
            
            if (search) {
                queryParams.push(`%${search}%`);
                conditions += ` AND (sp.name ILIKE $${queryParams.length} OR u.email ILIKE $${queryParams.length})`;
            }
            if (teacherId) {
                queryParams.push(teacherId);
                conditions += ` AND (c.teacher_id = $${queryParams.length})`;
            }
            if (courseId) {
                queryParams.push(courseId);
                conditions += ` AND (c.id = $${queryParams.length})`;
            }

            const countQuery = `
                 SELECT COUNT(DISTINCT u.id) FROM users u
                 JOIN course_enrollments ce ON u.id = ce.user_id
                 JOIN courses c ON ce.course_id = c.id
                 LEFT JOIN student_profiles sp ON u.id = sp.user_id
                 JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
                 WHERE ${conditions}`;
            
            const totalRes = await db.query(countQuery, queryParams);
            const total = parseInt(totalRes.rows[0].count);

            const dataQuery = `
                 SELECT DISTINCT u.id, u.email, sp.name, sp.phone, c.title as course_title, ce.enrolled_at, cc.marketer_commission
                 FROM users u
                 JOIN course_enrollments ce ON u.id = ce.user_id
                 JOIN courses c ON ce.course_id = c.id
                 LEFT JOIN student_profiles sp ON u.id = sp.user_id
                 LEFT JOIN course_commissions cc ON cc.course_id = c.id AND cc.student_id = u.id
                 JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
                 WHERE ${conditions}
                 ORDER BY ce.enrolled_at DESC
                 LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
            
            const dataRes = await db.query(dataQuery, [...queryParams, limit, offset]);

            res.json({
                data: dataRes.rows,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            });
        } catch (error) {
            console.error('Reference Students error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getEarnings(req, res) {
        try {
            const marketerId = req.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const countRes = await db.query('SELECT COUNT(*) FROM course_commissions WHERE marketer_id = $1', [marketerId]);
            const total = parseInt(countRes.rows[0].count);

            const result = await db.query(
                `SELECT cc.id, cc.amount_paid, cc.marketer_commission, cc.created_at, c.title as course_title
                 FROM course_commissions cc
                 JOIN courses c ON cc.course_id = c.id
                 WHERE cc.marketer_id = $1
                 ORDER BY cc.created_at DESC
                 LIMIT $2 OFFSET $3`, [marketerId, limit, offset]
            );
            
            res.json({
                data: result.rows,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            });
        } catch (error) {
            console.error('Reference Earnings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new ReferenceDashboardController();
