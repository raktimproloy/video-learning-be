const db = require('../../db');

const REVIEW_COMMENT_MAX_LENGTH = 2000;

class ReviewService {
    /**
     * Create a review. One review per user per course; once submitted it cannot be changed.
     * Requires an active enrollment for the course.
     */
    async createOrUpdateReview(userId, courseId, rating, comment) {
        const courseCheck = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
        if (!courseCheck.rows[0]) {
            const err = new Error('Course not found');
            err.code = 'COURSE_NOT_FOUND';
            throw err;
        }

        const enrollCheck = await db.query(
            `SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1`,
            [userId, courseId]
        );
        if (!enrollCheck.rows[0]) {
            const err = new Error('You must be enrolled in this course to leave a review.');
            err.code = 'NOT_ENROLLED';
            throw err;
        }

        const existingReview = await db.query(
            `SELECT id, rating, comment FROM reviews WHERE user_id = $1 AND course_id = $2`,
            [userId, courseId]
        );

        if (existingReview.rows.length > 0) {
            const err = new Error('You have already submitted a review for this course. Reviews cannot be changed.');
            err.code = 'REVIEW_ALREADY_EXISTS';
            throw err;
        }

        let text = comment == null ? null : String(comment).trim();
        if (text === '') text = null;
        if (text && text.length > REVIEW_COMMENT_MAX_LENGTH) {
            const err = new Error(`Comment must be at most ${REVIEW_COMMENT_MAX_LENGTH} characters.`);
            err.code = 'COMMENT_TOO_LONG';
            throw err;
        }

        const result = await db.query(
            `INSERT INTO reviews (user_id, course_id, rating, comment)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [userId, courseId, rating, text]
        );
        return result.rows[0];
    }

    /**
     * Get review by user and course
     */
    async getReviewByUserAndCourse(userId, courseId) {
        const result = await db.query(
            `SELECT * FROM reviews WHERE user_id = $1 AND course_id = $2`,
            [userId, courseId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get all reviews for a course
     */
    async getReviewsByCourse(courseId, limit = 10, offset = 0) {
        const result = await db.query(
            `SELECT r.*, u.email as user_email, sp.name as user_name,
                    sp.profile_image_path as user_profile_image_path
             FROM reviews r
             JOIN users u ON r.user_id = u.id
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             WHERE r.course_id = $1
             ORDER BY r.created_at DESC
             LIMIT $2 OFFSET $3`,
            [courseId, limit, offset]
        );
        return result.rows;
    }

    /**
     * Get course rating statistics
     */
    async getCourseRatingStats(courseId) {
        const result = await db.query(
            `SELECT 
                COUNT(*) as total_reviews,
                COALESCE(AVG(rating), 0) as average_rating,
                COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
                COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
                COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
                COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
                COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
             FROM reviews
             WHERE course_id = $1`,
            [courseId]
        );
        return result.rows[0];
    }

    /**
     * Get all reviews for courses taught by a teacher
     */
    async getReviewsByTeacher(teacherId) {
        const result = await db.query(
            `SELECT r.id, r.user_id, r.course_id, r.rating, r.comment, r.created_at,
                    u.email as user_email,
                    COALESCE(sp.name, u.email) as user_name,
                    sp.profile_image_path as user_profile_image_path,
                    c.title as course_title
             FROM reviews r
             JOIN courses c ON r.course_id = c.id
             JOIN users u ON r.user_id = u.id
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             WHERE c.teacher_id = $1
             ORDER BY r.created_at DESC`,
            [teacherId]
        );
        return result.rows;
    }

    /**
     * Delete a review
     */
    async deleteReview(userId, courseId) {
        const result = await db.query(
            `DELETE FROM reviews WHERE user_id = $1 AND course_id = $2 RETURNING *`,
            [userId, courseId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get a single review by ID (for admin).
     */
    async getReviewById(reviewId) {
        const result = await db.query(
            `SELECT r.*, u.email as user_email,
                    COALESCE(sp.name, u.email) as user_name
             FROM reviews r
             JOIN users u ON r.user_id = u.id
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             WHERE r.id = $1`,
            [reviewId]
        );
        return result.rows[0] || null;
    }

    /**
     * Update a review by ID (admin only). Rating 1-5, comment optional.
     */
    async updateReviewById(reviewId, { rating, comment }) {
        const updates = [];
        const values = [];
        let idx = 1;
        if (rating !== undefined) {
            const r = parseInt(rating, 10);
            if (r < 1 || r > 5) throw new Error('Rating must be between 1 and 5');
            updates.push(`rating = $${idx}`);
            values.push(r);
            idx++;
        }
        if (comment !== undefined) {
            const c = comment === '' || comment == null ? null : String(comment);
            if (c && c.length > REVIEW_COMMENT_MAX_LENGTH) {
                throw new Error(`Comment must be at most ${REVIEW_COMMENT_MAX_LENGTH} characters.`);
            }
            updates.push(`comment = $${idx}`);
            values.push(c);
            idx++;
        }
        if (updates.length === 0) return this.getReviewById(reviewId);
        updates.push(`updated_at = NOW()`);
        values.push(reviewId);
        const result = await db.query(
            `UPDATE reviews SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return result.rows[0] ? this.getReviewById(reviewId) : null;
    }

    /**
     * Delete a review by ID (admin only).
     */
    async deleteReviewById(reviewId) {
        const result = await db.query(
            'DELETE FROM reviews WHERE id = $1 RETURNING id, course_id',
            [reviewId]
        );
        return result.rows[0] || null;
    }
}

module.exports = new ReviewService();
