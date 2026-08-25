const db = require('../../db');

class BookAnnotationService {
    async assertAccess(userId, bookId) {
        // First check if the user is the teacher of the course
        const teacherCheck = await db.query(
            `SELECT c.teacher_id 
             FROM course_books cb 
             JOIN courses c ON c.id = cb.course_id 
             WHERE cb.id = $1`,
            [bookId]
        );
        if (teacherCheck.rows.length > 0 && teacherCheck.rows[0].teacher_id === userId) {
            return { has_pdf: true }; // Teacher bypass
        }

        const bookEntitlementService = require('./bookEntitlementService');
        const ent = await bookEntitlementService.getActive(userId, bookId);
        if (!ent || !ent.has_pdf) {
            const err = new Error('You do not have access to this book');
            err.status = 403;
            throw err;
        }
        return ent;
    }

    map(row) {
        return {
            id: row.id,
            bookId: row.course_book_id,
            pageIndex: row.page_index,
            type: row.type,
            styleTag: row.style_tag,
            data: row.data,
            rect: row.rect,         // Kept for backward compat
            color: row.color,       // Kept for backward compat
            noteText: row.note_text,// Kept for backward compat
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async list(userId, bookId, pageIndex = null) {
        await this.assertAccess(userId, bookId);
        const params = [userId, bookId];
        let sql = `SELECT * FROM book_user_annotations
                   WHERE user_id = $1 AND course_book_id = $2`;
        if (pageIndex != null) {
            params.push(parseInt(pageIndex, 10));
            sql += ` AND page_index = $3`;
        }
        sql += ` ORDER BY page_index ASC, created_at ASC`;
        const result = await db.query(sql, params);
        return result.rows.map((r) => this.map(r));
    }

    async create(userId, bookId, dataPayload) {
        await this.assertAccess(userId, bookId);
        const { type, pageIndex, rect, color, noteText, styleTag, data } = dataPayload;
        
        if (!['highlight', 'note', 'draw', 'text'].includes(type)) {
            const err = new Error('type must be highlight, note, draw, or text');
            err.status = 400;
            throw err;
        }
        if (pageIndex == null) {
            const err = new Error('pageIndex is required');
            err.status = 400;
            throw err;
        }
        const result = await db.query(
            `INSERT INTO book_user_annotations (
                user_id, course_book_id, page_index, type, rect, color, note_text, style_tag, data
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [
                userId, 
                bookId, 
                parseInt(pageIndex, 10), 
                type, 
                rect ? JSON.stringify(rect) : null, 
                color || null, 
                noteText || null,
                styleTag || null,
                data ? JSON.stringify(data) : null
            ]
        );
        return this.map(result.rows[0]);
    }

    async update(userId, annotationId, dataPayload) {
        const existing = await db.query(
            `SELECT * FROM book_user_annotations WHERE id = $1 AND user_id = $2`,
            [annotationId, userId]
        );
        if (!existing.rows[0]) {
            const err = new Error('Annotation not found');
            err.status = 404;
            throw err;
        }
        const { rect, color, noteText, styleTag, data } = dataPayload;
        const result = await db.query(
            `UPDATE book_user_annotations SET
                rect = COALESCE($1, rect),
                color = COALESCE($2, color),
                note_text = COALESCE($3, note_text),
                style_tag = COALESCE($4, style_tag),
                data = COALESCE($5, data),
                updated_at = NOW()
             WHERE id = $6
             RETURNING *`,
            [
                rect != null ? JSON.stringify(rect) : null,
                color != null ? color : null,
                noteText !== undefined ? noteText : null,
                styleTag != null ? styleTag : null,
                data != null ? JSON.stringify(data) : null,
                annotationId,
            ]
        );
        return this.map(result.rows[0]);
    }

    async remove(userId, annotationId) {
        const result = await db.query(
            `DELETE FROM book_user_annotations WHERE id = $1 AND user_id = $2 RETURNING id`,
            [annotationId, userId]
        );
        if (!result.rows[0]) {
            const err = new Error('Annotation not found');
            err.status = 404;
            throw err;
        }
        return { deleted: true };
    }

    async bulkSync(userId, bookId, { updates = [], deletes = [] }) {
        await this.assertAccess(userId, bookId);
        
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            
            // Handle deletions
            if (deletes.length > 0) {
                await client.query(
                    `DELETE FROM book_user_annotations WHERE user_id = $1 AND course_book_id = $2 AND id = ANY($3::uuid[])`,
                    [userId, bookId, deletes]
                );
            }
            
            // Handle updates/inserts (upsert based on id)
            // For upsert, we need to handle it one by one or construct a complex query.
            // Since this is a bulk sync from client, we'll process them sequentially for simplicity.
            for (const item of updates) {
                const { id, type, pageIndex, styleTag, data } = item;
                
                // Try to update first
                const updateRes = await client.query(
                    `UPDATE book_user_annotations SET
                        style_tag = $1,
                        data = $2,
                        updated_at = NOW()
                     WHERE id = $3 AND user_id = $4 AND course_book_id = $5`,
                    [styleTag || null, data ? JSON.stringify(data) : null, id, userId, bookId]
                );
                
                // If not updated, it's a new insert
                if (updateRes.rowCount === 0) {
                    await client.query(
                        `INSERT INTO book_user_annotations (
                            id, user_id, course_book_id, page_index, type, style_tag, data
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [
                            id,
                            userId,
                            bookId,
                            parseInt(pageIndex, 10),
                            type,
                            styleTag || null,
                            data ? JSON.stringify(data) : null
                        ]
                    );
                }
            }
            
            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new BookAnnotationService();
