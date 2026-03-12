const db = require('../../db');

class AdminTeachersService {
    async list(skip = 0, limit = 10) {
        // Teacher rating from teacher_reviews (students review teacher directly)
        const avgRatingQuery = `(SELECT COALESCE(AVG(tr.rating), 0)::numeric(3,2) FROM teacher_reviews tr WHERE tr.teacher_id = u.id)`;

        const result = await db.query(
            `SELECT 
                u.id,
                u.email,
                u.created_at,
                COALESCE(tp.name, u.email) as name,
                tp.bio,
                tp.institute_name,
                (SELECT COUNT(*)::int FROM courses c WHERE c.teacher_id = u.id) as course_count,
                (SELECT COUNT(DISTINCT ce.user_id)::int FROM course_enrollments ce
                 JOIN courses c ON ce.course_id = c.id WHERE c.teacher_id = u.id) as student_count,
                ${avgRatingQuery} as avg_rating
             FROM users u
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE (u.role = 'teacher' OR tp.user_id IS NOT NULL)
             ORDER BY u.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, skip]
        );

        const countResult = await db.query(
            `SELECT COUNT(*)::int as total
             FROM users u
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE (u.role = 'teacher' OR tp.user_id IS NOT NULL)`
        );
        const total = countResult.rows[0]?.total || 0;

        const teachers = result.rows.map(row => ({
            id: row.id,
            email: row.email,
            name: row.name || row.email,
            bio: row.bio || null,
            instituteName: row.institute_name || null,
            courses: parseInt(row.course_count, 10) || 0,
            students: parseInt(row.student_count, 10) || 0,
            rating: parseFloat(row.avg_rating) || 0,
            joinedAt: row.created_at,
        }));

        return { teachers, total };
    }

    async getById(id) {
        const result = await db.query(
            `SELECT 
                u.id,
                u.email,
                u.created_at,
                tp.name,
                tp.bio,
                tp.institute_name,
                tp.account_email,
                tp.address,
                tp.profile_image_path,
                tp.youtube_url,
                tp.linkedin_url,
                (SELECT COUNT(*)::int FROM courses c WHERE c.teacher_id = u.id) as course_count,
                (SELECT COUNT(DISTINCT ce.user_id)::int FROM course_enrollments ce
                 JOIN courses c ON ce.course_id = c.id WHERE c.teacher_id = u.id) as student_count
             FROM users u
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE u.id = $1 AND u.role = 'teacher'`,
            [id]
        );
        const row = result.rows[0];
        if (!row) return null;

        const trResult = await db.query(
            `SELECT COALESCE(AVG(rating), 0)::float as avg_rating, COUNT(*)::int as review_count
             FROM teacher_reviews WHERE teacher_id = $1`,
            [id]
        );
        const avgRating = parseFloat(trResult.rows[0]?.avg_rating) || 0;
        const reviewCount = parseInt(trResult.rows[0]?.review_count, 10) || 0;

        return {
            id: row.id,
            email: row.email,
            name: row.name || row.email,
            bio: row.bio || null,
            instituteName: row.institute_name || null,
            accountEmail: row.account_email || null,
            address: row.address || null,
            profileImagePath: row.profile_image_path || null,
            youtubeUrl: row.youtube_url || null,
            linkedinUrl: row.linkedin_url || null,
            courses: parseInt(row.course_count, 10) || 0,
            students: parseInt(row.student_count, 10) || 0,
            rating: avgRating,
            reviewCount,
            joinedAt: row.created_at,
        };
    }
}

module.exports = new AdminTeachersService();
