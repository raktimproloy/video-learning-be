const db = require('../../db');

class BookCommissionService {
    async getPlatformPercent(teacherId) {
        // Per-teacher override
        if (teacherId) {
            const custom = await db.query(
                `SELECT custom_book_percent FROM custom_user_percentages
                 WHERE user_type = 'teacher' AND user_id = $1`,
                [teacherId]
            );
            if (
                custom.rows[0] &&
                custom.rows[0].custom_book_percent != null &&
                !Number.isNaN(parseFloat(custom.rows[0].custom_book_percent))
            ) {
                return parseFloat(custom.rows[0].custom_book_percent);
            }
        }

        const settings = await db.query(
            `SELECT book_platform_percent FROM admin_share_settings
             WHERE id = '00000000-0000-0000-0000-000000000001'::uuid`
        );
        const pct = settings.rows[0]?.book_platform_percent;
        return pct != null ? parseFloat(pct) : 0;
    }

    async recordFromPurchase({
        courseBookId,
        courseId,
        studentId,
        paymentRequestId,
        entitlementId,
        bookAmount,
        currency = 'BDT',
    }) {
        const amount = parseFloat(bookAmount) || 0;
        if (amount <= 0) return null;

        const book = await db.query(
            `SELECT teacher_id FROM course_books WHERE id = $1`,
            [courseBookId]
        );
        const teacherId = book.rows[0]?.teacher_id;
        if (!teacherId) return null;

        const platformPercent = await this.getPlatformPercent(teacherId);
        const platformAmount = Math.round(((amount * platformPercent) / 100) * 100) / 100;
        const teacherAmount = Math.round((amount - platformAmount) * 100) / 100;

        const result = await db.query(
            `INSERT INTO book_commissions (
                course_book_id, course_id, teacher_id, student_id,
                payment_request_id, entitlement_id,
                book_amount, platform_percent, platform_amount, teacher_amount, currency
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
                courseBookId,
                courseId,
                teacherId,
                studentId,
                paymentRequestId,
                entitlementId,
                amount,
                platformPercent,
                platformAmount,
                teacherAmount,
                currency,
            ]
        );
        return result.rows[0];
    }

    async getTeacherEarnings(teacherId) {
        const result = await db.query(
            `SELECT
                COALESCE(SUM(teacher_amount), 0)::float AS total_teacher,
                COALESCE(SUM(platform_amount), 0)::float AS total_platform,
                COALESCE(SUM(book_amount), 0)::float AS total_gross,
                COUNT(*)::int AS sale_count
             FROM book_commissions
             WHERE teacher_id = $1`,
            [teacherId]
        );
        return result.rows[0];
    }
}

module.exports = new BookCommissionService();
