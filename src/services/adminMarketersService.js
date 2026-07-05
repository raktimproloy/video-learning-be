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
                m.created_at
             FROM marketers m
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
                m.created_at
             FROM marketers m
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
}

module.exports = new AdminMarketersService();
