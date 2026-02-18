const announcementService = require('../services/announcementService');

module.exports = {
    async list(req, res) {
        try {
            const userId = req.user.id;
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
            const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
            const list = await announcementService.getForStudent(userId, limit, offset);
            res.json(list.map(n => ({
                id: n.id,
                courseId: n.course_id,
                courseTitle: n.course_title,
                title: n.title,
                body: n.body,
                createdAt: n.created_at,
                read: n.read,
            })));
        } catch (error) {
            console.error('List notifications error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getUnreadCount(req, res) {
        try {
            const userId = req.user.id;
            const count = await announcementService.getUnreadCount(userId);
            res.json({ count });
        } catch (error) {
            console.error('Unread count error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async markAsRead(req, res) {
        try {
            const userId = req.user.id;
            const announcementId = req.params.id;
            const ok = await announcementService.markAsRead(userId, announcementId);
            if (!ok) return res.status(404).json({ error: 'Notification not found or access denied' });
            res.json({ message: 'Marked as read' });
        } catch (error) {
            console.error('Mark as read error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
