const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');
const agoraService = require('../services/agoraService');

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
}

module.exports = new LessonController();
