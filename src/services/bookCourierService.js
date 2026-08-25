const db = require('../../db');

const LOCKED_STATUSES = new Set(['processing', 'shipped', 'delivered', 'cancelled']);

class BookCourierService {
    mapOrder(row) {
        if (!row) return null;
        return {
            id: row.id,
            entitlementId: row.entitlement_id,
            teacherId: row.teacher_id,
            studentId: row.student_id,
            courseBookId: row.course_book_id,
            fullName: row.full_name,
            phone: row.phone,
            altPhone: row.alt_phone,
            addressLine: row.address_line,
            district: row.district,
            area: row.area,
            postalCode: row.postal_code,
            note: row.note,
            status: row.status,
            trackingNumber: row.tracking_number,
            teacherNote: row.teacher_note,
            cancelledReason: row.cancelled_reason,
            addressLockedAt: row.address_locked_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            bookTitle: row.book_title,
            courseTitle: row.course_title,
            studentEmail: row.student_email,
            studentName: row.student_name,
            paid: row.source === 'purchase',
            gifted: row.source === 'gift',
            source: row.source,
        };
    }

    async getForStudent(orderId, studentId) {
        const result = await db.query(
            `SELECT bco.*, cb.title AS book_title, c.title AS course_title, be.source
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN courses c ON c.id = cb.course_id
             JOIN book_entitlements be ON be.id = bco.entitlement_id
             WHERE bco.id = $1 AND bco.student_id = $2`,
            [orderId, studentId]
        );
        return this.mapOrder(result.rows[0]);
    }

    async getByBookForStudent(bookId, studentId) {
        const result = await db.query(
            `SELECT bco.*, cb.title AS book_title, c.title AS course_title, be.source
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN courses c ON c.id = cb.course_id
             JOIN book_entitlements be ON be.id = bco.entitlement_id
             WHERE bco.course_book_id = $1 AND bco.student_id = $2`,
            [bookId, studentId]
        );
        return this.mapOrder(result.rows[0]);
    }

    async upsertAddress(bookId, studentId, address) {
        const orderRes = await db.query(
            `SELECT * FROM book_courier_orders
             WHERE course_book_id = $1 AND student_id = $2`,
            [bookId, studentId]
        );
        const order = orderRes.rows[0];
        if (!order) {
            const err = new Error('Courier order not found');
            err.status = 404;
            throw err;
        }
        if (LOCKED_STATUSES.has(order.status) || order.address_locked_at) {
            const err = new Error('Address can no longer be edited');
            err.status = 409;
            throw err;
        }

        const {
            fullName,
            phone,
            altPhone = null,
            addressLine,
            district = null,
            area = null,
            postalCode = null,
            note = null,
        } = address;

        if (!fullName || !phone || !addressLine) {
            const err = new Error('fullName, phone, and addressLine are required');
            err.status = 400;
            throw err;
        }

        const result = await db.query(
            `UPDATE book_courier_orders SET
                full_name = $1,
                phone = $2,
                alt_phone = $3,
                address_line = $4,
                district = $5,
                area = $6,
                postal_code = $7,
                note = $8,
                status = CASE WHEN status = 'pending_address' THEN 'submitted' ELSE status END,
                updated_at = NOW()
             WHERE id = $9
             RETURNING *`,
            [
                String(fullName).trim(),
                String(phone).trim(),
                altPhone,
                String(addressLine).trim(),
                district,
                area,
                postalCode,
                note,
                order.id,
            ]
        );
        return this.mapOrder(result.rows[0]);
    }

    async listForTeacher(teacherId, options = {}) {
        const { status = null, search = null, skip = 0, limit = 50 } = options;
        const conditions = ['bco.teacher_id = $1'];
        const params = [teacherId];
        let i = 2;
        if (status) {
            conditions.push(`bco.status = $${i++}`);
            params.push(status);
        }
        if (search) {
            conditions.push(
                `(bco.full_name ILIKE $${i} OR bco.phone ILIKE $${i} OR u.email ILIKE $${i} OR cb.title ILIKE $${i})`
            );
            params.push(`%${search}%`);
            i++;
        }
        const where = conditions.join(' AND ');
        params.push(limit, skip);
        const result = await db.query(
            `SELECT bco.*, cb.title AS book_title, c.title AS course_title,
                    u.email AS student_email, COALESCE(sp.name, u.email) AS student_name,
                    be.source
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN courses c ON c.id = cb.course_id
             JOIN users u ON u.id = bco.student_id
             LEFT JOIN student_profiles sp ON sp.user_id = u.id
             JOIN book_entitlements be ON be.id = bco.entitlement_id
             WHERE ${where}
             ORDER BY bco.created_at DESC
             LIMIT $${i++} OFFSET $${i}`,
            params
        );
        return result.rows.map((r) => this.mapOrder(r));
    }

    async updateStatus(orderId, teacherId, data) {
        const existing = await db.query(
            `SELECT * FROM book_courier_orders WHERE id = $1 AND teacher_id = $2`,
            [orderId, teacherId]
        );
        if (!existing.rows[0]) {
            const err = new Error('Order not found');
            err.status = 404;
            throw err;
        }

        const { status, trackingNumber, teacherNote, cancelledReason } = data;
        const allowed = [
            'pending_address',
            'submitted',
            'processing',
            'shipped',
            'delivered',
            'cancelled',
        ];
        if (status && !allowed.includes(status)) {
            const err = new Error('Invalid status');
            err.status = 400;
            throw err;
        }

        const lockAddress =
            status && ['processing', 'shipped', 'delivered', 'cancelled'].includes(status);

        const result = await db.query(
            `UPDATE book_courier_orders SET
                status = COALESCE($1, status),
                tracking_number = COALESCE($2, tracking_number),
                teacher_note = COALESCE($3, teacher_note),
                cancelled_reason = COALESCE($4, cancelled_reason),
                address_locked_at = CASE
                    WHEN $5 THEN COALESCE(address_locked_at, NOW())
                    ELSE address_locked_at
                END,
                updated_at = NOW()
             WHERE id = $6
             RETURNING *`,
            [
                status || null,
                trackingNumber !== undefined ? trackingNumber : null,
                teacherNote !== undefined ? teacherNote : null,
                cancelledReason !== undefined ? cancelledReason : null,
                lockAddress,
                orderId,
            ]
        );
        return this.mapOrder(result.rows[0]);
    }

    async adminList(options = {}) {
        const { status = null, search = null, skip = 0, limit = 20 } = options;
        const conditions = [];
        const params = [];
        let i = 1;
        if (status) {
            conditions.push(`bco.status = $${i++}`);
            params.push(status);
        }
        if (search) {
            conditions.push(
                `(bco.full_name ILIKE $${i} OR bco.phone ILIKE $${i} OR u.email ILIKE $${i} OR cb.title ILIKE $${i})`
            );
            params.push(`%${search}%`);
            i++;
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN users u ON u.id = bco.student_id
             ${where}`,
            params
        );
        params.push(limit, skip);
        const listRes = await db.query(
            `SELECT bco.*, cb.title AS book_title, c.title AS course_title,
                    u.email AS student_email, COALESCE(sp.name, u.email) AS student_name,
                    be.source
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN courses c ON c.id = cb.course_id
             JOIN users u ON u.id = bco.student_id
             LEFT JOIN student_profiles sp ON sp.user_id = u.id
             JOIN book_entitlements be ON be.id = bco.entitlement_id
             ${where}
             ORDER BY bco.created_at DESC
             LIMIT $${i++} OFFSET $${i}`,
            params
        );
        return {
            total: countRes.rows[0]?.total || 0,
            items: listRes.rows.map((r) => this.mapOrder(r)),
        };
    }
}

module.exports = new BookCourierService();
