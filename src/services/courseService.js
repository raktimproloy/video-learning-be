const db = require('../../db');
const adminCategoryService = require('./adminCategoryService');

class CourseService {
    async createCourse(teacherId, courseData) {
        const {
            title,
            shortDescription,
            fullDescription,
            category,
            subcategory,
            admin_category_id,
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
                category, subcategory, admin_category_id, tags, language, subtitle, level, course_type,
                thumbnail_path, intro_video_path, price, discount_price, currency,
                has_live_class, has_assignments
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *`,
            [
                teacherId,
                title,
                shortDescription || fullDescription || '', // description for backward compatibility
                shortDescription || null,
                fullDescription || null,
                category || null,
                subcategory || null,
                admin_category_id || null,
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
        const course = result.rows[0];
        if (admin_category_id) {
            await adminCategoryService.incrementCourseCountForPath(admin_category_id);
        }
        return course;
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
                users.email as teacher_email,
                COALESCE(tp.name, users.email) as teacher_name,
                users.id as teacher_id,
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
            LEFT JOIN users ON c.teacher_id = users.id
            LEFT JOIN teacher_profiles tp ON users.id = tp.user_id
            WHERE c.teacher_id = $1 
            ORDER BY c.created_at DESC`,
            [teacherId]
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
            teacher_name: row.teacher_name || row.teacher_email || 'Teacher',
            teacher_id: row.teacher_id,
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
                COALESCE(tp.name, users.email) as teacher_name,
                users.id as teacher_id,
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
            LEFT JOIN teacher_profiles tp ON users.id = tp.user_id
            WHERE (COALESCE(courses.status, 'active') = 'active' OR ${params.length ? '(courses.teacher_id = $1)' : 'false'})
            ORDER BY courses.created_at DESC`,
            params
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
            teacher_name: row.teacher_name || row.teacher_email || 'Teacher',
            teacher_id: row.teacher_id,
            is_purchased: row.is_purchased || false,
            is_owned: row.is_owned || false,
            rating: parseFloat(row.rating) || 0,
            review_count: row.review_count || 0,
            purchase_count: row.purchase_count || 0,
            total_lessons: row.total_lessons || 0,
            total_videos: row.total_videos || 0
        }));
    }

    /**
     * Search courses with optional text query, category filter, and pagination.
     * @param {string|null} userId - Optional user id for purchase/ownership flags
     * @param {Object} options - { q, category, page, limit }
     * @returns {Promise<{ courses: Array, total: number, page: number, limit: number, hasMore: boolean }>}
     */
    async searchCourses(userId = null, options = {}) {
        const { q = '', category = '', page = 1, limit: limitParam = 12 } = options;
        const limit = Math.min(Math.max(parseInt(limitParam, 10) || 12, 1), 50);
        const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

        let purchaseCheck = '';
        let ownershipCheck = '';
        const params = [];
        let paramIndex = 1;

        if (userId) {
            purchaseCheck = `, EXISTS(
                SELECT 1 FROM course_enrollments ce 
                WHERE ce.course_id = courses.id AND ce.user_id = $${paramIndex}
            ) as is_purchased`;
            ownershipCheck = `, (courses.teacher_id = $${paramIndex}) as is_owned`;
            params.push(userId);
            paramIndex++;
        } else {
            purchaseCheck = `, false as is_purchased`;
            ownershipCheck = `, false as is_owned`;
        }

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

        const conditions = [];
        const statusCondition = params.length > 0
            ? `(COALESCE(courses.status, 'active') = 'active' OR courses.teacher_id = $1)`
            : `(COALESCE(courses.status, 'active') = 'active')`;
        conditions.push(statusCondition);
        let searchPattern = null;
        const searchTerm = (q && typeof q === 'string') ? q.trim() : '';
        if (searchTerm) {
            searchPattern = `%${searchTerm.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
            conditions.push(`(
                courses.title ILIKE $${paramIndex}
                OR courses.short_description ILIKE $${paramIndex}
                OR courses.full_description ILIKE $${paramIndex}
                OR (courses.tags::text ILIKE $${paramIndex})
            )`);
            params.push(searchPattern);
            paramIndex++;
        }

        const categoryFilter = (category && typeof category === 'string') ? category.trim() : '';
        if (categoryFilter) {
            const categoryIds = await adminCategoryService.getCategoryAndDescendantIds(categoryFilter);
            if (categoryIds.length > 0) {
                const placeholders = categoryIds.map(() => `$${paramIndex++}`).join(', ');
                params.push(...categoryIds);
                conditions.push(`(courses.admin_category_id IN (${placeholders}))`);
            } else {
                const legacySlug = categoryFilter.toLowerCase().replace(/\s+/g, '-');
                conditions.push(`(LOWER(REPLACE(TRIM(COALESCE(courses.category, '')), ' ', '-')) = $${paramIndex})`);
                params.push(legacySlug);
                paramIndex++;
            }
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        // Count query: use only params that appear in WHERE (search pattern). Use $1 for search so we don't pass unused userId.
        const countWhereClause = conditions.length
            ? `WHERE ${conditions.join(' AND ')}`
            : '';
        const countParams = [...params];
        const countResult = await db.query(
            `SELECT COUNT(*)::int as total FROM courses ${countWhereClause}`,
            countParams
        );
        const total = countResult.rows[0]?.total || 0;

        params.push(limit, offset);
        const limitParamIndex = params.length - 1;
        const offsetParamIndex = params.length;
        const dataQuery = `
            SELECT 
                courses.*,
                users.email as teacher_email,
                COALESCE(tp.name, users.email) as teacher_name,
                users.id as teacher_id,
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
            LEFT JOIN teacher_profiles tp ON users.id = tp.user_id
            ${whereClause}
            ORDER BY courses.created_at DESC
            LIMIT $${limitParamIndex}::integer OFFSET $${offsetParamIndex}::integer
        `;

        const result = await db.query(dataQuery, params);
        const courses = result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
            teacher_name: row.teacher_name || row.teacher_email || 'Teacher',
            teacher_id: row.teacher_id,
            is_purchased: row.is_purchased || false,
            is_owned: row.is_owned || false,
            rating: parseFloat(row.rating) || 0,
            review_count: row.review_count || 0,
            purchase_count: row.purchase_count || 0,
            total_lessons: row.total_lessons || 0,
            total_videos: row.total_videos || 0
        }));

        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const hasMore = offset + courses.length < total;

        return {
            courses,
            total,
            page: currentPage,
            limit,
            hasMore
        };
    }

    async getCourseDetails(id, userId = null) {
        // Get course with all related data for details page
        const course = await this.getCourseById(id, userId);
        if (!course) return null;

        // Get teacher info with full profile (name, image, institute, verified, address)
        const teacherResult = await db.query(
            `SELECT u.id, u.email, u.created_at,
                    COALESCE(tp.name, u.email) as name,
                    tp.profile_image_path,
                    tp.institute_name,
                    tp.account_email_verified,
                    tp.address,
                    (SELECT COUNT(DISTINCT ce.user_id) FROM course_enrollments ce
                     JOIN courses c ON ce.course_id = c.id WHERE c.teacher_id = u.id) as total_students
             FROM users u
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE u.id = $1`,
            [course.teacher_id]
        );
        const teacher = teacherResult.rows[0] || null;

        // Get lessons for this course (pass teacherId so owner sees all, students only see active)
        const lessonService = require('./lessonService');
        const lessons = await lessonService.getLessonsByCourse(course.id, userId, course.teacher_id);

        // Get all videos for all lessons
        const videoService = require('./videoService');
        const videos = [];
        const isOwner = userId && course.teacher_id === userId;
        for (const lesson of lessons) {
            const lessonVideos = await videoService.getVideosByLesson(lesson.id, userId, lesson.isLocked || false, isOwner);
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
               AND (COALESCE(courses.status, 'active') = 'active')
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

        // Latest 3 reviews for course details page (include user_profile_image_path for controller to build avatar URL)
        let reviews = [];
        if (hasReviewsTable) {
            const reviewService = require('./reviewService');
            const reviewRows = await reviewService.getReviewsByCourse(id, 3, 0);
            reviews = reviewRows.map(r => ({
                id: r.id,
                userName: r.user_name || r.user_email || 'Student',
                user_profile_image_path: r.user_profile_image_path || null,
                rating: parseInt(r.rating) || 0,
                comment: r.comment || '',
                createdAt: r.created_at,
                helpful: 0
            }));
        }

        // Compute total_notes (only actual notes, not assignments) for "course includes" section.
        // Exclude assignments (isRequired === true). Only count items with note shape (type 'text' or 'file') or no type (legacy).
        const countNotesOnly = (arr) => {
            if (!Array.isArray(arr)) return 0;
            return arr.filter((item) => {
                if (!item || item.isRequired === true) return false;
                if (item.type !== undefined && item.type !== 'text' && item.type !== 'file') return false;
                return true;
            }).length;
        };
        const totalNotes = lessons.reduce((sum, l) => sum + countNotesOnly(l.notes), 0) + videos.reduce((sum, v) => sum + countNotesOnly(v.notes), 0);
        const totalAssignments = lessons.reduce((sum, l) => sum + (Array.isArray(l.assignments) ? l.assignments.length : 0), 0) + videos.reduce((sum, v) => sum + (Array.isArray(v.assignments) ? v.assignments.length : 0), 0);
        const totalDurationSeconds = videos.reduce((sum, v) => sum + (parseFloat(v.duration_seconds) || 0), 0);
        const courseWithMeta = {
            ...course,
            total_notes: totalNotes,
            total_assignments: totalAssignments,
            total_duration_seconds: totalDurationSeconds
        };

        // Bundles that include this course (for "Bundles" section on course details)
        let bundles = [];
        try {
            const bundleService = require('./bundleService');
            bundles = await bundleService.getBundlesContainingCourse(course.id, course.teacher_id);
        } catch (e) {
            // bundle_courses table may not exist in older deployments
        }

        return {
            course: courseWithMeta,
            teacher: teacher ? {
                id: teacher.id,
                email: teacher.email,
                name: teacher.name || teacher.email,
                profile_image_path: teacher.profile_image_path || null,
                institute_name: teacher.institute_name || null,
                account_email_verified: teacher.account_email_verified || false,
                address: teacher.address || null,
                totalStudents: parseInt(teacher.total_students) || course.purchase_count || 0
            } : null,
            lessons,
            videos,
            otherCourses,
            reviews,
            bundles: bundles || []
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
        // Students cannot see non-active courses; owners (teachers) can always see their own
        const isOwner = userId && course.teacher_id === userId;
        const isActive = !course.status || course.status === 'active';
        if (!isOwner && !isActive) return null;

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

    async getCourseByInviteCode(code) {
        if (!code || typeof code !== 'string') return null;
        const result = await db.query(
            'SELECT id FROM courses WHERE invite_code = $1 AND (status IS NULL OR status = $2)',
            [String(code).trim().toUpperCase(), 'active']
        );
        return result.rows[0] || null;
    }

    async updateCourse(id, courseData) {
        const {
            title,
            shortDescription,
            fullDescription,
            category,
            subcategory,
            admin_category_id,
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
            hasAssignments,
            status
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
        if (admin_category_id !== undefined) {
            const existingRow = (await db.query('SELECT admin_category_id FROM courses WHERE id = $1', [id])).rows[0];
            const oldCatId = existingRow?.admin_category_id;
            if (oldCatId && oldCatId !== admin_category_id) {
                await adminCategoryService.decrementCourseCountForPath(oldCatId);
            }
            if (admin_category_id && admin_category_id !== oldCatId) {
                await adminCategoryService.incrementCourseCountForPath(admin_category_id);
            }
            updates.push(`admin_category_id = $${paramIndex++}`);
            values.push(admin_category_id || null);
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
        if (status !== undefined) {
            updates.push(`status = $${paramIndex++}`);
            values.push(status);
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
        const row = (await db.query('SELECT admin_category_id FROM courses WHERE id = $1', [id])).rows[0];
        if (row?.admin_category_id) {
            await adminCategoryService.decrementCourseCountForPath(row.admin_category_id);
        }
        await db.query('DELETE FROM courses WHERE id = $1', [id]);
    }

    async enrollUser(userId, courseId, options = {}) {
        const { inviteCode } = options;
        let isInvited = false;
        if (inviteCode) {
            const row = await db.query(
                'SELECT id FROM courses WHERE invite_code = $1 AND id = $2',
                [String(inviteCode).trim().toUpperCase(), courseId]
            );
            isInvited = !!row.rows[0];
        }
        const result = await db.query(
            `INSERT INTO course_enrollments (user_id, course_id, is_invited)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, course_id) DO UPDATE SET is_invited = EXCLUDED.is_invited
             RETURNING *`,
            [userId, courseId, isInvited]
        );
        return result.rows[0];
    }

    async getPurchasedCourses(userId) {
        // Check if reviews table exists
        const reviewsTableCheck = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'reviews'
            )
        `);
        const hasReviewsTable = reviewsTableCheck.rows[0]?.exists || false;

        const reviewRatingQuery = hasReviewsTable
            ? `(SELECT r.rating FROM reviews r WHERE r.user_id = $1 AND r.course_id = c.id LIMIT 1) as my_rating`
            : `NULL as my_rating`;
        const reviewCommentQuery = hasReviewsTable
            ? `(SELECT r.comment FROM reviews r WHERE r.user_id = $1 AND r.course_id = c.id LIMIT 1) as my_comment`
            : `NULL as my_comment`;

        const result = await db.query(
            `SELECT 
                c.*,
                u.email as teacher_email,
                COALESCE(tp.name, u.email) as teacher_name,
                u.id as teacher_id,
                CASE 
                    WHEN c.tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(c.tags) = 'string' THEN c.tags::jsonb
                    ELSE c.tags
                END as tags,
                ${reviewRatingQuery},
                ${reviewCommentQuery},
                -- Course statistics
                (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) as total_lessons,
                (SELECT COUNT(*) FROM videos v 
                 JOIN lessons l ON v.lesson_id = l.id 
                 WHERE l.course_id = c.id AND v.status != 'processing') as total_videos,
                (SELECT COALESCE(SUM(v.duration_seconds), 0) FROM videos v 
                 JOIN lessons l ON v.lesson_id = l.id 
                 WHERE l.course_id = c.id AND v.status != 'processing') as total_duration_seconds,
                -- Assignment counts
                (SELECT COUNT(*) FROM (
                    SELECT jsonb_array_elements(l.assignments) as assignment FROM lessons l WHERE l.course_id = c.id
                    UNION ALL
                    SELECT jsonb_array_elements(v.assignments) as assignment FROM videos v 
                    JOIN lessons l ON v.lesson_id = l.id WHERE l.course_id = c.id
                ) assignments WHERE (assignments.assignment->>'isRequired')::boolean = false) as total_normal_assignments,
                (SELECT COUNT(*) FROM (
                    SELECT jsonb_array_elements(l.assignments) as assignment FROM lessons l WHERE l.course_id = c.id
                    UNION ALL
                    SELECT jsonb_array_elements(v.assignments) as assignment FROM videos v 
                    JOIN lessons l ON v.lesson_id = l.id WHERE l.course_id = c.id
                ) assignments WHERE (assignments.assignment->>'isRequired')::boolean = true) as total_required_assignments,
                -- Notes count
                (SELECT COUNT(*) FROM (
                    SELECT jsonb_array_elements(l.notes) as note FROM lessons l WHERE l.course_id = c.id
                    UNION ALL
                    SELECT jsonb_array_elements(v.notes) as note FROM videos v 
                    JOIN lessons l ON v.lesson_id = l.id WHERE l.course_id = c.id
                ) notes WHERE notes.note IS NOT NULL) as total_notes,
                -- Live stream status
                (SELECT COUNT(*) > 0 FROM lessons l WHERE l.course_id = c.id AND l.is_live = true) as has_live_stream,
                -- Completed required assignments count
                (SELECT COUNT(*) FROM (
                    SELECT DISTINCT asub.assignment_id FROM assignment_submissions asub
                    JOIN videos v ON asub.video_id = v.id
                    JOIN lessons l ON v.lesson_id = l.id
                    WHERE l.course_id = c.id 
                    AND asub.user_id = $1 
                    AND asub.status = 'passed'
                    AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(v.assignments) assignment
                        WHERE assignment->>'id' = asub.assignment_id 
                        AND (assignment->>'isRequired')::boolean = true
                    )
                    UNION
                    SELECT DISTINCT asub.assignment_id FROM assignment_submissions asub
                    JOIN lessons l ON asub.lesson_id = l.id
                    WHERE l.course_id = c.id 
                    AND asub.user_id = $1 
                    AND asub.status = 'passed'
                    AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(l.assignments) assignment
                        WHERE assignment->>'id' = asub.assignment_id 
                        AND (assignment->>'isRequired')::boolean = true
                    )
                ) completed) as completed_required_assignments
             FROM courses c
             JOIN course_enrollments ce ON c.id = ce.course_id
             LEFT JOIN users u ON c.teacher_id = u.id
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE ce.user_id = $1 AND (COALESCE(c.status, 'active') = 'active')
             ORDER BY ce.enrolled_at DESC`,
            [userId]
        );

        // Enrich with progress from video_watch_progress (videos/lessons completed 90%+, assignments)
        const progressService = require('./progressService');
        const progressList = await Promise.all(
            result.rows.map((r) =>
                progressService.getCourseProgress(userId, r.id).catch(() => null)
            )
        );

        // Parse tags and calculate completion percentage from real progress
        return result.rows.map((row, i) => {
            const totalLessons = parseInt(row.total_lessons) || 0;
            const totalVideos = parseInt(row.total_videos) || 0;
            const progress = progressList[i];
            const completedLessons = progress ? progress.lessonsCompleted : 0;
            const completedVideos = progress ? progress.videosCompleted90 : 0;
            const assignmentsSubmitted = progress ? progress.assignmentsSubmitted : 0;
            const assignmentsTotal = progress ? progress.assignmentsTotal : 0;
            const assignmentsUnsubmitted = progress ? progress.assignmentsUnsubmitted : 0;

            // Completion percentage from progress: sum(effective watch time) / sum(video duration), anti-cheat applied
            const completionPercentage = progress ? progress.completionPercentage : 0;

            // Format duration
            const totalDurationSeconds = parseFloat(row.total_duration_seconds) || 0;
            const hours = Math.floor(totalDurationSeconds / 3600);
            const minutes = Math.floor((totalDurationSeconds % 3600) / 60);
            const durationFormatted = hours > 0
                ? `${hours}h ${minutes}m`
                : `${minutes}m`;

            return {
                ...row,
                tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
                total_lessons: totalLessons,
                total_videos: totalVideos,
                total_duration_seconds: totalDurationSeconds,
                total_duration_formatted: durationFormatted,
                total_normal_assignments: parseInt(row.total_normal_assignments) || 0,
                total_required_assignments: parseInt(row.total_required_assignments) || 0,
                total_notes: parseInt(row.total_notes) || 0,
                has_live_stream: row.has_live_stream || false,
                completed_lessons: completedLessons,
                completed_videos: completedVideos,
                assignments_submitted: assignmentsSubmitted,
                assignments_total: assignmentsTotal,
                assignments_unsubmitted: assignmentsUnsubmitted,
                completed_required_assignments: parseInt(row.completed_required_assignments) || 0,
                completion_percentage: Math.min(100, completionPercentage),
                percent_videos_completed: progress ? progress.percentVideosCompleted : 0,
                percent_lessons_completed: progress ? progress.percentLessonsCompleted : 0,
                my_rating: row.my_rating ? parseInt(row.my_rating) : null,
                my_comment: row.my_comment || null
            };
        });
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
             AND (COALESCE(c.status, 'active') = 'active')
             ORDER BY c.created_at DESC`,
            [userId]
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || [])
        }));
    }

    /**
     * Get students enrolled in teacher's courses only (with pagination).
     * Returns distinct students with list of this teacher's courses they purchased.
     */
    async getStudentsEnrolledInTeacherCourses(teacherId, limit = 10, offset = 0) {
        const countResult = await db.query(
            `SELECT COUNT(DISTINCT ce.user_id) as total
             FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id AND c.teacher_id = $1`,
            [teacherId]
        );
        const total = parseInt(countResult.rows[0]?.total || '0', 10);

        const result = await db.query(
            `SELECT 
                u.id as user_id,
                u.email,
                COALESCE(sp.name, u.email) as name,
                sp.profile_image_path,
                MIN(ce.enrolled_at)::timestamp as first_enrolled_at,
                COALESCE(
                    array_agg(
                        json_build_object('course_id', c.id, 'course_title', c.title)
                    ) FILTER (WHERE c.id IS NOT NULL),
                    '{}'
                ) as courses
             FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id AND c.teacher_id = $1
             JOIN users u ON ce.user_id = u.id
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             GROUP BY u.id, u.email, sp.name, sp.profile_image_path
             ORDER BY first_enrolled_at DESC
             LIMIT $2 OFFSET $3`,
            [teacherId, limit, offset]
        );

        const students = result.rows.map(row => {
            let courses = row.courses;
            if (typeof courses === 'string') {
                try {
                    courses = JSON.parse(courses);
                } catch (e) {
                    courses = [];
                }
            }
            if (!Array.isArray(courses)) courses = courses ? [courses] : [];
            return {
                user_id: row.user_id,
                email: row.email,
                name: row.name,
                profile_image_path: row.profile_image_path,
                first_enrolled_at: row.first_enrolled_at,
                courses
            };
        });

        return { students, total };
    }

    async isEnrolled(userId, courseId) {
        const result = await db.query(
            'SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2',
            [userId, courseId]
        );
        return result.rowCount > 0;
    }

    /** Teacher revenue: total from enrollments in their courses. Amount = COALESCE(discount_price, price) per enrollment. */
    async getTeacherRevenue(teacherId) {
        const result = await db.query(
            `SELECT 
                COALESCE(SUM(COALESCE(c.discount_price, c.price, 0)::numeric), 0)::float as total_revenue,
                COUNT(ce.user_id) as purchase_count,
                (SELECT c2.currency FROM courses c2 WHERE c2.teacher_id = $1 LIMIT 1) as currency
             FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id AND c.teacher_id = $1`,
            [teacherId]
        );
        const row = result.rows[0];
        return {
            totalRevenue: parseFloat(row?.total_revenue || '0') || 0,
            purchaseCount: parseInt(row?.purchase_count || '0', 10) || 0,
            currency: row?.currency || 'USD',
        };
    }

    /** Teacher purchase history: paginated enrollments for teacher's courses. */
    async getTeacherPurchaseHistory(teacherId, limit = 10, offset = 0) {
        const countResult = await db.query(
            `SELECT COUNT(*)::int as total
             FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id AND c.teacher_id = $1`,
            [teacherId]
        );
        const total = countResult.rows[0]?.total || 0;

        const result = await db.query(
            `SELECT 
                ce.user_id,
                ce.course_id,
                ce.enrolled_at,
                COALESCE(ce.is_invited, false) as is_invited,
                c.title as course_title,
                COALESCE(c.discount_price, c.price, 0)::float as amount,
                c.currency,
                u.email as student_email,
                COALESCE(sp.name, u.email) as student_name
             FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id AND c.teacher_id = $1
             JOIN users u ON ce.user_id = u.id
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             ORDER BY ce.enrolled_at DESC
             LIMIT $2 OFFSET $3`,
            [teacherId, limit, offset]
        );

        const purchases = result.rows.map(row => ({
            userId: row.user_id,
            courseId: row.course_id,
            enrolledAt: row.enrolled_at,
            isInvited: !!row.is_invited,
            courseTitle: row.course_title,
            amount: row.amount,
            currency: row.currency || 'USD',
            studentEmail: row.student_email,
            studentName: row.student_name || row.student_email,
        }));

        return { purchases, total };
    }

    /** Student purchase history: all enrollments for a student with course details. */
    async getStudentPurchaseHistory(userId) {
        const result = await db.query(
            `SELECT 
                ce.course_id,
                ce.enrolled_at,
                c.id,
                c.title,
                c.thumbnail_path,
                c.price,
                c.discount_price,
                c.currency,
                COALESCE(tp.name, u.email) as teacher_name,
                u.email as teacher_email
             FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id
             LEFT JOIN users u ON c.teacher_id = u.id
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE ce.user_id = $1
             ORDER BY ce.enrolled_at DESC`,
            [userId]
        );

        const r2Storage = require('./r2StorageService');
        const apiUrl = process.env.BASE_URL || 'http://localhost:5000';
        const v1Url = `${apiUrl}/v1`;

        return result.rows.map((row, index) => {
            // Generate order number from enrollment date and index
            const date = new Date(row.enrolled_at);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const orderIndex = String(index + 1).padStart(3, '0');
            const orderNumber = `ORD-${year}${month}${day}-${orderIndex}`;
            
            // Get thumbnail URL
            let thumbnailUrl = null;
            if (row.thumbnail_path) {
                const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(row.thumbnail_path) : null;
                if (publicUrl) {
                    thumbnailUrl = publicUrl;
                } else if (row.thumbnail_path.startsWith('teachers/')) {
                    thumbnailUrl = `${v1Url}/courses/media/${encodeURIComponent(row.thumbnail_path)}`;
                } else if (row.thumbnail_path.startsWith('/uploads/')) {
                    thumbnailUrl = `${apiUrl}${row.thumbnail_path}`;
                } else {
                    thumbnailUrl = `${apiUrl}${row.thumbnail_path.startsWith('/') ? '' : '/'}${row.thumbnail_path}`;
                }
            }

            const price = parseFloat(row.price) || 0;
            const discountPrice = row.discount_price ? parseFloat(row.discount_price) : null;
            const finalPrice = discountPrice || price;

            return {
                id: row.course_id,
                orderNumber,
                date: row.enrolled_at,
                course: {
                    id: row.course_id,
                    title: row.title,
                    thumbnail: thumbnailUrl || '/placeholder-course.jpg',
                    teacherName: row.teacher_name || row.teacher_email || 'Unknown Teacher',
                },
                type: 'single', // Currently only single courses, bundles can be added later
                price,
                discountPrice,
                finalPrice,
                currency: row.currency || 'USD',
                paymentMethod: 'Online Payment', // Default since payment method isn't stored
                status: 'completed', // All enrollments are considered completed
            };
        });
    }

    /**
     * Teacher dashboard stats: courses, videos, students, rating, revenue this month, latest update, latest video.
     */
    async getTeacherDashboardStats(teacherId) {
        const [coursesCount, videosCount, studentsCount, ratingRow, revenueMonth, latestUpdateRow, latestVideoRow] = await Promise.all([
            db.query('SELECT COUNT(*)::int as n FROM courses WHERE teacher_id = $1', [teacherId]),
            db.query(
                `SELECT COUNT(*)::int as n FROM videos v
                 JOIN lessons l ON l.id = v.lesson_id
                 JOIN courses c ON c.id = l.course_id AND c.teacher_id = $1`,
                [teacherId]
            ),
            db.query(
                `SELECT COUNT(DISTINCT ce.user_id)::int as n
                 FROM course_enrollments ce
                 JOIN courses c ON c.id = ce.course_id AND c.teacher_id = $1`,
                [teacherId]
            ),
            db.query(
                `SELECT COALESCE(AVG(r.rating), 0)::float as avg_rating, COUNT(r.id)::int as total_reviews
                 FROM reviews r
                 JOIN courses c ON c.id = r.course_id AND c.teacher_id = $1`,
                [teacherId]
            ),
            db.query(
                `SELECT COALESCE(SUM(COALESCE(c.discount_price, c.price, 0)::numeric), 0)::float as revenue
                 FROM course_enrollments ce
                 JOIN courses c ON c.id = ce.course_id AND c.teacher_id = $1
                 WHERE ce.enrolled_at >= date_trunc('month', CURRENT_DATE)`,
                [teacherId]
            ),
            db.query(
                `SELECT GREATEST(
                    (SELECT COALESCE(MAX(updated_at), '1970-01-01') FROM courses WHERE teacher_id = $1),
                    (SELECT COALESCE(MAX(v.created_at), '1970-01-01') FROM videos v
                     JOIN lessons l ON l.id = v.lesson_id
                     JOIN courses c ON c.id = l.course_id AND c.teacher_id = $1)
                ) as latest`,
                [teacherId]
            ),
            db.query(
                `SELECT v.id, v.title, v.created_at, v.lesson_id, l.course_id, c.title as course_title, l.title as lesson_title
                 FROM videos v
                 JOIN lessons l ON l.id = v.lesson_id
                 JOIN courses c ON c.id = l.course_id AND c.teacher_id = $1
                 ORDER BY v.created_at DESC
                 LIMIT 1`,
                [teacherId]
            ),
        ]);

        const totalCourses = coursesCount.rows[0]?.n ?? 0;
        const totalVideos = videosCount.rows[0]?.n ?? 0;
        const totalStudents = studentsCount.rows[0]?.n ?? 0;
        const avgRating = parseFloat(ratingRow.rows[0]?.avg_rating) || 0;
        const totalReviews = parseInt(ratingRow.rows[0]?.total_reviews, 10) || 0;
        const revenueThisMonth = parseFloat(revenueMonth.rows[0]?.revenue) || 0;
        const latestUpdate = latestUpdateRow.rows[0]?.latest;
        const latestVideo = latestVideoRow.rows[0] || null;

        return {
            totalCourses,
            totalVideos,
            totalStudents,
            averageRating: Math.round(avgRating * 10) / 10,
            totalReviews,
            revenueThisMonth,
            latestUpdate: latestUpdate ? new Date(latestUpdate).toISOString() : null,
            badges: [],
            latestVideo: latestVideo ? {
                id: latestVideo.id,
                title: latestVideo.title,
                created_at: latestVideo.created_at ? new Date(latestVideo.created_at).toISOString() : null,
                lesson_id: latestVideo.lesson_id,
                course_id: latestVideo.course_id,
                course_title: latestVideo.course_title,
                lesson_title: latestVideo.lesson_title,
            } : null,
        };
    }

    /**
     * Get all assignments and notes for a course with submission status
     */
    async getCourseAssignmentsAndNotes(courseId, userId) {
        const db = require('../../db');
        const lessonService = require('./lessonService');
        const videoService = require('./videoService');
        const assignmentService = require('./assignmentService');

        // Check enrollment
        const enrolled = await db.query(
            'SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2',
            [userId, courseId]
        );
        if (!enrolled.rows.length) {
            throw new Error('Not enrolled in this course');
        }

        // Get all lessons
        const course = await this.getCourseByIdSimple(courseId);
        const lessons = await lessonService.getLessonsByCourse(courseId, userId, course?.teacher_id);

        const assignments = [];
        const notes = [];

        // Process each lesson
        for (const lesson of lessons) {
            // Lesson-level assignments
            if (lesson.assignments && Array.isArray(lesson.assignments)) {
                for (const assignment of lesson.assignments) {
                    if (assignment && assignment.id) {
                        const submissionStatus = await assignmentService.getSubmissionByAssignmentAndUser(
                            userId,
                            'lesson',
                            null,
                            lesson.id,
                            assignment.id
                        );
                        assignments.push({
                            id: assignment.id,
                            title: assignment.title || 'Untitled Assignment',
                            type: assignment.type || 'file',
                            content: assignment.content,
                            filePath: assignment.filePath,
                            fileName: assignment.fileName,
                            isRequired: assignment.isRequired || false,
                            assignmentType: 'lesson',
                            lessonId: lesson.id,
                            lessonTitle: lesson.title,
                            videoId: null,
                            videoTitle: null,
                            submissionStatus: submissionStatus ? {
                                status: submissionStatus.status || 'pending',
                                submittedAt: submissionStatus.submitted_at,
                                marks: submissionStatus.marks,
                                gradedAt: submissionStatus.graded_at,
                            } : null,
                        });
                    }
                }
            }

            // Lesson-level notes
            if (lesson.notes && Array.isArray(lesson.notes)) {
                for (const note of lesson.notes) {
                    if (note && note.id) {
                        notes.push({
                            id: note.id,
                            type: note.type || 'text',
                            content: note.content,
                            filePath: note.filePath,
                            fileName: note.fileName,
                            assignmentType: 'lesson',
                            lessonId: lesson.id,
                            lessonTitle: lesson.title,
                            videoId: null,
                            videoTitle: null,
                        });
                    }
                }
            }

            // Get videos for this lesson
            const videos = await videoService.getVideosByLesson(lesson.id, userId, lesson.isLocked || false, false);
            
            // Process each video
            for (const video of videos) {
                // Video-level assignments
                if (video.assignments && Array.isArray(video.assignments)) {
                    for (const assignment of video.assignments) {
                        if (assignment && assignment.id) {
                            const submissionStatus = await assignmentService.getSubmissionByAssignmentAndUser(
                                userId,
                                'video',
                                video.id,
                                null,
                                assignment.id
                            );
                            assignments.push({
                                id: assignment.id,
                                title: assignment.title || 'Untitled Assignment',
                                type: assignment.type || 'file',
                                content: assignment.content,
                                filePath: assignment.filePath,
                                fileName: assignment.fileName,
                                isRequired: assignment.isRequired || false,
                                assignmentType: 'video',
                                lessonId: lesson.id,
                                lessonTitle: lesson.title,
                                videoId: video.id,
                                videoTitle: video.title,
                                submissionStatus: submissionStatus ? {
                                    status: submissionStatus.status || 'pending',
                                    submittedAt: submissionStatus.submitted_at,
                                    marks: submissionStatus.marks,
                                    gradedAt: submissionStatus.graded_at,
                                } : null,
                            });
                        }
                    }
                }

                // Video-level notes
                if (video.notes && Array.isArray(video.notes)) {
                    for (const note of video.notes) {
                        if (note && note.id) {
                            notes.push({
                                id: note.id,
                                type: note.type || 'text',
                                content: note.content,
                                filePath: note.filePath,
                                fileName: note.fileName,
                                assignmentType: 'video',
                                lessonId: lesson.id,
                                lessonTitle: lesson.title,
                                videoId: video.id,
                                videoTitle: video.title,
                            });
                        }
                    }
                }
            }
        }

        return {
            assignments,
            notes,
        };
    }
}

module.exports = new CourseService();
