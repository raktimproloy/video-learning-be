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
        
        const skills = Array.isArray(profile.skills) 
            ? profile.skills 
            : (typeof profile.skills === 'string' ? (() => { try { return JSON.parse(profile.skills); } catch { return []; } })() : []);
        
        return {
            ...profile,
            email: profile.login_email,
            skills: Array.isArray(skills) ? skills : [],
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
            location,
            school_name,
            class: classVal,
            section,
            skills,
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
        if (location !== undefined) {
            updates.push(`location = $${paramIndex++}`);
            values.push(location);
        }
        if (school_name !== undefined) {
            updates.push(`school_name = $${paramIndex++}`);
            values.push(school_name);
        }
        if (classVal !== undefined) {
            updates.push(`class = $${paramIndex++}`);
            values.push(classVal);
        }
        if (section !== undefined) {
            updates.push(`section = $${paramIndex++}`);
            values.push(section);
        }
        if (skills !== undefined) {
            updates.push(`skills = $${paramIndex++}`);
            values.push(Array.isArray(skills) ? JSON.stringify(skills) : '[]');
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
     * Request OTP for phone verification (stub: stores fixed OTP for dev; integrate SMS later).
     */
    async requestPhoneOtp(userId) {
        const profile = await this.getProfile(userId);
        if (!profile.phone || !profile.phone.trim()) {
            throw new Error('Phone number is required');
        }
        const otp = '123456';
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await db.query(
            `UPDATE student_profiles SET phone_otp = $1, phone_otp_expires_at = $2 WHERE user_id = $3`,
            [otp, expiresAt, userId]
        );
        return { message: 'OTP sent', expiresIn: 600 };
    }

    /**
     * Verify phone OTP and set phone_verified = true.
     */
    async verifyPhoneOtp(userId, otp) {
        const result = await db.query(
            `SELECT phone_otp, phone_otp_expires_at FROM student_profiles WHERE user_id = $1`,
            [userId]
        );
        const row = result.rows[0];
        if (!row || !row.phone_otp) {
            throw new Error('OTP not requested or expired');
        }
        if (new Date(row.phone_otp_expires_at) < new Date()) {
            await db.query(
                `UPDATE student_profiles SET phone_otp = NULL, phone_otp_expires_at = NULL WHERE user_id = $1`,
                [userId]
            );
            throw new Error('OTP expired');
        }
        if (row.phone_otp !== String(otp).trim()) {
            throw new Error('Invalid OTP');
        }
        await db.query(
            `UPDATE student_profiles SET phone_verified = TRUE, phone_otp = NULL, phone_otp_expires_at = NULL, updated_at = NOW() WHERE user_id = $1`,
            [userId]
        );
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
