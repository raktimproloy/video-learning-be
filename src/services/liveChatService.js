const db = require('../../db');

class LiveChatService {
    async getMessages(lessonId, limit = 500) {
        const result = await db.query(
            `SELECT id, user_id, user_type, user_display_name, message, created_at
             FROM live_chat_messages
             WHERE lesson_id = $1
             ORDER BY created_at ASC
             LIMIT $2`,
            [lessonId, limit]
        );
        return result.rows;
    }

    async addMessage(lessonId, userId, userType, userDisplayName, message) {
        const result = await db.query(
            `INSERT INTO live_chat_messages (lesson_id, user_id, user_type, user_display_name, message)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [lessonId, userId, userType, (userDisplayName || '').slice(0, 100), (message || '').slice(0, 2000)]
        );
        const row = result.rows[0];
        return row ? {
            id: row.id,
            user_id: row.user_id,
            user_type: row.user_type,
            user_display_name: row.user_display_name,
            message: row.message,
            created_at: row.created_at,
        } : null;
    }
}

module.exports = new LiveChatService();
