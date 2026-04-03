const adminCoursesService = require('../services/adminCoursesService');
const courseService = require('../services/courseService');
const lessonService = require('../services/lessonService');
const videoService = require('../services/videoService');
const reviewService = require('../services/reviewService');
const r2Storage = require('../services/r2StorageService');
const path = require('path');
const fs = require('fs');

class AdminCoursesController {
    async list(req, res) {
        try {
            const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
            const q = req.query.q || null;

            const { courses, total } = await adminCoursesService.list(skip, limit, q);
            res.json({ courses, total });
        } catch (error) {
            console.error('Admin courses list error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getById(req, res) {
        try {
            const course = await adminCoursesService.getById(req.params.id);
            if (!course) {
                return res.status(404).json({ error: 'Course not found' });
            }
            res.json(course);
        } catch (error) {
            console.error('Admin get course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getContent(req, res) {
        try {
            const course = await courseService.getCourseByIdSimple(req.params.id);
            if (!course) {
                return res.status(404).json({ error: 'Course not found' });
            }

            const teacherId = course.teacher_id;
            // Treat admin as owner to see all lesson/video statuses
            const lessons = await lessonService.getLessonsByCourse(
                req.params.id,
                teacherId,
                teacherId
            );

            const lessonsWithVideos = [];
            for (const lesson of lessons) {
                const videos = await videoService.getVideosByLesson(
                    lesson.id,
                    null,
                    false,
                    true
                );
                lessonsWithVideos.push({
                    id: lesson.id,
                    title: lesson.title,
                    description: lesson.description,
                    order: lesson.order,
                    status: lesson.status,
                    isPreview: lesson.isPreview,
                    videoCount: lesson.videoCount,
                    durationMinutes: lesson.duration,
                    hasRequiredAssignment: lesson.hasRequiredAssignment,
                    liveBroadcastStatus: lesson.liveBroadcastStatus,
                    videos: videos.map((v) => ({
                        id: v.id,
                        title: v.title,
                        order: v.order,
                        status: v.status,
                        isPreview: v.isPreview,
                        durationSeconds: v.duration_seconds ?? null,
                        sourceType: v.source_type,
                        viewCount: v.viewCount,
                    })),
                });
            }

            res.json({ lessons: lessonsWithVideos });
        } catch (error) {
            console.error('Admin get course content error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async update(req, res) {
        try {
            const existingCourse = await courseService.getCourseByIdSimple(req.params.id);
            if (!existingCourse) {
                return res.status(404).json({ error: 'Course not found' });
            }

            const {
                title,
                shortDescription,
                fullDescription,
                description,
                level,
                price,
                discountPrice,
                currency,
                status,
                language,
                subtitle,
                courseType,
                hasLiveClass,
                hasAssignments,
                adminCategoryId,
                admin_category_id,
                tags,
            } = req.body;

            const courseData = {};

            if (title !== undefined) courseData.title = String(title).trim();
            if (shortDescription !== undefined) courseData.shortDescription = String(shortDescription).trim();
            const effectiveFullDescription = fullDescription !== undefined ? fullDescription : description;
            if (effectiveFullDescription !== undefined) {
                courseData.fullDescription = String(effectiveFullDescription).trim();
            }
            if (level !== undefined) courseData.level = String(level).trim();
            if (price !== undefined) courseData.price = price;
            if (discountPrice !== undefined) courseData.discountPrice = discountPrice;
            if (currency !== undefined) courseData.currency = String(currency);
            if (language !== undefined) courseData.language = String(language);
            if (subtitle !== undefined) courseData.subtitle = String(subtitle).trim();
            if (courseType !== undefined) courseData.courseType = courseType;

            if (hasLiveClass !== undefined) {
                courseData.hasLiveClass = hasLiveClass === 'true' || hasLiveClass === true;
            }
            if (hasAssignments !== undefined) {
                courseData.hasAssignments = hasAssignments === 'true' || hasAssignments === true;
            }

            if (tags !== undefined) {
                try {
                    courseData.tags = typeof tags === 'string' ? JSON.parse(tags) : tags;
                } catch (e) {
                    courseData.tags = [];
                }
            }

            const effectiveAdminCategoryId = admin_category_id !== undefined ? admin_category_id : adminCategoryId;
            if (effectiveAdminCategoryId !== undefined) {
                courseData.admin_category_id = effectiveAdminCategoryId || null;
            }

            if (status !== undefined) {
                const allowed = ['draft', 'active', 'inactive', 'archived'];
                if (!allowed.includes(String(status))) {
                    return res.status(400).json({
                        error: 'Invalid status. Use: draft, active, inactive, or archived.',
                    });
                }
                courseData.status = status;
            }

            const updated = await courseService.updateCourse(req.params.id, courseData);
            res.json(updated);
        } catch (error) {
            console.error('Admin update course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getStats(req, res) {
        try {
            const stats = await adminCoursesService.getCourseStats(req.params.id);
            if (!stats) {
                return res.status(404).json({ error: 'Course not found' });
            }
            res.json(stats);
        } catch (error) {
            console.error('Admin course stats error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getReviews(req, res) {
        try {
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
            const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
            const result = await adminCoursesService.getCourseReviews(req.params.id, limit, offset);
            if (!result) {
                return res.status(404).json({ error: 'Course not found' });
            }
            res.json(result);
        } catch (error) {
            console.error('Admin course reviews error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async updateReview(req, res) {
        try {
            const { id: courseId, reviewId } = req.params;
            const { rating, comment } = req.body;
            const review = await reviewService.getReviewById(reviewId);
            if (!review) {
                return res.status(404).json({ error: 'Review not found' });
            }
            if (review.course_id !== courseId) {
                return res.status(400).json({ error: 'Review does not belong to this course' });
            }
            await reviewService.updateReviewById(reviewId, { rating, comment });
            const dto = await adminCoursesService.getReviewAdminById(reviewId);
            if (!dto) {
                return res.status(404).json({ error: 'Review not found' });
            }
            res.json(dto);
        } catch (error) {
            if (error.message === 'Rating must be between 1 and 5') {
                return res.status(400).json({ error: error.message });
            }
            if (String(error.message || '').includes('Comment must be at most')) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Admin update review error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async deleteReview(req, res) {
        try {
            const { id: courseId, reviewId } = req.params;
            const review = await reviewService.getReviewById(reviewId);
            if (!review) {
                return res.status(404).json({ error: 'Review not found' });
            }
            if (review.course_id !== courseId) {
                return res.status(400).json({ error: 'Review does not belong to this course' });
            }
            await reviewService.deleteReviewById(reviewId);
            res.json({ message: 'Review deleted' });
        } catch (error) {
            console.error('Admin delete review error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async setVideoViewCount(req, res) {
        try {
            const { id: courseId, videoId } = req.params;
            const viewCount = req.body.viewCount != null ? req.body.viewCount : req.body.view_count;
            const num = parseInt(viewCount, 10);
            if (Number.isNaN(num) || num < 0) {
                return res.status(400).json({ error: 'viewCount must be a non-negative number' });
            }
            const result = await adminCoursesService.setVideoViewCount(courseId, videoId, num);
            if (!result) {
                return res.status(404).json({ error: 'Video not found or does not belong to this course' });
            }
            res.json(result);
        } catch (error) {
            console.error('Admin set video view count error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getEnrollments(req, res) {
        try {
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
            const result = await adminCoursesService.getCourseEnrollments(req.params.id, limit, offset);
            if (!result) {
                return res.status(404).json({ error: 'Course not found' });
            }
            res.json(result);
        } catch (error) {
            console.error('Admin course enrollments error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async addDummyEnrollments(req, res) {
        try {
            const courseId = req.params.id;
            const count = parseInt(req.body.count ?? req.body.number ?? 0, 10);
            if (Number.isNaN(count) || count < 1 || count > 100) {
                return res.status(400).json({ error: 'count must be a number between 1 and 100' });
            }
            const result = await adminCoursesService.addDummyEnrollments(courseId, count);
            if (!result) {
                return res.status(404).json({ error: 'Course not found' });
            }
            res.status(201).json(result);
        } catch (error) {
            console.error('Admin add dummy enrollments error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async addReview(req, res) {
        try {
            const courseId = req.params.id;
            const { studentName, review: comment, rating } = req.body;
            if (rating == null || rating === '') {
                return res.status(400).json({ error: 'rating is required (1–5)' });
            }
            const r = parseInt(rating, 10);
            if (Number.isNaN(r) || r < 1 || r > 5) {
                return res.status(400).json({ error: 'rating must be between 1 and 5' });
            }
            const result = await adminCoursesService.addSingleReview(courseId, {
                studentName: studentName != null ? String(studentName).trim() : 'Student',
                review: comment,
                rating: r,
            });
            if (result === null) {
                return res.status(404).json({ error: 'Course not found or reviews table missing' });
            }
            res.status(201).json(result);
        } catch (error) {
            console.error('Admin add review error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async delete(req, res) {
        try {
            const course = await courseService.getCourseByIdSimple(req.params.id);
            if (!course) {
                return res.status(404).json({ error: 'Course not found' });
            }

            // Delete associated media (same logic as teacher delete)
            if (course.thumbnail_path) {
                if (r2Storage.isConfigured && course.thumbnail_path.startsWith('teachers/')) {
                    try {
                        await r2Storage.deleteObject(course.thumbnail_path);
                    } catch (err) {
                        console.error('Error deleting thumbnail from R2:', err);
                    }
                } else if (course.thumbnail_path.startsWith('/uploads/')) {
                    const thumbnailPath = path.join(__dirname, '../../uploads', course.thumbnail_path.replace('/uploads/', ''));
                    if (fs.existsSync(thumbnailPath)) {
                        try {
                            fs.unlinkSync(thumbnailPath);
                        } catch (err) {
                            console.error('Error deleting thumbnail:', err);
                        }
                    }
                }
            }
            if (course.intro_video_path) {
                if (r2Storage.isConfigured && course.intro_video_path.startsWith('teachers/')) {
                    try {
                        await r2Storage.deleteObject(course.intro_video_path);
                    } catch (err) {
                        console.error('Error deleting intro video from R2:', err);
                    }
                } else if (course.intro_video_path.startsWith('/uploads/')) {
                    const videoPath = path.join(__dirname, '../../uploads', course.intro_video_path.replace('/uploads/', ''));
                    if (fs.existsSync(videoPath)) {
                        try {
                            fs.unlinkSync(videoPath);
                        } catch (err) {
                            console.error('Error deleting intro video:', err);
                        }
                    }
                }
            }

            await courseService.deleteCourse(req.params.id);
            res.json({ message: 'Course deleted successfully' });
        } catch (error) {
            console.error('Admin delete course error:', error);
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }
}

module.exports = new AdminCoursesController();
