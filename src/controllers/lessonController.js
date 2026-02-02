const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');

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
