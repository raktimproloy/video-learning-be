const teacherReviewService = require('../services/teacherReviewService');
const userService = require('../services/userService');

/**
 * GET /teacher-reviews/eligibility/:teacherId
 * Optional auth. Returns { allowed, reason?, purchaseCount? }.
 * If not logged in: { allowed: false, reason: 'Please log in to leave a review.' }
 */
async function getEligibility(req, res) {
    try {
        const { teacherId } = req.params;
        if (!teacherId) {
            return res.status(400).json({ error: 'Teacher ID is required.' });
        }
        if (!req.user || !req.user.id) {
            return res.json({
                allowed: false,
                reason: 'Please log in to leave a review.',
            });
        }
        const user = await userService.findById(req.user.id);
        const userRole = (user && user.role) || req.user.role || 'student';
        const result = await teacherReviewService.checkEligibility(req.user.id, userRole, teacherId);
        return res.json(result);
    } catch (error) {
        console.error('Get teacher review eligibility error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /teacher-reviews/teacher/:teacherId
 * Public. List reviews for teacher with pagination. ?limit=10&offset=0
 */
async function listByTeacher(req, res) {
    try {
        const { teacherId } = req.params;
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        const offset = parseInt(req.query.offset, 10) || 0;
        if (!teacherId) {
            return res.status(400).json({ error: 'Teacher ID is required.' });
        }
        const { reviews, total } = await teacherReviewService.getReviewsByTeacher(teacherId, limit, offset);
        const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
        const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
        const v1Url = baseUrl + (baseUrl.endsWith('/') ? 'v1' : '/v1');
        const r2Storage = require('../services/r2StorageService');

        const enriched = reviews.map((r) => {
            let user_avatar = null;
            const path = r.user_profile_image_path;
            if (path) {
                if (r2Storage.getPublicUrl) {
                    user_avatar = r2Storage.getPublicUrl(path);
                }
                if (!user_avatar && path.startsWith('students/')) {
                    user_avatar = `${v1Url}/student/profile/image/${encodeURIComponent(path)}`;
                } else if (
                    !user_avatar &&
                    (path.startsWith('/images/') || path.startsWith('images/'))
                ) {
                    const p = path.startsWith('/') ? path : `/${path}`;
                    user_avatar = `${baseUrl}${p}`;
                }
            }
            const { user_profile_image_path, ...rest } = r;
            return { ...rest, user_avatar };
        });

        return res.json({ reviews: enriched, total });
    } catch (error) {
        console.error('List teacher reviews error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /teacher-reviews/teacher/:teacherId/my-review
 * Auth required. Returns current user's review for this teacher or null.
 */
async function getMyReview(req, res) {
    try {
        const { teacherId } = req.params;
        if (!teacherId || !req.user?.id) {
            return res.status(400).json({ error: 'Teacher ID and authentication required.' });
        }
        const review = await teacherReviewService.getMyReview(req.user.id, teacherId);
        return res.json(review);
    } catch (error) {
        console.error('Get my teacher review error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /teacher-reviews/teacher/:teacherId/summary
 * Public. Returns { total, averageRating } for the teacher.
 */
async function getSummary(req, res) {
    try {
        const { teacherId } = req.params;
        if (!teacherId) {
            return res.status(400).json({ error: 'Teacher ID is required.' });
        }
        const summary = await teacherReviewService.getSummaryByTeacher(teacherId);
        return res.json(summary);
    } catch (error) {
        console.error('Get teacher review summary error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /teacher-reviews/teacher/:teacherId
 * Auth required, student only. Body: { rating: 1-5, comment?: string }
 */
async function createReview(req, res) {
    try {
        const { teacherId } = req.params;
        const { rating, comment } = req.body;

        if (!teacherId) {
            return res.status(400).json({ error: 'Teacher ID is required.' });
        }
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
        }

        const userRole = req.user.role || 'student';
        const eligibility = await teacherReviewService.checkEligibility(req.user.id, userRole, teacherId);
        if (!eligibility.allowed) {
            return res.status(403).json({ error: eligibility.reason || 'You are not eligible to review this teacher.' });
        }

        const review = await teacherReviewService.createOrUpdateReview(
            req.user.id,
            teacherId,
            parseInt(rating, 10),
            comment || null
        );

        return res.status(201).json(review);
    } catch (error) {
        console.error('Create teacher review error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = {
    getEligibility,
    listByTeacher,
    getMyReview,
    getSummary,
    createReview,
};
