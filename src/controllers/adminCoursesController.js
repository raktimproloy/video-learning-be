const adminCoursesService = require('../services/adminCoursesService');
const courseService = require('../services/courseService');
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
