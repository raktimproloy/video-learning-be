const announcementService = require('../services/announcementService');

module.exports = {
    async create(req, res) {
        try {
            const teacherId = req.user.id;
            const { courseId, title, description } = req.body || {};
            const body = description ?? req.body?.body ?? '';
            if (!courseId || !title || typeof title !== 'string' || !title.trim()) {
                return res.status(400).json({ error: 'Course and title are required' });
            }
            const announcement = await announcementService.create(teacherId, {
                courseId,
                title: title.trim(),
                body: body.trim(),
            });
            res.status(201).json({
                id: announcement.id,
                course_id: announcement.course_id,
                title: announcement.title,
                body: announcement.body,
                created_at: announcement.created_at,
            });
        } catch (error) {
            if (error.message === 'Course not found' || error.message.includes('own courses')) {
                return res.status(403).json({ error: error.message });
            }
            console.error('Create announcement error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getByTeacher(req, res) {
        try {
            const teacherId = req.user.id;
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
            const list = await announcementService.getByTeacher(teacherId, limit, offset);
            res.json(list.map(a => ({
                id: a.id,
                courseId: a.course_id,
                courseTitle: a.course_title,
                title: a.title,
                description: a.body,
                createdAt: a.created_at,
            })));
        } catch (error) {
            console.error('Get teacher announcements error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
