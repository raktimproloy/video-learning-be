const db = require('../../db');

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
}

const ROW_ID = '00000000-0000-0000-0000-000000000001';

class AdminSettingsService {
    /** Get share percentages (single row) */
    async getShareSettings() {
        const result = await db.query(
            `SELECT * FROM admin_share_settings WHERE id = $1`,
            [ROW_ID]
        );
        const row = result.rows[0];
        if (!row) return null;
        return {
            ourStudentPercent: parseFloat(row.our_student_percent) || 0,
            teacherStudentPercent: parseFloat(row.teacher_student_percent) || 0,
            liveCoursesPercent: parseFloat(row.live_courses_percent) || 0,
        };
    }

    /** Update share percentages. Admin ID saved for audit. */
    async updateShareSettings(adminId, data) {
        const { ourStudentPercent, teacherStudentPercent, liveCoursesPercent } = data;
        const result = await db.query(
            `UPDATE admin_share_settings SET
                our_student_percent = COALESCE($1, our_student_percent),
                teacher_student_percent = COALESCE($2, teacher_student_percent),
                live_courses_percent = COALESCE($3, live_courses_percent),
                updated_by_admin_id = $4,
                updated_at = NOW()
             WHERE id = $5
             RETURNING *`,
            [
                ourStudentPercent != null ? parseFloat(ourStudentPercent) : null,
                teacherStudentPercent != null ? parseFloat(teacherStudentPercent) : null,
                liveCoursesPercent != null ? parseFloat(liveCoursesPercent) : null,
                adminId,
                ROW_ID,
            ]
        );
        const row = result.rows[0];
        return row ? {
            ourStudentPercent: parseFloat(row.our_student_percent) || 0,
            teacherStudentPercent: parseFloat(row.teacher_student_percent) || 0,
            liveCoursesPercent: parseFloat(row.live_courses_percent) || 0,
        } : null;
    }

    /** List admin coupons */
    async listCoupons(options = {}) {
        const { page = 1, limit = 20, status } = options;
        const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(50, Math.max(1, parseInt(limit, 10)));
        const limitVal = Math.min(50, Math.max(1, parseInt(limit, 10)));
        const conditions = [];
        const params = [];
        let idx = 1;
        if (status && ['active', 'inactive'].includes(status)) {
            conditions.push(`status = $${idx++}`);
            params.push(status);
        }
        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const countRes = await db.query(
            `SELECT COUNT(*)::int as total FROM admin_coupons ${whereClause}`,
            params
        );
        const total = countRes.rows[0]?.total || 0;
        params.push(limitVal, offset);
        const listRes = await db.query(
            `SELECT * FROM admin_coupons ${whereClause}
             ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return {
            coupons: listRes.rows.map(this.mapCouponRow),
            total,
            page: Math.max(1, parseInt(page, 10)),
            limit: limitVal,
            totalPages: Math.ceil(total / limitVal) || 1,
        };
    }

    async getCouponById(id) {
        const result = await db.query(`SELECT * FROM admin_coupons WHERE id = $1`, [id]);
        const row = result.rows[0];
        return row ? this.mapCouponRow(row) : null;
    }

    async createCoupon(adminId, data) {
        const { title, couponCode, type, discountType, discountAmount, startAt, expireAt, status = 'active' } = data;
        const code = normalizeCode(couponCode);
        if (!code) throw new Error('Coupon code is required');
        if (!title || !title.trim()) throw new Error('Title is required');
        if (!type || !['original', 'discount'].includes(type)) throw new Error('Type must be original or discount');
        if (type === 'discount') {
            if (!discountType || !['amount', 'percentage'].includes(discountType)) throw new Error('Discount type required');
            const amt = parseFloat(discountAmount);
            if (isNaN(amt) || amt < 0) throw new Error('Invalid discount amount');
            if (discountType === 'percentage' && amt > 100) throw new Error('Percentage cannot exceed 100');
        }
        const dup = await db.query(`SELECT id FROM admin_coupons WHERE LOWER(TRIM(coupon_code)) = LOWER($1)`, [code]);
        if (dup.rows[0]) throw new Error('Coupon code already exists');

        const result = await db.query(
            `INSERT INTO admin_coupons (title, coupon_code, type, discount_type, discount_amount, start_at, expire_at, status, created_by_admin_id, updated_by_admin_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
             RETURNING *`,
            [
                title.trim(),
                code,
                type,
                type === 'discount' ? discountType : null,
                type === 'discount' ? parseFloat(discountAmount) : null,
                type === 'original' ? null : (startAt || null),
                type === 'original' ? null : (expireAt || null),
                ['active', 'inactive'].includes(status) ? status : 'active',
                adminId,
            ]
        );
        return this.mapCouponRow(result.rows[0]);
    }

    async updateCoupon(id, adminId, data) {
        const existing = await this.getCouponById(id);
        if (!existing) return null;

        const { title, couponCode, type, discountType, discountAmount, startAt, expireAt, status } = data;
        const updates = [];
        const values = [];
        let idx = 1;

        if (title !== undefined && title.trim()) {
            updates.push(`title = $${idx++}`);
            values.push(title.trim());
        }
        if (couponCode !== undefined) {
            const code = normalizeCode(couponCode);
            if (!code) throw new Error('Coupon code is required');
            const dup = await db.query(`SELECT id FROM admin_coupons WHERE LOWER(TRIM(coupon_code)) = LOWER($1) AND id != $2`, [code, id]);
            if (dup.rows[0]) throw new Error('Coupon code already exists');
            updates.push(`coupon_code = $${idx++}`);
            values.push(code);
        }
        if (type !== undefined && ['original', 'discount'].includes(type)) {
            updates.push(`type = $${idx++}`);
            values.push(type);
            if (type === 'original') {
                updates.push(`discount_type = NULL, discount_amount = NULL, start_at = NULL, expire_at = NULL`);
            }
        }
        if ((type === 'discount' || existing.type === 'discount') && discountType !== undefined && ['amount', 'percentage'].includes(discountType)) {
            updates.push(`discount_type = $${idx++}`);
            values.push(discountType);
        }
        if ((type === 'discount' || existing.type === 'discount') && discountAmount !== undefined) {
            const amt = parseFloat(discountAmount);
            if (!isNaN(amt) && amt >= 0) {
                updates.push(`discount_amount = $${idx++}`);
                values.push(amt);
            }
        }
        if (startAt !== undefined) {
            updates.push(`start_at = $${idx++}`);
            values.push(startAt || null);
        }
        if (expireAt !== undefined) {
            updates.push(`expire_at = $${idx++}`);
            values.push(expireAt || null);
        }
        if (status !== undefined && ['active', 'inactive'].includes(status)) {
            updates.push(`status = $${idx++}`);
            values.push(status);
        }

        if (updates.length === 0) return existing;

        updates.push(`updated_by_admin_id = $${idx++}`);
        values.push(adminId);
        values.push(id);

        const result = await db.query(
            `UPDATE admin_coupons SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
            values
        );
        return result.rows[0] ? this.mapCouponRow(result.rows[0]) : existing;
    }

    async updateCouponStatus(id, adminId, status) {
        if (!['active', 'inactive'].includes(status)) throw new Error('Invalid status');
        const result = await db.query(
            `UPDATE admin_coupons SET status = $1, updated_by_admin_id = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
            [status, adminId, id]
        );
        return result.rows[0] ? this.mapCouponRow(result.rows[0]) : null;
    }

    async deleteCoupon(id) {
        const result = await db.query(`DELETE FROM admin_coupons WHERE id = $1 RETURNING id`, [id]);
        return result.rowCount > 0;
    }

    mapCouponRow(row) {
        return {
            id: row.id,
            title: row.title,
            couponCode: row.coupon_code,
            type: row.type,
            discountType: row.discount_type,
            discountAmount: row.discount_amount != null ? parseFloat(row.discount_amount) : null,
            startAt: row.start_at,
            expireAt: row.expire_at,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    /** List admin discounts */
    async listDiscounts(options = {}) {
        const { page = 1, limit = 20, status } = options;
        const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(50, Math.max(1, parseInt(limit, 10)));
        const limitVal = Math.min(50, Math.max(1, parseInt(limit, 10)));
        const conditions = [];
        const params = [];
        let idx = 1;
        if (status && ['active', 'inactive'].includes(status)) {
            conditions.push(`status = $${idx++}`);
            params.push(status);
        }
        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const countRes = await db.query(`SELECT COUNT(*)::int as total FROM admin_discounts ${whereClause}`, params);
        const total = countRes.rows[0]?.total || 0;
        params.push(limitVal, offset);
        const listRes = await db.query(
            `SELECT * FROM admin_discounts ${whereClause} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return {
            discounts: listRes.rows.map(this.mapDiscountRow),
            total,
            page: Math.max(1, parseInt(page, 10)),
            limit: limitVal,
            totalPages: Math.ceil(total / limitVal) || 1,
        };
    }

    async getDiscountById(id) {
        const result = await db.query(`SELECT * FROM admin_discounts WHERE id = $1`, [id]);
        const row = result.rows[0];
        return row ? this.mapDiscountRow(row) : null;
    }

    async createDiscount(adminId, data) {
        const { name, discountType, discountAmount, startAt, endAt, status = 'active' } = data;
        if (!name || !name.trim()) throw new Error('Name is required');
        if (!discountType || !['amount', 'percentage'].includes(discountType)) throw new Error('Discount type required');
        const amt = parseFloat(discountAmount);
        if (isNaN(amt) || amt < 0) throw new Error('Invalid discount amount');
        if (discountType === 'percentage' && amt > 100) throw new Error('Percentage cannot exceed 100');

        const result = await db.query(
            `INSERT INTO admin_discounts (name, discount_type, discount_amount, start_at, end_at, status, created_by_admin_id, updated_by_admin_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
            [name.trim(), discountType, amt, startAt || null, endAt || null, ['active', 'inactive'].includes(status) ? status : 'active', adminId]
        );
        return this.mapDiscountRow(result.rows[0]);
    }

    async updateDiscount(id, adminId, data) {
        const existing = await this.getDiscountById(id);
        if (!existing) return null;

        const { name, discountType, discountAmount, startAt, endAt, status } = data;
        const updates = [];
        const values = [];
        let idx = 1;

        if (name !== undefined && name.trim()) {
            updates.push(`name = $${idx++}`);
            values.push(name.trim());
        }
        if (discountType !== undefined && ['amount', 'percentage'].includes(discountType)) {
            updates.push(`discount_type = $${idx++}`);
            values.push(discountType);
        }
        if (discountAmount !== undefined) {
            const amt = parseFloat(discountAmount);
            if (!isNaN(amt) && amt >= 0) {
                updates.push(`discount_amount = $${idx++}`);
                values.push(amt);
            }
        }
        if (startAt !== undefined) {
            updates.push(`start_at = $${idx++}`);
            values.push(startAt || null);
        }
        if (endAt !== undefined) {
            updates.push(`end_at = $${idx++}`);
            values.push(endAt || null);
        }
        if (status !== undefined && ['active', 'inactive'].includes(status)) {
            updates.push(`status = $${idx++}`);
            values.push(status);
        }

        if (updates.length === 0) return existing;

        updates.push(`updated_by_admin_id = $${idx++}`);
        values.push(adminId);
        values.push(id);

        const result = await db.query(
            `UPDATE admin_discounts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
            values
        );
        return result.rows[0] ? this.mapDiscountRow(result.rows[0]) : existing;
    }

    async deleteDiscount(id) {
        const result = await db.query(`DELETE FROM admin_discounts WHERE id = $1 RETURNING id`, [id]);
        return result.rowCount > 0;
    }

    mapDiscountRow(row) {
        return {
            id: row.id,
            name: row.name,
            discountType: row.discount_type,
            discountAmount: parseFloat(row.discount_amount) || 0,
            startAt: row.start_at,
            endAt: row.end_at,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    /** Get all settings for public API (categories, share, coupons, discounts) */
    async getAllForPublic() {
        const [shareRes, couponRes, discountRes] = await Promise.all([
            this.getShareSettings(),
            db.query(`SELECT * FROM admin_coupons WHERE status = 'active' ORDER BY created_at DESC`),
            db.query(`SELECT * FROM admin_discounts WHERE status = 'active' ORDER BY created_at DESC`),
        ]);
        return {
            share: shareRes || { ourStudentPercent: 0, teacherStudentPercent: 0, liveCoursesPercent: 0 },
            coupons: couponRes.rows.map(this.mapCouponRow),
            discounts: discountRes.rows.map(this.mapDiscountRow),
        };
    }
}

module.exports = new AdminSettingsService();
