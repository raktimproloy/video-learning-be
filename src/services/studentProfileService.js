const db = require('../../db');
const r2Storage = require('./r2StorageService');
const userPasswordService = require('./userPasswordService');

class StudentProfileService {
    /**
     * Get student profile by user ID
     */
    async getProfile(userId) {
        // Join with users table to get login email
        const result = await db.query(
            `SELECT sp.*, u.email as login_email 
             FROM student_profiles sp
             JOIN users u ON sp.user_id = u.id
             WHERE sp.user_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            // Create empty profile if doesn't exist
            return await this.createProfile(userId);
        }
        
        const profile = result.rows[0];
        
        return {
            ...profile,
            email: profile.login_email, // Use login email
        };
    }

    /**
     * Create empty profile for student
     */
    async createProfile(userId) {
        // Get user email first
        const userResult = await db.query(
            `SELECT email FROM users WHERE id = $1`,
            [userId]
        );
        const loginEmail = userResult.rows[0]?.email || null;

        const result = await db.query(
            `INSERT INTO student_profiles (user_id) VALUES ($1) RETURNING *`,
            [userId]
        );
        
        const profile = result.rows[0];
        return {
            ...profile,
            email: loginEmail,
        };
    }

    /**
     * Update student profile
     */
    async updateProfile(userId, profileData) {
        const {
            name,
            phone,
            profileImagePath,
        } = profileData;

        // Build update query dynamically
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (phone !== undefined) {
            updates.push(`phone = $${paramIndex++}`);
            values.push(phone);
        }
        if (profileImagePath !== undefined) {
            updates.push(`profile_image_path = $${paramIndex++}`);
            values.push(profileImagePath);
        }

        if (updates.length === 0) {
            return await this.getProfile(userId);
        }

        updates.push(`updated_at = NOW()`);
        values.push(userId);

        const query = `
            UPDATE student_profiles 
            SET ${updates.join(', ')}
            WHERE user_id = $${paramIndex}
            RETURNING *
        `;

        const result = await db.query(query, values);
        
        if (result.rows.length === 0) {
            return await this.createProfile(userId);
        }

        return await this.getProfile(userId);
    }

    /**
     * Change password for student (uses shared userPasswordService)
     * Since one account can have both student and teacher roles, password change affects both
     */
    async changePassword(userId, currentPassword, newPassword) {
        return await userPasswordService.changePassword(userId, currentPassword, newPassword);
    }
}

module.exports = new StudentProfileService();
