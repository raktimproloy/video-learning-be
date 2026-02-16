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
        const result = await db.query(
            `SELECT 
                *,
                CASE 
                    WHEN tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(tags) = 'string' THEN tags::jsonb
                    ELSE tags
                END as tags
            FROM courses 
            WHERE teacher_id = $1 
            ORDER BY created_at DESC`,
            [teacherId]
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || [])
        }));
    }

    async getAllCourses() {
        const result = await db.query(
            `SELECT 
                courses.*,
                users.email as teacher_email,
                CASE 
                    WHEN courses.tags IS NULL THEN '[]'::jsonb
                    WHEN jsonb_typeof(courses.tags) = 'string' THEN courses.tags::jsonb
                    ELSE courses.tags
                END as tags
            FROM courses 
            LEFT JOIN users ON courses.teacher_id = users.id 
            ORDER BY courses.created_at DESC`
        );
        // Parse tags if they're stored as JSON string
        return result.rows.map(row => ({
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || [])
        }));
    }

    async getCourseById(id) {
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
