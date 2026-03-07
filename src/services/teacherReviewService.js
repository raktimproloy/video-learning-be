const db = require('../../db');

const MIN_COURSES_TO_REVIEW = 2;

/**
 * Count how many courses the user has purchased from the given teacher.
 */
async function countCoursesPurchasedFromTeacher(userId, teacherId) {
    const result = await db.query(
        `SELECT COUNT(DISTINCT ce.course_id) AS cnt
         FROM course_enrollments ce
         JOIN courses c ON ce.course_id = c.id AND c.teacher_id = $1
         WHERE ce.user_id = $2`,
        [teacherId, userId]
    );
    return parseInt(result.rows[0]?.cnt || '0', 10);
}

/**
 * Check if user can submit a review for this teacher.
 * Returns { allowed: boolean, reason?: string, purchaseCount?: number }.
 * Rules: must be student, not self, at least MIN_COURSES_TO_REVIEW purchases from teacher.
 */
async function checkEligibility(userId, userRole, teacherId) {
    if (userId === teacherId) {
        return { allowed: false, reason: 'You cannot review yourself.' };
    }
    if (userRole !== 'student') {
        return { allowed: false, reason: 'Only students can review teachers.' };
    }
    const purchaseCount = await countCoursesPurchasedFromTeacher(userId, teacherId);
    if (purchaseCount < MIN_COURSES_TO_REVIEW) {
        return {
            allowed: false,
            reason: `You need to purchase at least ${MIN_COURSES_TO_REVIEW} courses from this teacher to leave a review. You have purchased ${purchaseCount} course(s).`,
            purchaseCount,
        };
    }
    return { allowed: true, purchaseCount };
}

/**
 * Create or update a teacher review. One per user per teacher.
 */
async function createOrUpdateReview(userId, teacherId, rating, comment) {
    const result = await db.query(
        `INSERT INTO teacher_reviews (user_id, teacher_id, rating, comment)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, teacher_id)
         DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
         RETURNING *`,
        [userId, teacherId, rating, comment == null ? null : String(comment).trim() || null]
    );
    return result.rows[0];
}

/**
 * Get reviews for a teacher with pagination. Public (no auth required).
 * Returns { reviews: [], total: number }.
 */
async function getReviewsByTeacher(teacherId, limit = 10, offset = 0) {
    const countResult = await db.query(
        `SELECT COUNT(*) AS total FROM teacher_reviews WHERE teacher_id = $1`,
        [teacherId]
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    const result = await db.query(
        `SELECT tr.id, tr.user_id, tr.teacher_id, tr.rating, tr.comment, tr.created_at,
                u.email AS user_email,
                COALESCE(sp.name, split_part(u.email, '@', 1)) AS user_name,
                sp.profile_image_path AS user_profile_image_path
         FROM teacher_reviews tr
         JOIN users u ON tr.user_id = u.id
         LEFT JOIN student_profiles sp ON u.id = sp.user_id
         WHERE tr.teacher_id = $1
         ORDER BY tr.created_at DESC
         LIMIT $2 OFFSET $3`,
        [teacherId, limit, offset]
    );

    return { reviews: result.rows, total };
}

/**
 * Get current user's review for this teacher (if any).
 */
async function getMyReview(userId, teacherId) {
    const result = await db.query(
        `SELECT * FROM teacher_reviews WHERE user_id = $1 AND teacher_id = $2`,
        [userId, teacherId]
    );
    return result.rows[0] || null;
}

/**
 * Get summary (total count and average rating) for a teacher. Public.
 */
async function getSummaryByTeacher(teacherId) {
    const result = await db.query(
        `SELECT COUNT(*)::int AS total, COALESCE(AVG(rating), 0)::float AS average_rating
         FROM teacher_reviews WHERE teacher_id = $1`,
        [teacherId]
    );
    const row = result.rows[0];
    return {
        total: parseInt(row?.total || '0', 10),
        averageRating: parseFloat(row?.average_rating) || 0,
    };
}

module.exports = {
    MIN_COURSES_TO_REVIEW,
    checkEligibility,
    countCoursesPurchasedFromTeacher,
    createOrUpdateReview,
    getReviewsByTeacher,
    getMyReview,
    getSummaryByTeacher,
};
