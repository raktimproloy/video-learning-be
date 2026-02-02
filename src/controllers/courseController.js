const courseService = require('../services/courseService');

class CourseController {
    async createCourse(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { title, description } = req.body;
            const course = await courseService.createCourse(req.user.id, title, description);
            res.status(201).json(course);
        } catch (error) {
            console.error('Create course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getMyCourses(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const courses = await courseService.getCoursesByTeacher(req.user.id);
            res.json(courses);
        } catch (error) {
            console.error('Get my courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getAllCourses(req, res) {
        try {
            const courses = await courseService.getAllCourses();
            res.json(courses);
        } catch (error) {
            console.error('Get all courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getCourseById(req, res) {
        try {
            const course = await courseService.getCourseById(req.params.id);
            if (!course) {
                return res.status(404).json({ error: 'Course not found' });
            }
            res.json(course);
        } catch (error) {
            console.error('Get course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async updateCourse(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { title, description } = req.body;
            // TODO: Check if teacher owns the course
            const existingCourse = await courseService.getCourseById(req.params.id);
            if (!existingCourse) return res.status(404).json({ error: 'Course not found' });
            if (existingCourse.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

            const course = await courseService.updateCourse(req.params.id, title, description);
            res.json(course);
        } catch (error) {
            console.error('Update course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async deleteCourse(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const existingCourse = await courseService.getCourseById(req.params.id);
            if (!existingCourse) return res.status(404).json({ error: 'Course not found' });
            if (existingCourse.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

            await courseService.deleteCourse(req.params.id);
            res.json({ message: 'Course deleted successfully' });
        } catch (error) {
            console.error('Delete course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async purchaseCourse(req, res) {
        try {
            const courseId = req.params.id;
            const userId = req.user.id;
            
            // In a real app, handle payment verification here
            
            await courseService.enrollUser(userId, courseId);
            res.json({ message: 'Course purchased successfully' });
        } catch (error) {
            console.error('Purchase course error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getPurchasedCourses(req, res) {
        try {
            const courses = await courseService.getPurchasedCourses(req.user.id);
            res.json(courses);
        } catch (error) {
            console.error('Get purchased courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getAvailableCourses(req, res) {
        try {
            const courses = await courseService.getUnpurchasedCourses(req.user.id);
            res.json(courses);
        } catch (error) {
            console.error('Get available courses error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new CourseController();
