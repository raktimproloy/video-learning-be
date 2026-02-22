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
 * Apply (validate and record) a coupon for a student.
 * Priority: 1) Admin coupons 2) Teacher coupons.
 * Filters: active only; for discount type, validates start/end dates.
 * One-time use per student per coupon.
 *
 * @param {string} couponCode - The coupon code
 * @param {string} studentId - The student user ID
 * @returns {{ success: true, title: string, message: string, couponType: string, couponId: string, ...discountDetails }}
 * @throws {Error} When coupon invalid or already used
 */
async function applyCoupon(couponCode, studentId) {
    const code = normalizeCode(couponCode);
    if (!code) throw new Error('Coupon code is required');

    const now = new Date();

    // 1. Check admin coupons first
    const adminRes = await db.query(
        `SELECT id, title, coupon_code, type, discount_type, discount_amount, start_at, expire_at
         FROM admin_coupons
         WHERE LOWER(TRIM(coupon_code)) = LOWER($1) AND status = 'active'`,
        [code]
    );

    if (adminRes.rows[0]) {
        const row = adminRes.rows[0];
        if (row.type === 'discount' && !isDiscountValidNow(row)) {
            throw new Error('Coupon has expired or is not yet valid');
        }
        // Check if student already used this admin coupon
        const used = await db.query(
            `SELECT 1 FROM student_coupon_usage
             WHERE student_id = $1 AND coupon_type = 'admin' AND coupon_id = $2`,
            [studentId, row.id]
        );
        if (used.rows[0]) {
            throw new Error('This coupon has already been used with your account');
        }
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

    // 2. Check teacher coupons (active only; original first, then discount with date filter)
    const teacherRes = await db.query(
        `SELECT id, title, coupon_code, type, discount_type, discount_amount, start_at, expire_at
         FROM teacher_coupons
         WHERE LOWER(TRIM(coupon_code)) = LOWER($1) AND status = 'active'`,
        [code]
    );

    if (teacherRes.rows[0]) {
        const row = teacherRes.rows[0];
        if (row.type === 'discount' && !isDiscountValidNow(row)) {
            throw new Error('Coupon has expired or is not yet valid');
        }
        const used = await db.query(
            `SELECT 1 FROM student_coupon_usage
             WHERE student_id = $1 AND coupon_type = 'teacher' AND coupon_id = $2`,
            [studentId, row.id]
        );
        if (used.rows[0]) {
            throw new Error('This coupon has already been used with your account');
        }
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
 * Returns same shape as applyCoupon but does NOT insert into student_coupon_usage.
 */
async function validateCoupon(couponCode, studentId) {
    const code = normalizeCode(couponCode);
    if (!code) throw new Error('Coupon code is required');

    const now = new Date();

    const adminRes = await db.query(
        `SELECT id, title, coupon_code, type, discount_type, discount_amount, start_at, expire_at
         FROM admin_coupons
         WHERE LOWER(TRIM(coupon_code)) = LOWER($1) AND status = 'active'`,
        [code]
    );
    if (adminRes.rows[0]) {
        const row = adminRes.rows[0];
        if (row.type === 'discount' && !isDiscountValidNow(row)) {
            throw new Error('Coupon has expired or is not yet valid');
        }
        const used = await db.query(
            `SELECT 1 FROM student_coupon_usage
             WHERE student_id = $1 AND coupon_type = 'admin' AND coupon_id = $2`,
            [studentId, row.id]
        );
        if (used.rows[0]) throw new Error('This coupon has already been used with your account');
        const discountLabel = row.type === 'original' ? '100% (Original)' : row.discount_type === 'percentage' ? `${row.discount_amount}% off` : `$${row.discount_amount} off`;
        return { success: true, title: row.title, message: `Coupon applied. You get ${discountLabel}.`, couponType: 'admin', couponId: row.id, type: row.type, discountType: row.discount_type, discountAmount: row.discount_amount != null ? parseFloat(row.discount_amount) : null };
    }

    const teacherRes = await db.query(
        `SELECT id, title, coupon_code, type, discount_type, discount_amount, start_at, expire_at
         FROM teacher_coupons
         WHERE LOWER(TRIM(coupon_code)) = LOWER($1) AND status = 'active'`,
        [code]
    );
    if (teacherRes.rows[0]) {
        const row = teacherRes.rows[0];
        if (row.type === 'discount' && !isDiscountValidNow(row)) {
            throw new Error('Coupon has expired or is not yet valid');
        }
        const used = await db.query(
            `SELECT 1 FROM student_coupon_usage
             WHERE student_id = $1 AND coupon_type = 'teacher' AND coupon_id = $2`,
            [studentId, row.id]
        );
        if (used.rows[0]) throw new Error('This coupon has already been used with your account');
        const discountLabel = row.type === 'original' ? '100% (Original)' : row.discount_type === 'percentage' ? `${row.discount_amount}% off` : `$${row.discount_amount} off`;
        return { success: true, title: row.title, message: `Coupon applied. You get ${discountLabel}.`, couponType: 'teacher', couponId: row.id, type: row.type, discountType: row.discount_type, discountAmount: row.discount_amount != null ? parseFloat(row.discount_amount) : null };
    }

    throw new Error('Invalid or inactive coupon');
}

module.exports = { applyCoupon, validateCoupon };
