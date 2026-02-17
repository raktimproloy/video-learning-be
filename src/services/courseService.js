const db = require('../../db');

class CourseService {
    async createCourse(teacherId, courseData) {
        const {
            title,
            shortDescription,
            fullDescription,
            category,
            subcategory,
            tags,
            language,
            subtitle,
            level,
            courseType,
            thumbnailPath,
            introVideoPath,
            price,
            discountPrice,
            currency,
            hasLiveClass,
            hasAssignments
        } = courseData;

        const result = await db.query(
            `INSERT INTO courses (
                teacher_id, title, description, short_description, full_description,
                category, subcategory, tags, language, subtitle, level, course_type,
                thumbnail_path, intro_video_path, price, discount_price, currency,
                has_live_class, has_assignments
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            RETURNING *`,
            [
                teacherId,
                title,
                shortDescription || fullDescription || '', // description for backward compatibility
                shortDescription || null,
                fullDescription || null,
                category || null,
                subcategory || null,
                JSON.stringify(tags || []),
                language || 'English',
                subtitle || null,
                level || null,
                courseType || 'lesson-based',
                thumbnailPath || null,
                introVideoPath || null,
                price ? parseFloat(price) : null,
                discountPrice ? parseFloat(discountPrice) : null,
                currency || 'USD',
                hasLiveClass || false,
                hasAssignments || false
            ]
        );
        return result.rows[0];
    }

    async getCoursesByTeacher(teacherId) {
        // Check if reviews table exists
        const tableCheck = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'reviews'
            );
        `);
        const reviewsTableExists = tableCheck.rows[0]?.exists || false;

        // Build query with conditional reviews subqueries
        const reviewsRatingQuery = reviewsTableExists 
            ? `(SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM reviews r WHERE r.course_id = c.id)`
            : `0::numeric(3,2)`;
        const reviewsCountQuery = reviewsTableExists
            ? `(SELECT COUNT(*)::int FROM reviews r WHERE r.course_id = c.id)`
            : `0::int`;

        const result = await db.query(
            `SELECT 
                c.*,
                CASE 
                    WHEN c.tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(c.tags) = 'string' THEN c.tags::jsonb
                    ELSE c.tags
                END as tags,
                (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id = c.id) as total_lessons,
                (SELECT COUNT(*)::int FROM videos v 
                 JOIN lessons l ON v.lesson_id = l.id 
                 WHERE l.course_id = c.id) as total_videos,
                (SELECT COUNT(*)::int FROM course_enrollments ce WHERE ce.course_id = c.id) as purchase_count,
                ${reviewsRatingQuery} as rating,
                ${reviewsCountQuery} as review_count
            FROM courses c
            WHERE c.teacher_id = $1 
            ORDER BY c.created_at DESC`,
            [teacherId]
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
            total_lessons: row.total_lessons || 0,
            total_videos: row.total_videos || 0,
            purchase_count: row.purchase_count || 0,
            rating: parseFloat(row.rating) || 0,
            review_count: row.review_count || 0
        }));
    }

    async getAllCourses(userId = null) {
        // Build query with optional purchase/ownership check
        let purchaseCheck = '';
        let ownershipCheck = '';
        const params = [];
        
        if (userId) {
            purchaseCheck = `, EXISTS(
                SELECT 1 FROM course_enrollments ce 
                WHERE ce.course_id = courses.id AND ce.user_id = $1
            ) as is_purchased`;
            ownershipCheck = `, (courses.teacher_id = $1) as is_owned`;
            params.push(userId);
        } else {
            purchaseCheck = `, false as is_purchased`;
            ownershipCheck = `, false as is_owned`;
        }
        
        // Check if reviews table exists for rating/review_count
        const reviewsTableCheck = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'reviews'
            )
        `);
        const hasReviewsTable = reviewsTableCheck.rows[0]?.exists || false;
        
        const reviewsRatingQuery = hasReviewsTable
            ? `(SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM reviews r WHERE r.course_id = courses.id)`
            : `0::numeric(3,2)`;
        
        const reviewsCountQuery = hasReviewsTable
            ? `(SELECT COUNT(*)::int FROM reviews r WHERE r.course_id = courses.id)`
            : `0::int`;
        
        const result = await db.query(
            `SELECT 
                courses.*,
                users.email as teacher_email,
                CASE 
                    WHEN courses.tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(courses.tags) = 'string' THEN courses.tags::jsonb
                    ELSE courses.tags
                END as tags
                ${purchaseCheck}
                ${ownershipCheck},
                ${reviewsRatingQuery} as rating,
                ${reviewsCountQuery} as review_count,
                (SELECT COUNT(*)::int FROM course_enrollments ce WHERE ce.course_id = courses.id) as purchase_count,
                (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id = courses.id) as total_lessons,
                (SELECT COUNT(*)::int FROM videos v 
                 JOIN lessons l ON v.lesson_id = l.id 
                 WHERE l.course_id = courses.id) as total_videos
            FROM courses 
            LEFT JOIN users ON courses.teacher_id = users.id 
            ORDER BY courses.created_at DESC`,
            params
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
            is_purchased: row.is_purchased || false,
            is_owned: row.is_owned || false,
            rating: parseFloat(row.rating) || 0,
            review_count: row.review_count || 0,
            purchase_count: row.purchase_count || 0,
            total_lessons: row.total_lessons || 0,
            total_videos: row.total_videos || 0
        }));
    }

    async getCourseDetails(id, userId = null) {
        // Get course with all related data for details page
        const course = await this.getCourseById(id, userId);
        if (!course) return null;

        // Get teacher info
        const teacherResult = await db.query(
            `SELECT id, email, created_at 
             FROM users 
             WHERE id = $1`,
            [course.teacher_id]
        );
        const teacher = teacherResult.rows[0] || null;

        // Get lessons for this course
        const lessonService = require('./lessonService');
        const lessons = await lessonService.getLessonsByCourse(course.id, userId);

        // Get all videos for all lessons
        const videoService = require('./videoService');
        const videos = [];
        for (const lesson of lessons) {
            const lessonVideos = await videoService.getVideosByLesson(lesson.id, userId, lesson.isLocked || false);
            videos.push(...lessonVideos);
        }

        // Check if reviews table exists
        const reviewsTableCheck = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'reviews'
            )
        `);
        const hasReviewsTable = reviewsTableCheck.rows[0]?.exists || false;

        const reviewsRatingQuery = hasReviewsTable
            ? `(SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM reviews r WHERE r.course_id = courses.id)`
            : `0::numeric(3,2)`;
        
        const reviewsCountQuery = hasReviewsTable
            ? `(SELECT COUNT(*)::int FROM reviews r WHERE r.course_id = courses.id)`
            : `0::int`;

        // Get teacher's other courses (public, limit to 4)
        const otherCoursesResult = await db.query(
            `SELECT 
                courses.*,
                users.email as teacher_email,
                CASE 
                    WHEN courses.tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(courses.tags) = 'string' THEN courses.tags::jsonb
                    ELSE courses.tags
                END as tags,
                ${reviewsRatingQuery} as rating,
                ${reviewsCountQuery} as review_count,
                (SELECT COUNT(*)::int FROM course_enrollments ce WHERE ce.course_id = courses.id) as purchase_count,
                (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id = courses.id) as total_lessons,
                (SELECT COUNT(*)::int FROM videos v 
                 JOIN lessons l ON v.lesson_id = l.id 
                 WHERE l.course_id = courses.id) as total_videos
            FROM courses 
            LEFT JOIN users ON courses.teacher_id = users.id 
            WHERE courses.teacher_id = $1 AND courses.id != $2
            ORDER BY courses.created_at DESC
            LIMIT 4`,
            [course.teacher_id, course.id]
        );

        const otherCourses = otherCoursesResult.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
            rating: parseFloat(row.rating) || 0,
            review_count: row.review_count || 0,
            purchase_count: row.purchase_count || 0,
            total_lessons: row.total_lessons || 0,
            total_videos: row.total_videos || 0
        }));

        return {
            course,
            teacher: teacher ? {
                id: teacher.id,
                email: teacher.email,
                name: teacher.email, // Using email as name since we don't have name field
                location: '',
                totalStudents: course.purchase_count || 0,
                avatar: ''
            } : null,
            lessons,
            videos,
            otherCourses,
            reviews: [] // Reviews can be added later if needed
        };
    }

    async getCourseById(id, userId = null) {
        // Check if reviews table exists
        const reviewsTableCheck = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'reviews'
            )
        `);
        const hasReviewsTable = reviewsTableCheck.rows[0]?.exists || false;
        
        const reviewsRatingQuery = hasReviewsTable
            ? `(SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM reviews r WHERE r.course_id = courses.id)`
            : `0::numeric(3,2)`;
        
        const reviewsCountQuery = hasReviewsTable
            ? `(SELECT COUNT(*)::int FROM reviews r WHERE r.course_id = courses.id)`
            : `0::int`;
        
        // Build query with optional purchase/ownership check
        let purchaseCheck = '';
        let ownershipCheck = '';
        const params = [id];
        
        if (userId) {
            purchaseCheck = `, EXISTS(
                SELECT 1 FROM course_enrollments ce 
                WHERE ce.course_id = courses.id AND ce.user_id = $2
            ) as is_purchased`;
            ownershipCheck = `, (courses.teacher_id = $2) as is_owned`;
            params.push(userId);
        } else {
            purchaseCheck = `, false as is_purchased`;
            ownershipCheck = `, false as is_owned`;
        }
        
        const result = await db.query(
            `SELECT 
                courses.*,
                users.email as teacher_email,
                CASE 
                    WHEN courses.tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(courses.tags) = 'string' THEN courses.tags::jsonb
                    ELSE courses.tags
                END as tags
                ${purchaseCheck}
                ${ownershipCheck},
                ${reviewsRatingQuery} as rating,
                ${reviewsCountQuery} as review_count,
                (SELECT COUNT(*)::int FROM course_enrollments ce WHERE ce.course_id = courses.id) as purchase_count,
                (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id = courses.id) as total_lessons,
                (SELECT COUNT(*)::int FROM videos v 
                 JOIN lessons l ON v.lesson_id = l.id 
                 WHERE l.course_id = courses.id) as total_videos
            FROM courses 
            LEFT JOIN users ON courses.teacher_id = users.id 
            WHERE courses.id = $1`,
            params
        );
        
        if (!result.rows[0]) return null;
        
        const course = result.rows[0];
        // Parse tags if they're stored as JSON string
        return {
            ...course,
            tags: typeof course.tags === 'string' ? JSON.parse(course.tags) : (course.tags || []),
            is_purchased: course.is_purchased || false,
            is_owned: course.is_owned || false,
            rating: parseFloat(course.rating) || 0,
            review_count: course.review_count || 0,
            purchase_count: course.purchase_count || 0,
            total_lessons: course.total_lessons || 0,
            total_videos: course.total_videos || 0
        };
    }

    async getCourseByIdSimple(id) {
        const result = await db.query('SELECT * FROM courses WHERE id = $1', [id]);
        if (!result.rows[0]) return null;
        
        const course = result.rows[0];
        // Parse tags if they're stored as JSON string
        if (course.tags) {
            course.tags = typeof course.tags === 'string' ? JSON.parse(course.tags) : course.tags;
        }
        return course;
    }

    async updateCourse(id, courseData) {
        const {
            title,
            shortDescription,
            fullDescription,
            category,
            subcategory,
            tags,
            language,
            subtitle,
            level,
            courseType,
            thumbnailPath,
            introVideoPath,
            price,
            discountPrice,
            currency,
            hasLiveClass,
            hasAssignments
        } = courseData;

        // Build dynamic update query
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (title !== undefined) {
            updates.push(`title = $${paramIndex++}`);
            values.push(title);
        }
        if (shortDescription !== undefined) {
            updates.push(`short_description = $${paramIndex++}`);
            values.push(shortDescription);
        }
        if (fullDescription !== undefined) {
            updates.push(`full_description = $${paramIndex++}`);
            values.push(fullDescription);
        }
        if (category !== undefined) {
            updates.push(`category = $${paramIndex++}`);
            values.push(category);
        }
        if (subcategory !== undefined) {
            updates.push(`subcategory = $${paramIndex++}`);
            values.push(subcategory);
        }
        if (tags !== undefined) {
            updates.push(`tags = $${paramIndex++}`);
            values.push(JSON.stringify(tags));
        }
        if (language !== undefined) {
            updates.push(`language = $${paramIndex++}`);
            values.push(language);
        }
        if (subtitle !== undefined) {
            updates.push(`subtitle = $${paramIndex++}`);
            values.push(subtitle);
        }
        if (level !== undefined) {
            updates.push(`level = $${paramIndex++}`);
            values.push(level);
        }
        if (courseType !== undefined) {
            updates.push(`course_type = $${paramIndex++}`);
            values.push(courseType);
        }
        if (thumbnailPath !== undefined) {
            updates.push(`thumbnail_path = $${paramIndex++}`);
            values.push(thumbnailPath);
        }
        if (introVideoPath !== undefined) {
            updates.push(`intro_video_path = $${paramIndex++}`);
            values.push(introVideoPath);
        }
        if (price !== undefined) {
            updates.push(`price = $${paramIndex++}`);
            values.push(price ? parseFloat(price) : null);
        }
        if (discountPrice !== undefined) {
            updates.push(`discount_price = $${paramIndex++}`);
            values.push(discountPrice ? parseFloat(discountPrice) : null);
        }
        if (currency !== undefined) {
            updates.push(`currency = $${paramIndex++}`);
            values.push(currency);
        }
        if (hasLiveClass !== undefined) {
            updates.push(`has_live_class = $${paramIndex++}`);
            values.push(hasLiveClass);
        }
        if (hasAssignments !== undefined) {
            updates.push(`has_assignments = $${paramIndex++}`);
            values.push(hasAssignments);
        }

        // Always update updated_at
        updates.push(`updated_at = NOW()`);

        values.push(id);
        const idParam = `$${paramIndex}`;

        const result = await db.query(
            `UPDATE courses SET ${updates.join(', ')} WHERE id = ${idParam} RETURNING *`,
            values
        );
        return result.rows[0];
    }

    async deleteCourse(id) {
        await db.query('DELETE FROM courses WHERE id = $1', [id]);
    }

    async enrollUser(userId, courseId) {
        const result = await db.query(
            'INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [userId, courseId]
        );
        return result.rows[0];
    }

    async getPurchasedCourses(userId) {
        const result = await db.query(
            `SELECT 
                c.*,
                u.email as teacher_email,
                CASE 
                    WHEN c.tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(c.tags) = 'string' THEN c.tags::jsonb
                    ELSE c.tags
                END as tags
             FROM courses c
             JOIN course_enrollments ce ON c.id = ce.course_id
             LEFT JOIN users u ON c.teacher_id = u.id
             WHERE ce.user_id = $1
             ORDER BY ce.enrolled_at DESC`,
            [userId]
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || [])
        }));
    }

    async getUnpurchasedCourses(userId) {
        const result = await db.query(
            `SELECT 
                c.*,
                u.email as teacher_email,
                CASE 
                    WHEN c.tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(c.tags) = 'string' THEN c.tags::jsonb
                    ELSE c.tags
                END as tags
             FROM courses c
             LEFT JOIN users u ON c.teacher_id = u.id
             WHERE c.id NOT IN (
                 SELECT course_id FROM course_enrollments WHERE user_id = $1
             )
             ORDER BY c.created_at DESC`,
            [userId]
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || [])
        }));
    }

    async isEnrolled(userId, courseId) {
        const result = await db.query(
            'SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2',
            [userId, courseId]
        );
        return result.rowCount > 0;
    }
}

module.exports = new CourseService();
