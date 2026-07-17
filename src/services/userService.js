const db = require('../../db');
const bcrypt = require('bcryptjs');
const { isStaffEmailAddress, staffEmailBlockedMessage } = require('../utils/staffEmail');

class UserService {
    async createUser(email, password) {
        const normalized = String(email || '').trim().toLowerCase();
        if (isStaffEmailAddress(normalized)) {
            const err = new Error(staffEmailBlockedMessage());
            err.status = 400;
            throw err;
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // All users start as 'student' by default
        // They can join as teacher later via join-teacher endpoint
        const result = await db.query(
            'INSERT INTO users (email, password_hash, role, onboarding_completed) VALUES ($1, $2, $3, FALSE) RETURNING id, email, role, name, core_member, onboarding_completed, onboarding_role, onboarding_category, created_at, google_id',
            [normalized, passwordHash, 'student']
        );
        return result.rows[0];
    }

    async findByGoogleId(googleId) {
        const result = await db.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
        return result.rows[0];
    }

    /** Create user from Google OAuth (no password). If email exists, link google_id to that user. */
    async findOrCreateByGoogle(googleId, email, name) {
        const normalized = String(email || '').trim().toLowerCase();
        if (isStaffEmailAddress(normalized)) {
            const err = new Error(staffEmailBlockedMessage());
            err.status = 400;
            throw err;
        }

        let user = await this.findByGoogleId(googleId);
        if (user) return user;
        user = await this.findByEmail(normalized);
        if (user) {
            if (user.role === 'teacher_staff') {
                const err = new Error(staffEmailBlockedMessage());
                err.status = 400;
                throw err;
            }
            await db.query('UPDATE users SET google_id = $1, name = COALESCE(name, $2) WHERE id = $3', [googleId, name || null, user.id]);
            return (await this.findById(user.id)) || user;
        }
        const result = await db.query(
            'INSERT INTO users (email, password_hash, role, google_id, name, onboarding_completed) VALUES ($1, NULL, $2, $3, $4, FALSE) RETURNING id, email, role, name, core_member, onboarding_completed, onboarding_role, onboarding_category, created_at, google_id',
            [normalized, 'student', googleId, name || null]
        );
        return result.rows[0];
    }

    async findByEmail(email) {
        const result = await db.query('SELECT id, email, role, name, core_member, onboarding_completed, onboarding_role, onboarding_category, created_at, google_id, password_hash, COALESCE(must_change_password, false) AS must_change_password FROM users WHERE email = $1', [email]);
        return result.rows[0];
    }

    async findById(id) {
        const result = await db.query('SELECT id, email, role, name, core_member, onboarding_completed, onboarding_role, onboarding_category, created_at, google_id, COALESCE(must_change_password, false) AS must_change_password FROM users WHERE id = $1', [id]);
        return result.rows[0];
    }

    /** Link a Google account to an existing user (same email). Optional convenience for Google sign-in. */
    async linkGoogle(userId, googleId) {
        await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, userId]);
        return this.findById(userId);
    }

    async validatePassword(user, password) {
        if (!user.password_hash) return false;
        return await bcrypt.compare(password, user.password_hash);
    }

    async updateRole(userId, newRole) {
        const result = await db.query(
            'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role, name, core_member, onboarding_completed, onboarding_role, onboarding_category, created_at, google_id',
            [newRole, userId]
        );
        return result.rows[0];
    }

    async markOnboardingCompleted(userId, role, category) {
        const result = await db.query(
            'UPDATE users SET onboarding_completed = TRUE, onboarding_role = COALESCE(onboarding_role, $2), onboarding_category = COALESCE(onboarding_category, $3) WHERE id = $1 RETURNING id, email, role, name, core_member, onboarding_completed, onboarding_role, onboarding_category, created_at, google_id',
            [userId, role || null, category || null]
        );
        return result.rows[0];
    }

    async createTeacherProfile(userId, profileData) {
        const { name, bio, location, avatar, specialization, experience, certifications } = profileData;
        const result = await db.query(
            `INSERT INTO teacher_profiles (user_id, name, bio, location, avatar, specialization, experience, certifications)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id) 
             DO UPDATE SET 
                 name = EXCLUDED.name,
                 bio = EXCLUDED.bio,
                 location = EXCLUDED.location,
                 avatar = EXCLUDED.avatar,
                 specialization = EXCLUDED.specialization,
                 experience = EXCLUDED.experience,
                 certifications = EXCLUDED.certifications,
                 updated_at = NOW()
             RETURNING *`,
            [userId, name || null, bio || null, location || null, avatar || null, 
             JSON.stringify(specialization || []), experience || null, JSON.stringify(certifications || [])]
        );
        return result.rows[0];
    }

    async getTeacherProfile(userId) {
        const result = await db.query(
            'SELECT * FROM teacher_profiles WHERE user_id = $1',
            [userId]
        );
        return result.rows[0];
    }
}

module.exports = new UserService();
