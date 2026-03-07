const announcementService = require('../services/announcementService');
const userNotificationService = require('../services/userNotificationService');

const PREFIX_ANNOUNCEMENT = 'a-';
const PREFIX_USER_NOTIFICATION = 'n-';

module.exports = {
    async list(req, res) {
        try {
            const userId = req.user.id;
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
            const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

            const [announcements, userNotifications] = await Promise.all([
                announcementService.getForStudent(userId, limit, offset),
                userNotificationService.listByUser(userId, limit, offset),
            ]);

            const announcementItems = (announcements || []).map((n) => ({
                id: PREFIX_ANNOUNCEMENT + n.id,
                courseId: n.course_id,
                courseTitle: n.course_title || null,
                title: n.title,
                body: n.body,
                createdAt: n.created_at,
                read: !!n.read,
            }));

            const notificationItems = (userNotifications || []).map((n) => ({
                id: PREFIX_USER_NOTIFICATION + n.id,
                courseId: n.courseId,
                courseTitle: n.courseTitle || null,
                title: n.title,
                body: n.body,
                createdAt: n.createdAt,
                read: n.read,
            }));

            const merged = [...announcementItems, ...notificationItems]
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);

            res.json(merged);
        } catch (error) {
            console.error('List notifications error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getUnreadCount(req, res) {
        try {
            const userId = req.user.id;
            const [announcementCount, notificationCount] = await Promise.all([
                announcementService.getUnreadCount(userId),
                userNotificationService.getUnreadCount(userId),
            ]);
            const count = (announcementCount || 0) + (notificationCount || 0);
            res.json({ count });
        } catch (error) {
            console.error('Unread count error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async markAsRead(req, res) {
        try {
            const userId = req.user.id;
            const id = req.params.id;
            if (!id) return res.status(400).json({ error: 'Notification id required' });

            if (id.startsWith(PREFIX_ANNOUNCEMENT)) {
                const announcementId = id.slice(PREFIX_ANNOUNCEMENT.length);
                const ok = await announcementService.markAsRead(userId, announcementId);
                if (!ok) return res.status(404).json({ error: 'Notification not found or access denied' });
            } else if (id.startsWith(PREFIX_USER_NOTIFICATION)) {
                const notificationId = id.slice(PREFIX_USER_NOTIFICATION.length);
                const ok = await userNotificationService.markAsRead(notificationId, userId);
                if (!ok) return res.status(404).json({ error: 'Notification not found or access denied' });
            } else {
                return res.status(400).json({ error: 'Invalid notification id' });
            }
            res.json({ message: 'Marked as read' });
        } catch (error) {
            console.error('Mark as read error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async markAllAsRead(req, res) {
        try {
            const userId = req.user.id;
            await Promise.all([
                announcementService.markAllAsRead(userId),
                userNotificationService.markAllAsRead(userId),
            ]);
            res.json({ message: 'All notifications marked as read' });
        } catch (error) {
            console.error('Mark all as read error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
