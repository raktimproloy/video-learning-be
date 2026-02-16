const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');
const agoraService = require('../services/agoraService');
const adminService = require('../services/adminService');
const r2Storage = require('../services/r2StorageService');
const fs = require('fs');
const path = require('path');

const STAGING_DIR = path.resolve(__dirname, '../../staging');

class LessonController {
    async createLesson(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { courseId, title, description, order } = req.body;
            
            // Verify course ownership
            const course = await courseService.getCourseById(courseId);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

            const lesson = await lessonService.createLesson(courseId, title, description, order);
            res.status(201).json(lesson);
        } catch (error) {
            console.error('Create lesson error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLessonsByCourse(req, res) {
        try {
            const lessons = await lessonService.getLessonsByCourse(req.params.courseId);
            res.json(lessons);
        } catch (error) {
            console.error('Get lessons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLessonById(req, res) {
        try {
            const lesson = await lessonService.getLessonById(req.params.id);
            if (!lesson) {
                return res.status(404).json({ error: 'Lesson not found' });
            }
            res.json(lesson);
        } catch (error) {
            console.error('Get lesson error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async updateLesson(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { title, description, order } = req.body;
            
            const existingLesson = await lessonService.getLessonById(req.params.id);
            if (!existingLesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(existingLesson.course_id);
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

            const lesson = await lessonService.updateLesson(req.params.id, title, description, order);
            res.json(lesson);
        } catch (error) {
            console.error('Update lesson error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveLessons(req, res) {
        try {
            const lessons = req.user.role === 'student'
                ? await lessonService.getLiveLessonsForStudent(req.user.id)
                : await lessonService.getLiveLessons();
            res.json(lessons);
        } catch (error) {
            console.error('Get live lessons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getTeacherLiveLessons(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const lessons = await lessonService.getTeacherLiveLessons(req.user.id);
            res.json(lessons);
        } catch (error) {
            console.error('Get teacher live lessons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async setLiveAndGetToken(req, res) {
        try {
            const { id } = req.params;
            const { is_live } = req.body;
            const lesson = await lessonService.getLessonById(id);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });

            if (req.user.role === 'teacher') {
                if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
                if (is_live === true) {
                    await lessonService.updateLiveStatus(id, true);
                    const uid = Math.abs(req.user.id.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)) % 2147483647;
                    const creds = agoraService.generateRtcToken(id, uid, 'publisher');
                    if (!creds) return res.status(503).json({ error: 'Agora not configured. Set AGORA_APP_ID.' });
                    return res.json({ ...creds, lesson, is_live: true });
                }
                if (is_live === false) {
                    await lessonService.updateLiveStatus(id, false);
                    return res.json({ is_live: false, lesson });
                }
            }
            return res.status(400).json({ error: 'Invalid request' });
        } catch (error) {
            console.error('Set live error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveToken(req, res) {
        try {
            const { id } = req.params;
            const lesson = await lessonService.getLessonById(id);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });

            if (req.user.role === 'teacher') {
                if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
                const uid = Math.abs(req.user.id.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)) % 2147483647;
                const creds = agoraService.generateRtcToken(id, uid, 'publisher');
                if (!creds) return res.status(503).json({ error: 'Agora not configured.' });
                return res.json(creds);
            }

            if (req.user.role === 'student') {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Purchase this course to watch the live stream.' });
                if (!lesson.is_live) return res.status(404).json({ error: 'This lesson is not live.' });
                const uid = Math.abs(req.user.id.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)) % 2147483647;
                const creds = agoraService.generateRtcToken(id, uid, 'subscriber');
                if (!creds) return res.status(503).json({ error: 'Agora not configured.' });
                return res.json(creds);
            }

            return res.status(403).json({ error: 'Access denied' });
        } catch (error) {
            console.error('Get live token error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async deleteLesson(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const existingLesson = await lessonService.getLessonById(req.params.id);
            if (!existingLesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(existingLesson.course_id);
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

            await lessonService.deleteLesson(req.params.id);
            res.json({ message: 'Lesson deleted successfully' });
        } catch (error) {
            console.error('Delete lesson error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Save live stream recording. Teacher only; creates an encrypted video (same pipeline as uploaded videos).
     */
    async saveLiveRecording(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const lessonId = req.params.id;
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({ error: 'No recording file uploaded.' });
            }
            if (req.file.buffer.length < 1000) {
                return res.status(400).json({ error: 'Recording is too short or invalid. Record for at least a few seconds before saving.' });
            }

            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized to save recording for this lesson.' });

            const ownerId = req.user.id;
            const title = `Live: ${lesson.title}`;
            const useR2 = r2Storage.isConfigured;

            const video = await adminService.createVideo(
                title,
                'staging_placeholder',
                ownerId,
                lessonId,
                0,
                { storageProvider: useR2 ? 'r2' : 'local', r2Key: null }
            );

            const stagingVideoDir = path.join(STAGING_DIR, video.id);
            if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
            if (!fs.existsSync(stagingVideoDir)) fs.mkdirSync(stagingVideoDir, { recursive: true });

            const inputPath = path.join(stagingVideoDir, 'input.webm');
            fs.writeFileSync(inputPath, req.file.buffer);

            await adminService.updateVideoStoragePath(video.id, stagingVideoDir);
            if (useR2) {
                const r2Prefix = r2Storage.getVideoKeyPrefix(ownerId, course.id, lessonId, video.id);
                await adminService.updateVideoR2(video.id, r2Prefix);
            }

            await adminService.createProcessingTask(ownerId, video.id, 'h264', ['360p', '720p', '1080p'], 28, false);

            res.status(201).json({
                message: 'Recording saved. It will be encrypted and processed like other lesson videos.',
                video_id: video.id,
                lesson_id: lessonId,
            });
        } catch (error) {
            console.error('Save live recording error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }
}

module.exports = new LessonController();
