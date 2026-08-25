const db = require('../../db');
const r2Storage = require('./r2StorageService');

// Simple in-memory rate limit: userId:bookId -> timestamps
const pageFetchLog = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 45;

function checkRateLimit(userId, bookId) {
    const key = `${userId || 'anon'}:${bookId}`;
    const now = Date.now();
    let arr = pageFetchLog.get(key) || [];
    arr = arr.filter((t) => now - t < RATE_WINDOW_MS);
    if (arr.length >= RATE_MAX) return false;
    arr.push(now);
    pageFetchLog.set(key, arr);
    return true;
}

class BookReaderService {
    async getPageAsset(bookId, pageIndex) {
        const result = await db.query(
            `SELECT bpa.*, cb.preview_page_count, cb.status, cb.processing_status, cb.teacher_id, cb.course_id
             FROM book_page_assets bpa
             JOIN course_books cb ON cb.id = bpa.course_book_id
             WHERE bpa.course_book_id = $1 AND bpa.page_index = $2`,
            [bookId, pageIndex]
        );
        return result.rows[0] || null;
    }

    async assertCanViewPage(userId, bookId, pageIndex, { previewOnly = false } = {}) {
        const book = await db.query(
            `SELECT id, status, processing_status, preview_page_count, total_pages
             FROM course_books WHERE id = $1`,
            [bookId]
        );
        const b = book.rows[0];
        if (!b) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }
        if (b.status === 'suspended') {
            const err = new Error('Book is unavailable');
            err.status = 403;
            throw err;
        }

        const page = parseInt(pageIndex, 10);
        if (Number.isNaN(page) || page < 0) {
            const err = new Error('Invalid page');
            err.status = 400;
            throw err;
        }

        const previewCount = Math.min(b.preview_page_count || 3, 5);

        if (previewOnly || !userId) {
            if (page >= previewCount) {
                const err = new Error('Preview limit reached — purchase to continue reading');
                err.status = 403;
                throw err;
            }
            if (b.status !== 'published' && b.status !== 'draft') {
                const err = new Error('Book not published');
                err.status = 403;
                throw err;
            }
            return { mode: 'preview', book: b };
        }

        const bookEntitlementService = require('./bookEntitlementService');
        const ent = await bookEntitlementService.getActive(userId, bookId);
        const isTeacher = b && userId && String(b.teacher_id) === String(userId);
        if ((!ent || !ent.has_pdf) && !isTeacher) {
            // Allow preview pages even when logged in without entitlement
            if (page < previewCount && (b.status === 'published' || b.status === 'draft')) {
                return { mode: 'preview', book: b };
            }
            const err = new Error('You do not have access to this book');
            err.status = 403;
            throw err;
        }

        return { mode: 'entitled', book: b, entitlement: ent || { has_pdf: true } };
    }

    async streamPage(userId, bookId, pageIndex, res, { previewOnly = false } = {}) {
        if (!checkRateLimit(userId, bookId)) {
            const err = new Error('Too many page requests — slow down');
            err.status = 429;
            throw err;
        }

        await this.assertCanViewPage(userId, bookId, pageIndex, { previewOnly });

        const asset = await this.getPageAsset(bookId, pageIndex);
        if (!asset) {
            const err = new Error('Page not ready');
            err.status = 404;
            throw err;
        }

        if (userId && !previewOnly) {
            db.query(
                `INSERT INTO book_read_events (user_id, course_book_id, page_index) VALUES ($1,$2,$3)`,
                [userId, bookId, pageIndex]
            ).catch(() => {});
        }

        if (!r2Storage.isConfigured) {
            const err = new Error('Storage not configured');
            err.status = 500;
            throw err;
        }

        const stream = await r2Storage.getObjectStream(asset.r2_key);
        const isWebp = String(asset.r2_key).endsWith('.webp');
        res.setHeader('Content-Type', isWebp ? 'image/webp' : 'image/png');
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        if (typeof stream.pipe === 'function') {
            stream.pipe(res);
        } else {
            // AWS SDK v3 may return async iterable
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            res.send(Buffer.concat(chunks));
        }
    }

    async getReaderMeta(userId, bookId) {
        const bookEntitlementService = require('./bookEntitlementService');
        const bookService = require('./bookService');
        const book = await db.query(`
            SELECT b.*, t.name as teacher_name, c.title as course_title
            FROM course_books b
            LEFT JOIN users t ON b.teacher_id = t.id
            LEFT JOIN courses c ON b.course_id = c.id
            WHERE b.id = $1
        `, [bookId]);
        
        if (!book.rows[0]) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }
        const b = book.rows[0];

        const ent = await bookEntitlementService.getActive(userId, bookId);
        const isTeacher = b && userId && String(b.teacher_id) === String(userId);
        if ((!ent || !ent.has_pdf) && !isTeacher) {
            const err = new Error('You do not have access to this book');
            err.status = 403;
            throw err;
        }
        return {
            id: b.id,
            title: b.title,
            subtitle: b.subtitle,
            totalPages: b.total_pages,
            coverPath: b.cover_path,
            courseId: b.course_id,
            courseTitle: b.course_title,
            teacherName: b.teacher_name,
            deliveryMode: b.delivery_mode,
            hasCourier: !!ent.has_courier,
        };
    }

    async saveReadingProgress(userId, bookId, lastPage) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS book_reading_progress (
                user_id UUID NOT NULL,
                course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
                last_page INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, course_book_id)
            )
        `);

        await db.query(`
            INSERT INTO book_reading_progress (user_id, course_book_id, last_page, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id, course_book_id)
            DO UPDATE SET 
                last_page = EXCLUDED.last_page,
                updated_at = CURRENT_TIMESTAMP
        `, [userId, bookId, lastPage]);

        return { success: true, lastPage };
    }

    async getReadingProgress(userId, bookId) {
        try {
            const result = await db.query(`
                SELECT last_page 
                FROM book_reading_progress 
                WHERE user_id = $1 AND course_book_id = $2
            `, [userId, bookId]);
            return result.rows[0] ? result.rows[0].last_page : 0;
        } catch (error) {
            // Table might not exist yet, safe to return 0
            if (error.code === '42P01') {
                return 0;
            }
            throw error;
        }
    }
}

module.exports = new BookReaderService();
