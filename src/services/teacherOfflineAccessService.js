const crypto = require('crypto');
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
                   (SELECT COUNT(*) FROM teacher_offline_student_accesses sa WHERE sa.purchase_id = p.id) as assigned_count,
                   (SELECT COUNT(*) FROM teacher_offline_access_invites i WHERE i.purchase_id = p.id AND i.status = 'active') as active_invite_count,
                   (SELECT COUNT(*) FROM teacher_offline_access_invites i WHERE i.purchase_id = p.id AND i.status = 'claimed') as claimed_invite_count
            FROM teacher_offline_access_purchases p
            JOIN courses c ON c.id = p.course_id
            WHERE p.teacher_id = $1
            ORDER BY p.created_at DESC
        `, [teacherId]);

        return result.rows.map(row => {
            const assigned = parseInt(row.assigned_count) || 0;
            const activeInvites = parseInt(row.active_invite_count) || 0;
            const claimedInvites = parseInt(row.claimed_invite_count) || 0;
            // assigned_count already includes claimed invites (a tracking row is created on claim).
            // An unclaimed ("active") link reserves a slot until it is claimed or revoked.
            return {
                ...row,
                assigned_count: assigned,
                active_invite_count: activeInvites,
                claimed_invite_count: claimedInvites,
                remaining_count: Math.max(0, parseInt(row.student_count) - assigned - activeInvites)
            };
        });
    }

    /** Slots still available on a purchase = paid slots − students already given access − unclaimed links. */
    async getPurchaseCapacity(purchaseId) {
        const res = await db.query(`
            SELECT p.student_count,
                   (SELECT COUNT(*) FROM teacher_offline_student_accesses sa WHERE sa.purchase_id = p.id) as assigned_count,
                   (SELECT COUNT(*) FROM teacher_offline_access_invites i WHERE i.purchase_id = p.id AND i.status = 'active') as active_invite_count
            FROM teacher_offline_access_purchases p
            WHERE p.id = $1
        `, [purchaseId]);
        if (!res.rows[0]) return null;
        const studentCount = parseInt(res.rows[0].student_count) || 0;
        const assigned = parseInt(res.rows[0].assigned_count) || 0;
        const activeInvites = parseInt(res.rows[0].active_invite_count) || 0;
        return {
            studentCount,
            used: assigned + activeInvites,
            remaining: Math.max(0, studentCount - assigned - activeInvites)
        };
    }

    async generateInvite(purchaseId, teacherId, createdBy) {
        const purchaseQuery = await db.query(`
            SELECT * FROM teacher_offline_access_purchases
            WHERE id = $1 AND teacher_id = $2 AND status = 'accepted' AND is_active = true
        `, [purchaseId, teacherId]);
        if (!purchaseQuery.rows[0]) throw new Error('Valid, active and accepted purchase not found.');
        const purchase = purchaseQuery.rows[0];

        const capacity = await this.getPurchaseCapacity(purchaseId);
        if (!capacity || capacity.remaining <= 0) {
            throw new Error('No remaining slots on this purchase. Revoke an unused link or buy more access.');
        }

        // Unique, URL-safe token. Retry on the (astronomically unlikely) collision.
        let invite = null;
        for (let attempt = 0; attempt < 5 && !invite; attempt++) {
            const token = crypto.randomBytes(12).toString('hex'); // 24 chars
            try {
                const ins = await db.query(
                    `INSERT INTO teacher_offline_access_invites
                        (purchase_id, teacher_id, course_id, token, created_by)
                     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                    [purchaseId, teacherId, purchase.course_id, token, createdBy || teacherId]
                );
                invite = ins.rows[0];
            } catch (err) {
                if (err.code === '23505') continue; // unique_violation on token
                throw err;
            }
        }
        if (!invite) throw new Error('Could not generate a unique invite link. Please try again.');
        return invite;
    }

    async listInvitesByTeacher(teacherId, purchaseId = null) {
        const params = [teacherId];
        let where = 'i.teacher_id = $1';
        if (purchaseId) {
            params.push(purchaseId);
            where += ` AND i.purchase_id = $${params.length}`;
        }
        const result = await db.query(`
            SELECT i.id, i.purchase_id, i.course_id, i.token, i.status,
                   i.claimed_at, i.created_at,
                   c.title as course_title,
                   u.name as claimed_by_name, u.email as claimed_by_email
            FROM teacher_offline_access_invites i
            JOIN courses c ON c.id = i.course_id
            LEFT JOIN users u ON u.id = i.claimed_by
            WHERE ${where}
            ORDER BY i.created_at DESC
        `, params);
        return result.rows;
    }

    async revokeInvite(inviteId, teacherId) {
        const result = await db.query(`
            UPDATE teacher_offline_access_invites
            SET status = 'revoked', updated_at = NOW()
            WHERE id = $1 AND teacher_id = $2 AND status = 'active'
            RETURNING *
        `, [inviteId, teacherId]);
        if (!result.rows[0]) {
            throw new Error('Invite not found, already claimed, or already revoked.');
        }
        return result.rows[0];
    }

    /** Public: invite + course summary for the claim landing page. `viewerId` is optional. */
    async getInviteByToken(token, viewerId = null) {
        if (!token || typeof token !== 'string') return null;
        const result = await db.query(`
            SELECT i.id, i.token, i.status, i.claimed_by, i.claimed_at, i.course_id, i.teacher_id,
                   p.status as purchase_status, p.is_active as purchase_is_active,
                   c.title, c.short_description, c.full_description, c.level, c.language,
                   c.price, c.discount_price, c.currency, c.status as course_status,
                   c.thumbnail_path, c.external_thumbnail_url,
                   c.intro_video_path,
                   COALESCE(tp.name, u.email) as teacher_name,
                   u.email as teacher_email,
                   tp.bio as teacher_bio,
                   tp.institute_name as teacher_institute_name,
                   tp.profile_image_path as teacher_profile_image_path,
                   COALESCE(tp.is_verified, false) as teacher_is_verified,
                   (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) as lesson_count,
                   (SELECT COUNT(*) FROM courses c2
                     WHERE c2.teacher_id = i.teacher_id AND COALESCE(c2.status, 'active') = 'active') as teacher_course_count,
                   (SELECT COUNT(DISTINCT ce.user_id) FROM course_enrollments ce
                     JOIN courses c3 ON c3.id = ce.course_id WHERE c3.teacher_id = i.teacher_id) as teacher_student_count,
                   (SELECT COALESCE(AVG(tr.rating), 0) FROM teacher_reviews tr WHERE tr.teacher_id = i.teacher_id) as teacher_rating
            FROM teacher_offline_access_invites i
            JOIN teacher_offline_access_purchases p ON p.id = i.purchase_id
            JOIN courses c ON c.id = i.course_id
            LEFT JOIN users u ON u.id = i.teacher_id
            LEFT JOIN teacher_profiles tp ON tp.user_id = i.teacher_id
            WHERE i.token = $1
        `, [String(token).trim()]);
        if (!result.rows[0]) return null;
        const row = result.rows[0];
        const claimedByMe = !!viewerId && String(row.claimed_by || '') === String(viewerId);
        const available =
            row.status === 'active' &&
            row.purchase_status === 'accepted' &&
            row.purchase_is_active === true &&
            (row.course_status === null || row.course_status === 'active');
        return { ...row, claimed_by_me: claimedByMe, available };
    }

    async claimInvite(token, userId) {
        const info = await this.getInviteByToken(token, userId);
        if (!info) {
            const e = new Error('This invite link is not valid.');
            e.code = 'INVALID';
            throw e;
        }
        if (info.status === 'revoked') {
            const e = new Error('This invite link has been cancelled by the teacher.');
            e.code = 'REVOKED';
            throw e;
        }
        if (info.status === 'claimed') {
            const e = new Error(
                info.claimed_by_me
                    ? 'You have already claimed this course with this link.'
                    : 'This invite link has already been claimed by someone else.'
            );
            e.code = info.claimed_by_me ? 'ALREADY_CLAIMED_BY_ME' : 'ALREADY_CLAIMED';
            e.courseId = info.course_id;
            throw e;
        }
        if (info.purchase_status !== 'accepted' || info.purchase_is_active !== true) {
            const e = new Error('This invite is not currently available. Please contact your teacher.');
            e.code = 'UNAVAILABLE';
            throw e;
        }
        if (info.course_status && info.course_status !== 'active') {
            const e = new Error('This course is not currently available.');
            e.code = 'COURSE_INACTIVE';
            throw e;
        }

        const alreadyEnrolled = await courseService.isEnrolled(userId, info.course_id);
        if (alreadyEnrolled) {
            const e = new Error('You already have access to this course.');
            e.code = 'ALREADY_ENROLLED';
            e.courseId = info.course_id;
            throw e;
        }

        // Atomically consume the link. If another request won the race, rowCount is 0.
        const claim = await db.query(`
            UPDATE teacher_offline_access_invites
            SET status = 'claimed', claimed_by = $1, claimed_at = NOW(), updated_at = NOW()
            WHERE id = $2 AND status = 'active'
            RETURNING *
        `, [userId, info.id]);
        if (!claim.rows[0]) {
            const e = new Error('This invite link has already been claimed.');
            e.code = 'ALREADY_CLAIMED';
            e.courseId = info.course_id;
            throw e;
        }
        const invite = claim.rows[0];

        const userRow = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
        const studentEmail = userRow.rows[0]?.email || null;

        // Record per-student access (keeps teacher + admin views consistent with email assignments).
        await db.query(
            `INSERT INTO teacher_offline_student_accesses
                (purchase_id, teacher_id, course_id, student_email, student_user_id, invite_id, source)
             VALUES ($1, $2, $3, $4, $5, $6, 'invite')`,
            [invite.purchase_id, invite.teacher_id, invite.course_id, studentEmail, userId, invite.id]
        );

        // Free enrolment — mirrors assignStudentAccess (amount_paid = 0, is_invited = false).
        await db.query(
            `INSERT INTO course_enrollments (user_id, course_id, is_invited, amount_paid, currency, is_active)
             VALUES ($1, $2, false, 0, 'BDT', true)
             ON CONFLICT (user_id, course_id) DO UPDATE SET is_active = true`,
            [userId, invite.course_id]
        );

        return { success: true, courseId: invite.course_id };
    }

    async assignStudentAccess(purchaseId, studentEmail, teacherId) {
        // 1. Verify purchase and capacity
        const purchaseQuery = await db.query(`
            SELECT * FROM teacher_offline_access_purchases 
            WHERE id = $1 AND teacher_id = $2 AND status = 'accepted' AND is_active = true
        `, [purchaseId, teacherId]);
        
        if (!purchaseQuery.rows[0]) throw new Error('Valid, active and accepted purchase not found.');
        const purchase = purchaseQuery.rows[0];

        // Unclaimed invite links also reserve a slot, so count them against capacity too.
        const capacity = await this.getPurchaseCapacity(purchaseId);
        if (capacity && capacity.remaining <= 0) {
            throw new Error('All slots for this purchase have been used (assigned students + active invite links).');
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
