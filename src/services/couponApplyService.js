const db = require('../../db');

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
}

/**
 * Check if a discount-type coupon is valid for the current time.
 * - start_at: must be null or <= NOW()
 * - expire_at: must be null or >= NOW()
 */
function isDiscountValidNow(row) {
    const now = new Date();
    if (row.start_at && new Date(row.start_at) > now) return false;
    if (row.expire_at && new Date(row.expire_at) < now) return false;
    return true;
}

/**
 * Check usage limits: per-user count and total count.
 * @param {string} couponType - 'admin' | 'teacher'
 * @param {string} couponId - coupon UUID
 * @param {string} studentId - student user ID
 * @param {number} maxUsesPerUser - max uses allowed per user (>= 1)
 * @param {number|null} maxTotalUses - max total uses (null = unlimited)
 */
async function checkUsageLimits(couponType, couponId, studentId, maxUsesPerUser, maxTotalUses) {
    const perUserRes = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM student_coupon_usage
         WHERE student_id = $1 AND coupon_type = $2 AND coupon_id = $3`,
        [studentId, couponType, couponId]
    );
    const perUserCount = perUserRes.rows[0]?.cnt || 0;
    if (perUserCount >= maxUsesPerUser) {
        throw new Error('This coupon has already been used the maximum times with your account');
    }

    if (maxTotalUses != null) {
        const totalRes = await db.query(
            `SELECT COUNT(*)::int AS cnt FROM student_coupon_usage
             WHERE coupon_type = $1 AND coupon_id = $2`,
            [couponType, couponId]
        );
        const totalCount = totalRes.rows[0]?.cnt || 0;
        if (totalCount >= maxTotalUses) {
            throw new Error('This coupon has reached its maximum number of uses');
        }
    }
}

/**
 * Apply (validate and record) a coupon for a student.
 * - Admin coupon: applies to every course (courseId optional).
 * - Teacher coupon: applies only to that teacher's course; courseId required.
 * Usage limits: max_uses_per_user (default 1), max_total_uses (null = unlimited).
 *
 * @param {string} couponCode - The coupon code
 * @param {string} studentId - The student user ID
 * @param {string|null} [courseId] - Required for teacher coupons (validates coupon is for this course's teacher)
 * @returns {{ success: true, title: string, message: string, couponType: string, couponId: string, ... }}
 */
async function applyCoupon(couponCode, studentId, courseId = null) {
    const code = normalizeCode(couponCode);
    if (!code) throw new Error('Coupon code is required');

    const now = new Date();

    // 1. Check admin coupons first (apply on every course; no courseId check)
    const adminRes = await db.query(
        `SELECT id, title, coupon_code, type, discount_type, discount_amount, start_at, expire_at,
                COALESCE(max_uses_per_user, 1) AS max_uses_per_user, max_total_uses
         FROM admin_coupons
         WHERE LOWER(TRIM(coupon_code)) = LOWER($1) AND status = 'active'`,
        [code]
    );

    if (adminRes.rows[0]) {
        const row = adminRes.rows[0];
        if (row.type === 'discount' && !isDiscountValidNow(row)) {
            throw new Error('Coupon has expired or is not yet valid');
        }
        const maxPerUser = Math.max(1, parseInt(row.max_uses_per_user, 10) || 1);
        await checkUsageLimits('admin', row.id, studentId, maxPerUser, row.max_total_uses);

        await db.query(
            `INSERT INTO student_coupon_usage (student_id, coupon_type, coupon_id)
             VALUES ($1, 'admin', $2)`,
            [studentId, row.id]
        );
        const discountLabel = row.type === 'original'
            ? '100% (Original)'
            : row.discount_type === 'percentage'
                ? `${row.discount_amount}% off`
                : `$${row.discount_amount} off`;
        return {
            success: true,
            title: row.title,
            message: `Coupon "${row.title}" applied successfully. You get ${discountLabel}.`,
            couponType: 'admin',
            couponId: row.id,
            type: row.type,
            discountType: row.discount_type,
            discountAmount: row.discount_amount != null ? parseFloat(row.discount_amount) : null,
        };
    }

    // 2. Teacher coupons: only valid for that teacher's course (courseId required)
    const teacherRes = await db.query(
        `SELECT tc.id, tc.teacher_id, tc.title, tc.coupon_code, tc.type, tc.discount_type, tc.discount_amount,
                tc.start_at, tc.expire_at,
                COALESCE(tc.max_uses_per_user, 1) AS max_uses_per_user, tc.max_total_uses
         FROM teacher_coupons tc
         WHERE LOWER(TRIM(tc.coupon_code)) = LOWER($1) AND tc.status = 'active'`,
        [code]
    );

    if (teacherRes.rows[0]) {
        const row = teacherRes.rows[0];
        // Teacher coupon applies only to this teacher's course
        if (courseId) {
            const courseRow = await db.query(
                `SELECT teacher_id FROM courses WHERE id = $1`,
                [courseId]
            );
            if (!courseRow.rows[0] || courseRow.rows[0].teacher_id !== row.teacher_id) {
                throw new Error('This coupon is not valid for the selected course');
            }
        } else {
            // No courseId provided (e.g. validate before course selected) – reject teacher coupon at apply time
            throw new Error('This coupon is valid only for specific courses; please use it on the course page');
        }

        if (row.type === 'discount' && !isDiscountValidNow(row)) {
            throw new Error('Coupon has expired or is not yet valid');
        }
        const maxPerUser = Math.max(1, parseInt(row.max_uses_per_user, 10) || 1);
        await checkUsageLimits('teacher', row.id, studentId, maxPerUser, row.max_total_uses);

        await db.query(
            `INSERT INTO student_coupon_usage (student_id, coupon_type, coupon_id)
             VALUES ($1, 'teacher', $2)`,
            [studentId, row.id]
        );
        const discountLabel = row.type === 'original'
            ? '100% (Original)'
            : row.discount_type === 'percentage'
                ? `${row.discount_amount}% off`
                : `$${row.discount_amount} off`;
        return {
            success: true,
            title: row.title,
            message: `Coupon "${row.title}" applied successfully. You get ${discountLabel}.`,
            couponType: 'teacher',
            couponId: row.id,
            type: row.type,
            discountType: row.discount_type,
            discountAmount: row.discount_amount != null ? parseFloat(row.discount_amount) : null,
        };
    }

    throw new Error('Invalid or inactive coupon');
}

/**
 * Validate coupon without consuming (for checkout preview).
 * courseId required for teacher coupons so we can check they apply to the selected course.
 * Returns same shape as applyCoupon but does NOT insert into student_coupon_usage.
 */
async function validateCoupon(couponCode, studentId, courseId = null) {
    const code = normalizeCode(couponCode);
    if (!code) throw new Error('Coupon code is required');

    const now = new Date();

    const adminRes = await db.query(
        `SELECT id, title, coupon_code, type, discount_type, discount_amount, start_at, expire_at,
                COALESCE(max_uses_per_user, 1) AS max_uses_per_user, max_total_uses
         FROM admin_coupons
         WHERE LOWER(TRIM(coupon_code)) = LOWER($1) AND status = 'active'`,
        [code]
    );
    if (adminRes.rows[0]) {
        const row = adminRes.rows[0];
        if (row.type === 'discount' && !isDiscountValidNow(row)) {
            throw new Error('Coupon has expired or is not yet valid');
        }
        const maxPerUser = Math.max(1, parseInt(row.max_uses_per_user, 10) || 1);
        await checkUsageLimits('admin', row.id, studentId, maxPerUser, row.max_total_uses);
        const discountLabel = row.type === 'original' ? '100% (Original)' : row.discount_type === 'percentage' ? `${row.discount_amount}% off` : `$${row.discount_amount} off`;
        return { success: true, title: row.title, message: `Coupon applied. You get ${discountLabel}.`, couponType: 'admin', couponId: row.id, type: row.type, discountType: row.discount_type, discountAmount: row.discount_amount != null ? parseFloat(row.discount_amount) : null };
    }

    const teacherRes = await db.query(
        `SELECT tc.id, tc.teacher_id, tc.title, tc.coupon_code, tc.type, tc.discount_type, tc.discount_amount,
                tc.start_at, tc.expire_at,
                COALESCE(tc.max_uses_per_user, 1) AS max_uses_per_user, tc.max_total_uses
         FROM teacher_coupons tc
         WHERE LOWER(TRIM(tc.coupon_code)) = LOWER($1) AND tc.status = 'active'`,
        [code]
    );
    if (teacherRes.rows[0]) {
        const row = teacherRes.rows[0];
        if (!courseId) {
            throw new Error('This coupon is valid only for specific courses; add a course to your cart and try again');
        }
        const courseRow = await db.query(`SELECT teacher_id FROM courses WHERE id = $1`, [courseId]);
        if (!courseRow.rows[0] || courseRow.rows[0].teacher_id !== row.teacher_id) {
            throw new Error('This coupon is not valid for the selected course');
        }
        if (row.type === 'discount' && !isDiscountValidNow(row)) {
            throw new Error('Coupon has expired or is not yet valid');
        }
        const maxPerUser = Math.max(1, parseInt(row.max_uses_per_user, 10) || 1);
        await checkUsageLimits('teacher', row.id, studentId, maxPerUser, row.max_total_uses);
        const discountLabel = row.type === 'original' ? '100% (Original)' : row.discount_type === 'percentage' ? `${row.discount_amount}% off` : `$${row.discount_amount} off`;
        return { success: true, title: row.title, message: `Coupon applied. You get ${discountLabel}.`, couponType: 'teacher', couponId: row.id, type: row.type, discountType: row.discount_type, discountAmount: row.discount_amount != null ? parseFloat(row.discount_amount) : null };
    }

    throw new Error('Invalid or inactive coupon');
}

module.exports = { applyCoupon, validateCoupon };
