const reviewService = require('../services/reviewService');

class ReviewController {
    /**
     * Create or update a review
     */
    async createOrUpdateReview(req, res) {
        try {
            const { courseId } = req.params;
            const { rating, comment } = req.body;

            if (!rating || rating < 1 || rating > 5) {
                return res.status(400).json({ error: 'Rating must be between 1 and 5' });
            }

            const review = await reviewService.createOrUpdateReview(
                req.user.id,
                courseId,
                parseInt(rating),
                comment || null
            );

            res.json(review);
        } catch (error) {
            console.error('Create/update review error:', error);
            if (error.code === 'REVIEW_ALREADY_EXISTS') {
                return res.status(409).json({ error: error.message });
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get user's review for a course
     */
    async getMyReview(req, res) {
        try {
            const { courseId } = req.params;
            const review = await reviewService.getReviewByUserAndCourse(req.user.id, courseId);
            res.json(review);
        } catch (error) {
            console.error('Get my review error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get all reviews for a course
     */
    async getCourseReviews(req, res) {
        try {
            const { courseId } = req.params;
            const limit = parseInt(req.query.limit) || 10;
            const offset = parseInt(req.query.offset) || 0;
            
            const reviews = await reviewService.getReviewsByCourse(courseId, limit, offset);
            res.json(reviews);
        } catch (error) {
            console.error('Get course reviews error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get course rating statistics
     */
    async getCourseRatingStats(req, res) {
        try {
            const { courseId } = req.params;
            const stats = await reviewService.getCourseRatingStats(courseId);
            res.json(stats);
        } catch (error) {
            console.error('Get course rating stats error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get all reviews for the current teacher's courses
     */
    async getMyCourseReviews(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const reviews = await reviewService.getReviewsByTeacher(req.user.id);
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
                    }
                }
                const { user_profile_image_path, ...rest } = r;
                return { ...rest, user_avatar };
            });
            res.json(enriched);
        } catch (error) {
            console.error('Get my course reviews error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Delete a review
     */
    async deleteReview(req, res) {
        try {
            const { courseId } = req.params;
            const review = await reviewService.deleteReview(req.user.id, courseId);
            
            if (!review) {
                return res.status(404).json({ error: 'Review not found' });
            }

            res.json({ message: 'Review deleted successfully' });
        } catch (error) {
            console.error('Delete review error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new ReviewController();
