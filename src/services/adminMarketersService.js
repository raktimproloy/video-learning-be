const db = require('../../db');

class AdminMarketersService {
    async list(skip = 0, limit = 10, search = '') {
        const queryParams = [limit, skip];
        let whereClause = '';
        if (search) {
            whereClause = `WHERE m.name ILIKE $3 OR m.phone ILIKE $3 OR m.referral_code ILIKE $3 OR u.email ILIKE $3`;
            queryParams.push(`%${search}%`);
        }

        const result = await db.query(
            `SELECT 
                m.id,
                m.email,
                m.name,
                m.phone,
                m.referral_code,
                m.total_earnings,
                m.withdrawn_amount,
                m.created_at,
                c.custom_percent
             FROM marketers m
             LEFT JOIN custom_user_percentages c ON c.user_id = m.id AND c.user_type = 'marketer'
             ${whereClause}
             ORDER BY m.created_at DESC
             LIMIT $1 OFFSET $2`,
            queryParams
        );

        const countResult = await db.query(
            `SELECT COUNT(*)::int as total
             FROM marketers m
             ${whereClause}`,
            search ? [`%${search}%`] : []
        );
        const total = countResult.rows[0]?.total || 0;

        const marketers = result.rows.map(row => ({
            id: row.id,
            email: row.email,
            name: row.name,
            phone: row.phone,
            referralCode: row.referral_code,
            totalEarnings: parseFloat(row.total_earnings) || 0,
            withdrawnAmount: parseFloat(row.withdrawn_amount) || 0,
            joinedAt: row.created_at,
            customPercent: row.custom_percent !== null ? parseFloat(row.custom_percent) : null,
        }));

        return { marketers, total };
    }

    async getById(id) {
        const result = await db.query(
            `SELECT 
                m.id,
                m.email,
                m.name,
                m.phone,
                m.referral_code,
                m.total_earnings,
                m.withdrawn_amount,
                m.payment_methods,
                m.created_at,
                c.custom_percent
             FROM marketers m
             LEFT JOIN custom_user_percentages c ON c.user_id = m.id AND c.user_type = 'marketer'
             WHERE m.id = $1`,
            [id]
        );
        const row = result.rows[0];
        if (!row) return null;

        return {
            id: row.id,
            email: row.email,
            name: row.name,
            phone: row.phone,
            referralCode: row.referral_code,
            totalEarnings: parseFloat(row.total_earnings) || 0,
            withdrawnAmount: parseFloat(row.withdrawn_amount) || 0,
            paymentMethods: row.payment_methods || [],
            joinedAt: row.created_at,
            customPercent: row.custom_percent !== null ? parseFloat(row.custom_percent) : null,
        };
    }

    async update(id, payload) {
        const { name, phone, referralCode } = payload;
        const result = await db.query(
            `UPDATE marketers
             SET name = COALESCE($1, name),
                 phone = COALESCE($2, phone),
                 referral_code = COALESCE($3, referral_code),
                 updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [name, phone, referralCode, id]
        );
        
        if (result.rows.length === 0) {
            throw new Error('Marketer profile not found');
        }
        
        return this.getById(id);
    }

    async delete(id) {
        // First delete the marketer
        const result = await db.query(
            `DELETE FROM marketers WHERE id = $1 RETURNING *`,
            [id]
        );
        
        if (result.rows.length === 0) {
            throw new Error('Marketer profile not found');
        }
        
        return { message: 'Marketer profile deleted successfully' };
    }

    async updatePercentage(id, customPercent, adminId) {
        if (customPercent === null || customPercent === undefined) {
            // Remove custom percentage
            await db.query(
                `DELETE FROM custom_user_percentages WHERE user_id = $1 AND user_type = 'marketer'`,
                [id]
            );
        } else {
            // Set or update custom percentage
            await db.query(
                `INSERT INTO custom_user_percentages (user_type, user_id, custom_percent, set_by_admin_id, updated_at)
                 VALUES ('marketer', $1, $2, $3, NOW())
                 ON CONFLICT (user_type, user_id) DO UPDATE SET 
                    custom_percent = EXCLUDED.custom_percent,
                    set_by_admin_id = EXCLUDED.set_by_admin_id,
                    updated_at = EXCLUDED.updated_at`,
                [id, customPercent, adminId]
            );
        }
        return this.getById(id);
    }
}

module.exports = new AdminMarketersService();
