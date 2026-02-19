const db = require('../../db');

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
}

class CouponService {
    /**
     * List coupons for a teacher with pagination.
     */
    async listByTeacher(teacherId, options = {}) {
        const { page = 1, limit = 20, status } = options;
        const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(50, Math.max(1, parseInt(limit, 10)));
        const limitVal = Math.min(50, Math.max(1, parseInt(limit, 10)));

        const conditions = ['teacher_id = $1'];
        const params = [teacherId];
        let idx = 2;

        if (status && ['active', 'inactive'].includes(status)) {
            conditions.push(`status = $${idx}`);
            params.push(status);
            idx++;
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        const countRes = await db.query(
            `SELECT COUNT(*)::int as total FROM teacher_coupons ${whereClause}`,
            params
        );
        const total = countRes.rows[0]?.total || 0;

        params.push(limitVal, offset);
        const listRes = await db.query(
            `SELECT * FROM teacher_coupons ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        const totalPages = Math.ceil(total / limitVal) || 1;

        return {
            coupons: listRes.rows.map(row => this.mapRow(row)),
            total,
            page: Math.max(1, parseInt(page, 10)),
            limit: limitVal,
            totalPages,
        };
    }

    /**
     * Get a single coupon by id. Teacher must own it.
     */
    async getById(id, teacherId) {
        const result = await db.query(
            `SELECT * FROM teacher_coupons WHERE id = $1 AND teacher_id = $2`,
            [id, teacherId]
        );
        const row = result.rows[0];
        return row ? this.mapRow(row) : null;
    }

    /**
     * Create a coupon. coupon_code must be globally unique.
     */
    async create(teacherId, data) {
        const {
            title,
            couponCode,
            type,
            discountType,
            discountAmount,
            startAt,
            expireAt,
            status = 'active',
        } = data;

        const code = normalizeCode(couponCode);
        if (!code) throw new Error('Coupon code is required');
        if (!title || !title.trim()) throw new Error('Title is required');
        if (!type || !['original', 'discount'].includes(type)) {
            throw new Error('Type must be original or discount');
        }

        if (type === 'discount') {
            if (!discountType || !['amount', 'percentage'].includes(discountType)) {
                throw new Error('Discount type must be amount or percentage');
            }
            const amt = parseFloat(discountAmount);
            if (isNaN(amt) || amt < 0) throw new Error('Invalid discount amount');
            if (discountType === 'percentage' && amt > 100) {
                throw new Error('Percentage discount cannot exceed 100');
            }
        }

        const existing = await db.query(
            `SELECT id FROM teacher_coupons WHERE LOWER(TRIM(coupon_code)) = LOWER($1)`,
            [code]
        );
        if (existing.rows[0]) {
            throw new Error('Coupon code already exists');
        }

        const result = await db.query(
            `INSERT INTO teacher_coupons (
                teacher_id, title, coupon_code, type,
                discount_type, discount_amount, start_at, expire_at, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                teacherId,
                title.trim(),
                code,
                type,
                type === 'discount' ? discountType : null,
                type === 'discount' ? parseFloat(discountAmount) : null,
                type === 'original' ? null : (startAt || null),
                type === 'original' ? null : (expireAt || null),
                ['active', 'inactive'].includes(status) ? status : 'active',
            ]
        );
        return this.mapRow(result.rows[0]);
    }

    /**
     * Update a coupon. Teacher must own it.
     */
    async update(id, teacherId, data) {
        const existing = await this.getById(id, teacherId);
        if (!existing) return null;

        const {
            title,
            couponCode,
            type,
            discountType,
            discountAmount,
            startAt,
            expireAt,
            status,
        } = data;

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
            const dup = await db.query(
                `SELECT id FROM teacher_coupons WHERE LOWER(TRIM(coupon_code)) = LOWER($1) AND id != $2`,
                [code, id]
            );
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
        if (type === 'discount' || existing.type === 'discount') {
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
            if (expireAt !== undefined) {
                updates.push(`expire_at = $${idx++}`);
                values.push(expireAt || null);
            }
        }
        if (status !== undefined && ['active', 'inactive'].includes(status)) {
            updates.push(`status = $${idx++}`);
            values.push(status);
        }

        if (updates.length === 0) return existing;

        values.push(id, teacherId);
        const idParam = values.length - 1;
        const teacherParam = values.length;
        const result = await db.query(
            `UPDATE teacher_coupons SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${idParam} AND teacher_id = $${teacherParam} RETURNING *`,
            values
        );
        return result.rows[0] ? this.mapRow(result.rows[0]) : existing;
    }

    /**
     * Update only status. Teacher must own it.
     */
    async updateStatus(id, teacherId, status) {
        if (!['active', 'inactive'].includes(status)) {
            throw new Error('Status must be active or inactive');
        }
        const result = await db.query(
            `UPDATE teacher_coupons SET status = $1, updated_at = NOW()
             WHERE id = $2 AND teacher_id = $3 RETURNING *`,
            [status, id, teacherId]
        );
        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }

    /**
     * Delete a coupon. Teacher must own it.
     */
    async delete(id, teacherId) {
        const result = await db.query(
            `DELETE FROM teacher_coupons WHERE id = $1 AND teacher_id = $2 RETURNING id`,
            [id, teacherId]
        );
        return result.rowCount > 0;
    }

    mapRow(row) {
        return {
            id: row.id,
            teacherId: row.teacher_id,
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
}

module.exports = new CouponService();
