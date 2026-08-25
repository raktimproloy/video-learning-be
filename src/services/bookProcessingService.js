const db = require('../../db');

class BookProcessingService {
    async enqueue(courseBookId) {
        // Cancel any pending tasks for this book
        await db.query(
            `UPDATE book_processing_tasks
             SET status = 'failed',
                 error_message = 'Superseded by newer upload',
                 updated_at = NOW()
             WHERE course_book_id = $1 AND status = 'pending'`,
            [courseBookId]
        );

        const result = await db.query(
            `INSERT INTO book_processing_tasks (course_book_id, status)
             VALUES ($1, 'pending')
             RETURNING *`,
            [courseBookId]
        );

        await db.query(
            `UPDATE course_books
             SET processing_status = 'pending', processing_error = NULL, updated_at = NOW()
             WHERE id = $1`,
            [courseBookId]
        );

        return result.rows[0];
    }

    async getStatus(courseBookId) {
        const book = await db.query(
            `SELECT id, processing_status, processing_error, total_pages, master_pdf_r2_key
             FROM course_books WHERE id = $1`,
            [courseBookId]
        );
        const task = await db.query(
            `SELECT id, status, processing_stage, error_message, started_at, completed_at, created_at
             FROM book_processing_tasks
             WHERE course_book_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [courseBookId]
        );
        const pages = await db.query(
            `SELECT COUNT(*)::int AS c FROM book_page_assets WHERE course_book_id = $1`,
            [courseBookId]
        );

        const b = book.rows[0];
        const t = task.rows[0];
        return {
            bookId: courseBookId,
            processingStatus: b?.processing_status || 'pending',
            processingError: b?.processing_error || null,
            totalPages: b?.total_pages || 0,
            pagesReady: pages.rows[0]?.c || 0,
            hasPdf: !!b?.master_pdf_r2_key,
            task: t
                ? {
                      id: t.id,
                      status: t.status,
                      stage: t.processing_stage,
                      error: t.error_message,
                      startedAt: t.started_at,
                      completedAt: t.completed_at,
                  }
                : null,
        };
    }

    async resetStuckTasks() {
        // Any in-flight task dies with the Node process — re-queue on worker boot
        const interrupted = await db.query(
            `UPDATE book_processing_tasks
             SET status = 'pending',
                 processing_stage = NULL,
                 error_message = NULL,
                 started_at = NULL,
                 updated_at = NOW()
             WHERE status = 'processing'
             RETURNING id, course_book_id`
        );
        for (const row of interrupted.rows) {
            await db.query(
                `UPDATE course_books
                 SET processing_status = 'pending',
                     processing_error = NULL,
                     updated_at = NOW()
                 WHERE id = $1`,
                [row.course_book_id]
            );
        }

        const result = await db.query(
            `UPDATE book_processing_tasks
             SET status = 'failed',
                 error_message = 'Processing timed out (server restart or crash). Please retry.',
                 processing_stage = NULL,
                 updated_at = NOW()
             WHERE status = 'processing'
               AND started_at IS NOT NULL
               AND started_at < NOW() - INTERVAL '2 hours'
             RETURNING id, course_book_id`
        );
        for (const row of result.rows) {
            await db.query(
                `UPDATE course_books
                 SET processing_status = 'failed',
                     processing_error = 'Processing timed out. Please re-upload.',
                     updated_at = NOW()
                 WHERE id = $1`,
                [row.course_book_id]
            );
        }
        return (interrupted.rows.length || 0) + (result.rows.length || 0);
    }

    async pickNextTask() {
        const result = await db.query(
            `UPDATE book_processing_tasks
             SET status = 'processing', started_at = NOW(), updated_at = NOW()
             WHERE id = (
                 SELECT id FROM book_processing_tasks
                 WHERE status = 'pending'
                 ORDER BY created_at ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING *`
        );
        return result.rows[0] || null;
    }
}

module.exports = new BookProcessingService();
