const db = require('../../db');
const smsService = require('../utils/smsService');

class AdminOfflineAccessService {
    async listAllPurchases(options = {}) {
        const { skip = 0, limit = 20, status, search } = options;
        let whereClause = '1=1';
        const params = [];
        let paramIndex = 1;

        if (status && status !== 'all') {
            whereClause += ` AND p.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }

        if (search) {
            whereClause += ` AND (
                p.transaction_id ILIKE $${paramIndex} OR
                p.sender_phone ILIKE $${paramIndex} OR
                c.title ILIKE $${paramIndex} OR
                u.email ILIKE $${paramIndex}
            )`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        params.push(limit, skip);

        const result = await db.query(`
            SELECT p.*, c.title as course_title, u.email as teacher_email, u.name as teacher_name,
                   c.price as base_price,
                   c.discount_price as current_discount_price,
                   (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id) as total_course_students,
                   (SELECT COUNT(*) FROM teacher_offline_student_accesses sa WHERE sa.purchase_id = p.id) as assigned_count,
                   (SELECT COUNT(*) FROM teacher_offline_access_invites i WHERE i.purchase_id = p.id AND i.status = 'active') as active_invite_count,
                   (SELECT COUNT(*) FROM teacher_offline_access_invites i WHERE i.purchase_id = p.id AND i.status = 'claimed') as claimed_invite_count
            FROM teacher_offline_access_purchases p
            JOIN courses c ON c.id = p.course_id
            JOIN users u ON u.id = p.teacher_id
            WHERE ${whereClause}
            ORDER BY p.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, params);

        const countQuery = await db.query(`
            SELECT COUNT(*) FROM teacher_offline_access_purchases p
            JOIN courses c ON c.id = p.course_id
            JOIN users u ON u.id = p.teacher_id
            WHERE ${whereClause}
        `, params.slice(0, params.length - 2));

        return {
            purchases: result.rows.map(row => ({
                ...row,
                assigned_count: parseInt(row.assigned_count) || 0
            })),
            total: parseInt(countQuery.rows[0].count) || 0
        };
    }

    /**
     * Admin directly grants a teacher N offline-access slots for a course — no payment.
     * Creates an already-accepted, active purchase row that the teacher can then
     * distribute via email assignment or invite links, exactly like a paid purchase.
     */
    async grantAccess(adminId, { teacherId, courseId, studentCount }) {
        const count = parseInt(studentCount, 10);
        if (!teacherId || !courseId) throw new Error('teacherId and courseId are required.');
        if (Number.isNaN(count) || count <= 0) throw new Error('Student count must be a positive number.');
        if (count > 100000) throw new Error('Student count is too large.');

        const teacher = await db.query(
            `SELECT u.id FROM users u
             LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
             WHERE u.id = $1 AND (u.role = 'teacher' OR tp.user_id IS NOT NULL)`,
            [teacherId]
        );
        if (!teacher.rows[0]) throw new Error('Teacher not found.');

        const course = await db.query('SELECT id, price, discount_price FROM courses WHERE id = $1', [courseId]);
        if (!course.rows[0]) throw new Error('Course not found.');
        const priceAtTime =
            parseFloat(course.rows[0].discount_price ?? course.rows[0].price ?? 0) || 0;

        const result = await db.query(
            `INSERT INTO teacher_offline_access_purchases (
                teacher_id, course_id, student_count, course_price_at_time,
                fee_per_student, total_amount, currency, payment_method,
                status, is_active, reviewed_by, reviewed_at
            ) VALUES ($1, $2, $3, $4, 0, 0, 'BDT', 'admin_grant', 'accepted', true, $5, NOW())
            RETURNING *`,
            [teacherId, courseId, count, priceAtTime, adminId]
        );
        return result.rows[0];
    }

    async acceptPurchase(purchaseId, adminId) {
        const result = await db.query(`
            UPDATE teacher_offline_access_purchases 
            SET status = 'accepted', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
            WHERE id = $2 AND status = 'pending'
            RETURNING *
        `, [adminId, purchaseId]);
        
        if (!result.rows[0]) throw new Error('Purchase not found or already processed.');
        return result.rows[0];
    }

    async rejectPurchase(purchaseId, adminId, reason) {
        const result = await db.query(`
            UPDATE teacher_offline_access_purchases 
            SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
            WHERE id = $3 AND status = 'pending'
            RETURNING *
        `, [reason, adminId, purchaseId]);
        
        if (!result.rows[0]) throw new Error('Purchase not found or already processed.');
        return result.rows[0];
    }

    async toggleActiveStatus(purchaseId, adminId, isActive) {
        // 1. Update purchase status
        const result = await db.query(`
            UPDATE teacher_offline_access_purchases 
            SET is_active = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING course_id
        `, [isActive, purchaseId]);
        
        if (!result.rows[0]) throw new Error('Purchase not found.');
        const courseId = result.rows[0].course_id;

        // 2. Update tracking table
        await db.query(`
            UPDATE teacher_offline_student_accesses
            SET is_active = $1
            WHERE purchase_id = $2
        `, [isActive, purchaseId]);

        // 3. Update course_enrollments for affected students
        // We find all student_user_id associated with this purchase_id and update their course_enrollments
        await db.query(`
            UPDATE course_enrollments
            SET is_active = $1
            WHERE course_id = $2 AND user_id IN (
                SELECT student_user_id 
                FROM teacher_offline_student_accesses 
                WHERE purchase_id = $3 AND student_user_id IS NOT NULL
            )
        `, [isActive, courseId, purchaseId]);

        return { success: true, isActive };
    }

    async updateStudentLimit(purchaseId, newLimit) {
        const parsedLimit = parseInt(newLimit, 10);
        if (isNaN(parsedLimit) || parsedLimit <= 0) {
            throw new Error("Invalid student limit");
        }

        const assignedQuery = await db.query(
            `SELECT COUNT(*) FROM teacher_offline_student_accesses WHERE purchase_id = $1`,
            [purchaseId]
        );
        const assignedCount = parseInt(assignedQuery.rows[0].count) || 0;

        if (parsedLimit < assignedCount) {
            throw new Error(`Cannot set limit below currently assigned students (${assignedCount})`);
        }

        const result = await db.query(`
            UPDATE teacher_offline_access_purchases 
            SET student_count = $1, updated_at = NOW() 
            WHERE id = $2 
            RETURNING *
        `, [parsedLimit, purchaseId]);

        if (!result.rows[0]) throw new Error('Purchase not found');
        return result.rows[0];
    }

    async listAssignedStudents(purchaseId) {
        const result = await db.query(`
            SELECT sa.id, sa.assigned_at, sa.source, u.name, u.email
            FROM teacher_offline_student_accesses sa
            JOIN users u ON u.id = sa.student_user_id
            WHERE sa.purchase_id = $1
            ORDER BY sa.assigned_at DESC
        `, [purchaseId]);
        
        return result.rows;
    }
}

module.exports = new AdminOfflineAccessService();
