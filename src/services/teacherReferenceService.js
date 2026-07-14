const db = require('../../db');

class TeacherReferenceService {
    async getConnectedReferences(teacherId) {
        const result = await db.query(
            `SELECT 
                tr.id,
                tr.marketer_id,
                tr.shared_percent,
                tr.connected_at,
                m.name,
                m.email,
                m.phone,
                m.referral_code
             FROM teacher_reference_connections tr
             JOIN marketers m ON tr.marketer_id = m.id
             WHERE tr.teacher_id = $1
             ORDER BY tr.connected_at DESC`,
            [teacherId]
        );
        return result.rows.map(row => ({
            id: row.id,
            marketerId: row.marketer_id,
            sharedPercent: parseFloat(row.shared_percent),
            connectedAt: row.connected_at,
            name: row.name,
            email: row.email,
            phone: row.phone,
            referralCode: row.referral_code
        }));
    }

    async connectReference(teacherId, marketerId) {
        // Verify marketer exists
        const marketerCheck = await db.query('SELECT id FROM marketers WHERE id = $1', [marketerId]);
        if (marketerCheck.rows.length === 0) {
            throw new Error('Marketer not found');
        }

        const result = await db.query(
            `INSERT INTO teacher_reference_connections (teacher_id, marketer_id, shared_percent)
             VALUES ($1, $2, 0)
             ON CONFLICT (teacher_id, marketer_id) DO NOTHING
             RETURNING *`,
            [teacherId, marketerId]
        );
        
        if (result.rows.length === 0) {
            throw new Error('Already connected to this reference user');
        }

        return this.getConnectedReferences(teacherId);
    }

    async updateSharedPercent(teacherId, marketerId, sharedPercent) {
        const result = await db.query(
            `UPDATE teacher_reference_connections
             SET shared_percent = $1, updated_at = NOW()
             WHERE teacher_id = $2 AND marketer_id = $3
             RETURNING *`,
            [sharedPercent, teacherId, marketerId]
        );

        if (result.rows.length === 0) {
            throw new Error('Connection not found');
        }

        return this.getConnectedReferences(teacherId);
    }

    async disconnectReference(teacherId, marketerId) {
        const result = await db.query(
            `DELETE FROM teacher_reference_connections
             WHERE teacher_id = $1 AND marketer_id = $2
             RETURNING *`,
            [teacherId, marketerId]
        );

        if (result.rows.length === 0) {
            throw new Error('Connection not found');
        }

        return { message: 'Disconnected successfully' };
    }

    async searchMarketers(searchQuery) {
        if (!searchQuery) return [];
        
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchQuery);
        const uuidParam = isUuid ? searchQuery : '00000000-0000-0000-0000-000000000000';
        
        const result = await db.query(
            `SELECT id, name, email, phone, referral_code
             FROM marketers
             WHERE id = $1 OR referral_code ILIKE $2 OR name ILIKE $2 OR email ILIKE $2
             LIMIT 5`,
            [uuidParam, `%${searchQuery}%`]
        );
        
        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            phone: row.phone,
            referralCode: row.referral_code
        }));
    }
}

module.exports = new TeacherReferenceService();
