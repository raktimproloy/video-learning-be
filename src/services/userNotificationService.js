const db = require('../../db');

async function create(userId, { type = 'info', title, body, courseId = null }) {
    const result = await db.query(
        `INSERT INTO user_notifications (user_id, type, title, body, course_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, type, title || '', body || null, courseId]
    );
    return result.rows[0];
}

async function listByUser(userId, limit = 50, offset = 0) {
    const result = await db.query(
        `SELECT un.id, un.user_id, un.type, un.title, un.body, un.course_id, un.read_at, un.created_at, c.title AS course_title
         FROM user_notifications un
         LEFT JOIN courses c ON c.id = un.course_id
         WHERE un.user_id = $1
         ORDER BY un.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );
    return result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        courseId: row.course_id,
        courseTitle: row.course_title,
        createdAt: row.created_at,
        read: !!row.read_at,
    }));
}

async function getUnreadCount(userId) {
    const result = await db.query(
        `SELECT COUNT(*)::int AS count FROM user_notifications WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
    );
    return result.rows[0]?.count || 0;
}

async function markAsRead(notificationId, userId) {
    const result = await db.query(
        `UPDATE user_notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
        [notificationId, userId]
    );
    return result.rows[0] != null;
}

module.exports = {
    create,
    listByUser,
    getUnreadCount,
    markAsRead,
};
