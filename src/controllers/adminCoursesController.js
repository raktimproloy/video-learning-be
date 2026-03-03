const adminCoursesService = require('../services/adminCoursesService');
const courseService = require('../services/courseService');
const lessonService = require('../services/lessonService');
const videoService = require('../services/videoService');
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
