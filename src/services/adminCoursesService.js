const db = require('../../db');

class AdminCoursesService {
    async list(skip = 0, limit = 10, q = null) {
        const reviewsCheck = await db.query(`
            SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'reviews')
        `);
        const hasReviews = reviewsCheck.rows[0]?.exists || false;
        const ratingQuery = hasReviews
            ? `(SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM reviews r WHERE r.course_id = c.id)`
            : `0::numeric(3,2)`;
        const reviewCountQuery = hasReviews
            ? `(SELECT COUNT(*)::int FROM reviews r WHERE r.course_id = c.id)`
            : `0::int`;

        let whereClause = '';
        const params = [];
        if (q && String(q).trim()) {
            const search = `%${String(q).trim().replace(/%/g, '\\%')}%`;
            whereClause = `WHERE (c.title ILIKE $1 OR c.description ILIKE $1)`;
            params.push(search);
        }

        params.push(limit, skip);
        const limitIdx = params.length - 1;
        const offsetIdx = params.length;

        const countResult = await db.query(
            `SELECT COUNT(*)::int as total FROM courses c ${whereClause}`,
            params.slice(0, params.length - 2)
        );
        const total = countResult.rows[0]?.total || 0;

        const result = await db.query(
            `SELECT 
                c.id,
                c.title,
                c.description,
                c.short_description,
                c.price,
                c.discount_price,
                c.currency,
                c.level,
                c.status,
                c.created_at,
                c.teacher_id,
                ac.name as category_name,
                users.email as teacher_email,
                COALESCE(tp.name, users.email) as teacher_name,
                (SELECT COUNT(*)::int FROM course_enrollments ce WHERE ce.course_id = c.id) as purchase_count,
                (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id = c.id) as lesson_count,
                (SELECT COUNT(*)::int FROM videos v 
                 JOIN lessons l ON v.lesson_id = l.id WHERE l.course_id = c.id) as video_count,
                ${ratingQuery} as rating,
                ${reviewCountQuery} as review_count
             FROM courses c
             LEFT JOIN users ON c.teacher_id = users.id
             LEFT JOIN teacher_profiles tp ON users.id = tp.user_id
             LEFT JOIN admin_categories ac ON c.admin_category_id = ac.id
             ${whereClause}
             ORDER BY c.created_at DESC
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            params
        );

        const courses = result.rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description || row.short_description || '',
            price: parseFloat(row.price) || 0,
            discountPrice: row.discount_price ? parseFloat(row.discount_price) : null,
            currency: row.currency || 'USD',
            level: row.level || null,
            status: row.status || 'active',
            teacherId: row.teacher_id,
            teacherName: row.teacher_name || row.teacher_email || 'Unknown',
            teacherEmail: row.teacher_email,
            category: row.category_name || row.category || null,
            students: parseInt(row.purchase_count, 10) || 0,
            lessons: parseInt(row.lesson_count, 10) || 0,
            videos: parseInt(row.video_count, 10) || 0,
            rating: parseFloat(row.rating) || 0,
            reviewCount: parseInt(row.review_count, 10) || 0,
            createdAt: row.created_at,
        }));

        return { courses, total };
    }

    async getById(id) {
        const reviewsCheck = await db.query(`
            SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'reviews')
        `);
        const hasReviews = reviewsCheck.rows[0]?.exists || false;
        const ratingQuery = hasReviews
            ? `(SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM reviews r WHERE r.course_id = c.id)`
            : `0::numeric(3,2)`;
        const reviewCountQuery = hasReviews
            ? `(SELECT COUNT(*)::int FROM reviews r WHERE r.course_id = c.id)`
            : `0::int`;

        const result = await db.query(
            `SELECT 
                c.*,
                ac.name as category_name,
                users.email as teacher_email,
                COALESCE(tp.name, users.email) as teacher_name,
                (SELECT COUNT(*)::int FROM course_enrollments ce WHERE ce.course_id = c.id) as purchase_count,
                (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id = c.id) as lesson_count,
                (SELECT COUNT(*)::int FROM videos v 
                 JOIN lessons l ON v.lesson_id = l.id WHERE l.course_id = c.id) as video_count,
                ${ratingQuery} as rating,
                ${reviewCountQuery} as review_count
             FROM courses c
             LEFT JOIN users ON c.teacher_id = users.id
             LEFT JOIN teacher_profiles tp ON users.id = tp.user_id
             LEFT JOIN admin_categories ac ON c.admin_category_id = ac.id
             WHERE c.id = $1`,
            [id]
        );
        const row = result.rows[0];
        if (!row) return null;

        return {
            id: row.id,
            title: row.title,
            description: row.description || row.short_description || row.full_description || '',
            shortDescription: row.short_description,
            fullDescription: row.full_description,
            price: parseFloat(row.price) || 0,
            discountPrice: row.discount_price ? parseFloat(row.discount_price) : null,
            currency: row.currency || 'USD',
            level: row.level,
            status: row.status || 'active',
            teacherId: row.teacher_id,
            teacherName: row.teacher_name || row.teacher_email || 'Unknown',
            teacherEmail: row.teacher_email,
            category: row.category_name || row.category,
            adminCategoryId: row.admin_category_id,
            students: parseInt(row.purchase_count, 10) || 0,
            lessons: parseInt(row.lesson_count, 10) || 0,
            videos: parseInt(row.video_count, 10) || 0,
            rating: parseFloat(row.rating) || 0,
            reviewCount: parseInt(row.review_count, 10) || 0,
            thumbnailPath: row.thumbnail_path,
            language: row.language || 'English',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

module.exports = new AdminCoursesService();
