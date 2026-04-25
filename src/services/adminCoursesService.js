const db = require('../../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class AdminCoursesService {
    /**
     * @param {string} [listType] 'platform' = lesson/video courses (excludes external). 'external' = URL-only courses.
     */
    async list(skip = 0, limit = 10, q = null, listType = 'platform') {
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

        const conds = [];
        const params = [];
        if (q && String(q).trim()) {
            const search = `%${String(q).trim().replace(/%/g, '\\%')}%`;
            const idx = params.length + 1;
            conds.push(
                `(c.title ILIKE $${idx} OR c.description ILIKE $${idx} OR c.short_description ILIKE $${idx})`
            );
            params.push(search);
        }
        if (listType === 'external') {
            conds.push(`c.course_type = 'external'`);
        } else {
            conds.push(`(c.course_type IS NULL OR c.course_type <> 'external')`);
        }
        const whereClause = `WHERE ${conds.join(' AND ')}`;

        const countResult = await db.query(
            `SELECT COUNT(*)::int as total FROM courses c 
             LEFT JOIN users ON c.teacher_id = users.id
             LEFT JOIN teacher_profiles tp ON users.id = tp.user_id
             LEFT JOIN admin_categories ac ON c.admin_category_id = ac.id
             ${whereClause}`,
            params
        );
        const total = countResult.rows[0]?.total || 0;

        params.push(limit, skip);
        const limitIdx = params.length - 1;
        const offsetIdx = params.length;

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
                c.language,
                c.course_type,
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

        const courses = result.rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description || row.short_description || '',
            price: parseFloat(row.price) || 0,
            discountPrice: row.discount_price ? parseFloat(row.discount_price) : null,
            currency: row.currency || 'USD',
            level: row.level || null,
            language: row.language || null,
            courseType: row.course_type || null,
            status: row.status || 'active',
            teacherId: row.teacher_id,
            teacherName: row.teacher_id
                ? row.teacher_name || row.teacher_email || 'Unknown'
                : '—',
            teacherEmail: row.teacher_id ? row.teacher_email : null,
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

        let tags = [];
        try {
            tags = row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : [];
        } catch {
            tags = [];
        }

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
            language: row.language || 'English',
            subtitle: row.subtitle,
            courseType: row.course_type,
            hasLiveClass: row.has_live_class,
            hasAssignments: row.has_assignments,
            tags,
            teacherId: row.teacher_id,
            teacherName: row.teacher_id
                ? row.teacher_name || row.teacher_email || 'Unknown'
                : null,
            teacherEmail: row.teacher_id ? row.teacher_email : null,
            category: row.category_name || row.category,
            adminCategoryId: row.admin_category_id,
            students: parseInt(row.purchase_count, 10) || 0,
            lessons: parseInt(row.lesson_count, 10) || 0,
            videos: parseInt(row.video_count, 10) || 0,
            rating: parseFloat(row.rating) || 0,
            reviewCount: parseInt(row.review_count, 10) || 0,
            thumbnailPath: row.thumbnail_path,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            externalUrl: row.external_url ?? null,
            externalIntroVideoUrl: row.external_intro_video_url ?? null,
            externalWhatsapp: row.external_whatsapp ?? null,
            externalPhone: row.external_phone ?? null,
            priceDisplayPeriod: row.price_display_period ?? null,
            visitorCount: row.visitor_count != null ? parseInt(row.visitor_count, 10) : 0,
        };
    }

    /**
     * Full stats for a course: rating, reviewCount, totalViews, purchaseCount, videos with view_count.
     * Used by admin panel to view and edit ratings, reviews, views.
     */
    async getCourseStats(courseId) {
        const courseExists = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
        if (!courseExists.rows[0]) return null;

        const reviewsCheck = await db.query(`
            SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reviews')
        `);
        const hasReviews = reviewsCheck.rows[0]?.exists || false;

        const ratingResult = hasReviews
            ? await db.query(
                'SELECT COALESCE(AVG(rating), 0)::float as avg_rating, COUNT(*)::int as total FROM reviews WHERE course_id = $1',
                [courseId]
            )
            : { rows: [{ avg_rating: 0, total: 0 }] };
        const purchaseResult = await db.query(
            'SELECT COUNT(*)::int as total FROM course_enrollments WHERE course_id = $1',
            [courseId]
        );
        const videosResult = await db.query(
            `SELECT v.id, v.title, v.order, v.view_count, l.id as lesson_id, l.title as lesson_title, l."order" as lesson_order
             FROM videos v
             JOIN lessons l ON v.lesson_id = l.id
             WHERE l.course_id = $1
             ORDER BY l."order" ASC NULLS LAST, v."order" ASC NULLS LAST`,
            [courseId]
        );

        const videos = videosResult.rows.map((r) => ({
            id: r.id,
            title: r.title,
            order: r.order,
            viewCount: parseInt(r.view_count, 10) || 0,
            lessonId: r.lesson_id,
            lessonTitle: r.lesson_title,
            lessonOrder: r.lesson_order,
        }));
        const totalViews = videos.reduce((sum, v) => sum + (v.viewCount || 0), 0);

        return {
            courseId,
            rating: parseFloat(ratingResult.rows[0]?.avg_rating) || 0,
            reviewCount: parseInt(ratingResult.rows[0]?.total, 10) || 0,
            totalViews,
            purchaseCount: parseInt(purchaseResult.rows[0]?.total, 10) || 0,
            videos,
        };
    }

    /**
     * List reviews for a course (admin). Paginated.
     */
    async getCourseReviews(courseId, limit = 20, offset = 0) {
        const courseExists = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
        if (!courseExists.rows[0]) return null;

        const countResult = await db.query(
            'SELECT COUNT(*)::int as total FROM reviews WHERE course_id = $1',
            [courseId]
        );
        const total = parseInt(countResult.rows[0]?.total, 10) || 0;

        const result = await db.query(
            `SELECT r.id, r.user_id, r.course_id, r.rating, r.comment, r.created_at, r.updated_at,
                    u.email as user_email, COALESCE(sp.name, u.email) as user_name
             FROM reviews r
             JOIN users u ON r.user_id = u.id
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             WHERE r.course_id = $1
             ORDER BY r.created_at DESC
             LIMIT $2 OFFSET $3`,
            [courseId, Math.min(50, Math.max(1, limit)), Math.max(0, offset)]
        );

        const reviews = result.rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            courseId: r.course_id,
            rating: parseInt(r.rating, 10),
            comment: r.comment || null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            userEmail: r.user_email,
            userName: r.user_name || r.user_email,
        }));

        return { reviews, total };
    }

    /**
     * Single review in the same shape as getCourseReviews list items (camelCase for admin API).
     */
    async getReviewAdminById(reviewId) {
        const result = await db.query(
            `SELECT r.id, r.user_id, r.course_id, r.rating, r.comment, r.created_at, r.updated_at,
                    u.email as user_email, COALESCE(sp.name, u.email) as user_name
             FROM reviews r
             JOIN users u ON r.user_id = u.id
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             WHERE r.id = $1`,
            [reviewId]
        );
        const r = result.rows[0];
        if (!r) return null;
        return {
            id: r.id,
            userId: r.user_id,
            courseId: r.course_id,
            rating: parseInt(r.rating, 10),
            comment: r.comment || null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            userEmail: r.user_email,
            userName: r.user_name || r.user_email,
        };
    }

    /**
     * Ensure video belongs to course (via lesson). Returns video row or null.
     */
    async getVideoInCourse(courseId, videoId) {
        const result = await db.query(
            `SELECT v.id, v.view_count, v.title
             FROM videos v
             JOIN lessons l ON v.lesson_id = l.id
             WHERE l.course_id = $1 AND v.id = $2`,
            [courseId, videoId]
        );
        return result.rows[0] || null;
    }

    /**
     * Set view_count for a video. Admin only. Video must belong to course.
     */
    async setVideoViewCount(courseId, videoId, viewCount) {
        const video = await this.getVideoInCourse(courseId, videoId);
        if (!video) return null;
        const count = Math.max(0, parseInt(viewCount, 10) || 0);
        await db.query(
            'UPDATE videos SET view_count = $1 WHERE id = $2',
            [count, videoId]
        );
        return { id: videoId, viewCount: count };
    }

    /**
     * List enrollments for a course (admin). Paginated.
     */
    async getCourseEnrollments(courseId, limit = 50, offset = 0) {
        const courseExists = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
        if (!courseExists.rows[0]) return null;

        const countResult = await db.query(
            'SELECT COUNT(*)::int as total FROM course_enrollments WHERE course_id = $1',
            [courseId]
        );
        const total = parseInt(countResult.rows[0]?.total, 10) || 0;

        const result = await db.query(
            `SELECT ce.course_id, ce.user_id, ce.enrolled_at, ce.amount_paid, ce.currency,
                    u.email as user_email, COALESCE(sp.name, u.email) as user_name
             FROM course_enrollments ce
             JOIN users u ON ce.user_id = u.id
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             WHERE ce.course_id = $1
             ORDER BY ce.enrolled_at DESC
             LIMIT $2 OFFSET $3`,
            [courseId, Math.min(100, Math.max(1, limit)), Math.max(0, offset)]
        );

        const enrollments = result.rows.map((r) => ({
            id: `${r.course_id}-${r.user_id}`,
            courseId: r.course_id,
            userId: r.user_id,
            enrolledAt: r.enrolled_at,
            amountPaid: r.amount_paid != null ? parseFloat(r.amount_paid) : null,
            currency: r.currency || null,
            userEmail: r.user_email,
            userName: r.user_name || r.user_email,
        }));

        return { enrollments, total };
    }

    /**
     * Add dummy student enrollments to a course (admin only).
     * Creates count users with email dummy-{uuid}@admin-seed.local and enrolls each in the course.
     * @param {string} courseId - Course UUID
     * @param {number} count - Number of dummy enrollments (1–100)
     * @returns {{ added: number }}
     */
    async addDummyEnrollments(courseId, count) {
        const courseExists = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
        if (!courseExists.rows[0]) return null;

        const num = Math.min(100, Math.max(1, parseInt(count, 10) || 0));
        if (num < 1) return { added: 0 };

        const placeholderHash = await bcrypt.hash('DummyStudent1!', 10);
        let added = 0;

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            for (let i = 0; i < num; i++) {
                const unique = crypto.randomBytes(8).toString('hex');
                const email = `dummy-${unique}@admin-seed.local`;
                const insertUser = await client.query(
                    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'student') RETURNING id`,
                    [email, placeholderHash]
                );
                const userId = insertUser.rows[0]?.id;
                if (!userId) continue;
                const insertEnroll = await client.query(
                    `INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT (user_id, course_id) DO NOTHING`,
                    [userId, courseId]
                );
                if (insertEnroll.rowCount > 0) added++;
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        return { added };
    }

    /**
     * Add a single review to a course (admin only). Creates one dummy student with the given name,
     * enrolls them, and adds the review with the given rating and comment.
     * @param {string} courseId - Course UUID
     * @param {{ studentName: string, review: string, rating: number }} data
     * @returns {{ id: string, userId: string } | null}
     */
    async addSingleReview(courseId, data) {
        const courseExists = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
        if (!courseExists.rows[0]) return null;

        const reviewsExist = await db.query(`
            SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reviews')
        `);
        if (!reviewsExist.rows[0]?.exists) return null;

        const studentName = String(data.studentName || 'Student').trim() || 'Student';
        const review = data.review != null ? String(data.review).trim() : null;
        const rating = Math.min(5, Math.max(1, parseInt(data.rating, 10) || 5));

        const placeholderHash = await bcrypt.hash('DummyStudent1!', 10);
        const unique = crypto.randomBytes(8).toString('hex');
        const email = `dummy-${unique}@admin-seed.local`;

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            const insertUser = await client.query(
                `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'student') RETURNING id`,
                [email, placeholderHash]
            );
            const userId = insertUser.rows[0]?.id;
            if (!userId) {
                await client.query('ROLLBACK');
                return null;
            }
            await client.query(
                `INSERT INTO student_profiles (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET name = $2`,
                [userId, studentName]
            );
            await client.query(
                `INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT (user_id, course_id) DO NOTHING`,
                [userId, courseId]
            );
            const insertReview = await client.query(
                `INSERT INTO reviews (user_id, course_id, rating, comment) VALUES ($1, $2, $3, $4) RETURNING id`,
                [userId, courseId, rating, review]
            );
            const reviewRow = insertReview.rows[0];
            await client.query('COMMIT');
            return reviewRow ? { id: reviewRow.id, userId } : null;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}

module.exports = new AdminCoursesService();
