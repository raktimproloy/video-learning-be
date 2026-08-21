const db = require('../../db');
const smsService = require('../utils/smsService');
const courseService = require('./courseService');
const ADMIN_NEW_PAYMENT_ALERT_PHONE = process.env.ADMIN_NEW_PAYMENT_ALERT_PHONE || '01303644935';

class TeacherOfflineAccessService {
    async calculateFee(courseId, studentCount) {
        const course = await db.query('SELECT price, discount_price FROM courses WHERE id = $1', [courseId]);
        if (!course.rows[0]) throw new Error('Course not found');
        
        const price = parseFloat(course.rows[0].price || 0);
        // Fee is max of 10% of price or 50 BDT
        const percentageFee = price * 0.10;
        const feePerStudent = Math.max(percentageFee, 50);
        
        return {
            priceAtTime: price,
            feePerStudent,
            totalAmount: feePerStudent * studentCount
        };
    }

    async createPurchaseRequest(teacherId, data) {
        const { courseId, studentCount, paymentMethod, senderPhone, transactionId } = data;
        
        const feeData = await this.calculateFee(courseId, studentCount);

        const result = await db.query(
            `INSERT INTO teacher_offline_access_purchases (
                teacher_id, course_id, student_count, course_price_at_time, 
                fee_per_student, total_amount, payment_method, sender_phone, transaction_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [
                teacherId, courseId, studentCount, feeData.priceAtTime, 
                feeData.feePerStudent, feeData.totalAmount, paymentMethod, 
                senderPhone, transactionId
            ]
        );

        const purchase = result.rows[0];

        // SMS notification moved to acceptUddoktaPayPurchase
        return purchase;
    }

    async acceptUddoktaPayPurchase(purchaseId, transactionId, senderPhone) {
        const result = await db.query(
            `UPDATE teacher_offline_access_purchases 
             SET status = 'accepted', transaction_id = $1, sender_phone = $2 
             WHERE id = $3 AND status = 'pending' 
             RETURNING *`,
            [transactionId, senderPhone, purchaseId]
        );

        const purchase = result.rows[0];
        if (!purchase) {
            throw new Error('Purchase not found or already processed.');
        }

        // Send SMS to admin on successful automated payment
        if (ADMIN_NEW_PAYMENT_ALERT_PHONE) {
            smsService.sendNewPaymentRequestAlertSms(ADMIN_NEW_PAYMENT_ALERT_PHONE, {
                requestId: purchase.id,
                courseId: purchase.course_id,
                amount: purchase.total_amount,
                currency: 'BDT',
                method: purchase.payment_method || 'uddoktapay'
            }).catch(err => {
                console.error('Offline Access Automated payment admin SMS failed:', err.message);
            });
        }

        return purchase;
    }

    async listPurchasesByTeacher(teacherId) {
        const result = await db.query(`
            SELECT p.*, c.title as course_title,
                   (SELECT COUNT(*) FROM teacher_offline_student_accesses sa WHERE sa.purchase_id = p.id) as assigned_count
            FROM teacher_offline_access_purchases p
            JOIN courses c ON c.id = p.course_id
            WHERE p.teacher_id = $1
            ORDER BY p.created_at DESC
        `, [teacherId]);
        
        return result.rows.map(row => ({
            ...row,
            assigned_count: parseInt(row.assigned_count) || 0,
            remaining_count: parseInt(row.student_count) - (parseInt(row.assigned_count) || 0)
        }));
    }

    async assignStudentAccess(purchaseId, studentEmail, teacherId) {
        // 1. Verify purchase and capacity
        const purchaseQuery = await db.query(`
            SELECT * FROM teacher_offline_access_purchases 
            WHERE id = $1 AND teacher_id = $2 AND status = 'accepted' AND is_active = true
        `, [purchaseId, teacherId]);
        
        if (!purchaseQuery.rows[0]) throw new Error('Valid, active and accepted purchase not found.');
        const purchase = purchaseQuery.rows[0];

        const assignedQuery = await db.query('SELECT COUNT(*) FROM teacher_offline_student_accesses WHERE purchase_id = $1', [purchaseId]);
        const assignedCount = parseInt(assignedQuery.rows[0].count);

        if (assignedCount >= purchase.student_count) {
            throw new Error('All slots for this purchase have been assigned.');
        }

        // 2. Find student by email
        const studentQuery = await db.query('SELECT id FROM users WHERE email = $1', [studentEmail]);
        if (!studentQuery.rows[0]) {
            throw new Error('Student with this email not found.');
        }
        const studentId = studentQuery.rows[0].id;

        // 3. Check if already enrolled
        const alreadyEnrolled = await courseService.isEnrolled(studentId, purchase.course_id);
        if (alreadyEnrolled) {
            throw new Error('Student is already enrolled in this course.');
        }

        // 4. Record the assignment
        await db.query(
            `INSERT INTO teacher_offline_student_accesses (purchase_id, teacher_id, course_id, student_email, student_user_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [purchaseId, teacherId, purchase.course_id, studentEmail, studentId]
        );

        // 5. Enroll in course (we pass amountPaid=0 so it doesn't inflate platform standard revenue stats unless requested)
        // Wait, courseService.enrollUser does INSERT ON CONFLICT DO UPDATE.
        await db.query(
            `INSERT INTO course_enrollments (user_id, course_id, is_invited, amount_paid, currency, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT (user_id, course_id) DO UPDATE SET is_active = true`,
             [studentId, purchase.course_id, false, 0, 'BDT']
        );

        return { success: true, message: 'Student successfully assigned.' };
    }
}

module.exports = new TeacherOfflineAccessService();
