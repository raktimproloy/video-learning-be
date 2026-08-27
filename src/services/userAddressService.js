const db = require('../../db');

module.exports = {
    async getUserAddresses(userId) {
        const { rows } = await db.query(
            `SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
            [userId]
        );
        return rows;
    },

    async getAddressById(id, userId) {
        const { rows } = await db.query(
            `SELECT * FROM user_addresses WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );
        return rows[0] || null;
    },

    async createAddress(userId, data) {
        // If this is the first address or marked as default, unset other defaults
        if (data.is_default) {
            await db.query(`UPDATE user_addresses SET is_default = false WHERE user_id = $1`, [userId]);
        } else {
            const { rows: existing } = await db.query(`SELECT id FROM user_addresses WHERE user_id = $1`, [userId]);
            if (existing.length === 0) data.is_default = true;
        }

        const { rows } = await db.query(
            `INSERT INTO user_addresses 
            (user_id, full_name, phone, alt_phone, district, area, address_line, postal_code, is_default) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            RETURNING *`,
            [
                userId,
                data.full_name,
                data.phone,
                data.alt_phone || null,
                data.district,
                data.area,
                data.address_line,
                data.postal_code || null,
                !!data.is_default
            ]
        );
        return rows[0];
    },

    async updateAddress(id, userId, data) {
        if (data.is_default) {
            await db.query(`UPDATE user_addresses SET is_default = false WHERE user_id = $1`, [userId]);
        }
        
        const { rows } = await db.query(
            `UPDATE user_addresses SET 
                full_name = COALESCE($1, full_name),
                phone = COALESCE($2, phone),
                alt_phone = COALESCE($3, alt_phone),
                district = COALESCE($4, district),
                area = COALESCE($5, area),
                address_line = COALESCE($6, address_line),
                postal_code = COALESCE($7, postal_code),
                is_default = COALESCE($8, is_default),
                updated_at = NOW()
            WHERE id = $9 AND user_id = $10 
            RETURNING *`,
            [
                data.full_name,
                data.phone,
                data.alt_phone,
                data.district,
                data.area,
                data.address_line,
                data.postal_code,
                data.is_default,
                id,
                userId
            ]
        );
        return rows[0] || null;
    },

    async deleteAddress(id, userId) {
        const { rowCount } = await db.query(
            `DELETE FROM user_addresses WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );
        return rowCount > 0;
    }
};
