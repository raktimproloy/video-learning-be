const db = require('../../db');
const bcrypt = require('bcryptjs');

class UserService {
    async createUser(email, password) {
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // All users start as 'student' by default
        // They can join as teacher later via join-teacher endpoint
        const result = await db.query(
            'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at',
            [email, passwordHash, 'student']
        );
        return result.rows[0];
    }

    async findByEmail(email) {
        const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        return result.rows[0];
    }

    async findById(id) {
        const result = await db.query('SELECT id, email, role, created_at FROM users WHERE id = $1', [id]);
        return result.rows[0];
    }

    async validatePassword(user, password) {
        return await bcrypt.compare(password, user.password_hash);
    }

    async updateRole(userId, newRole) {
        const result = await db.query(
            'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role, created_at',
            [newRole, userId]
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
