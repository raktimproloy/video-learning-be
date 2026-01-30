const db = require('../../db');
const bcrypt = require('bcryptjs');

class UserService {
    async createUser(email, password, role = 'student') {
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const result = await db.query(
            'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at',
            [email, passwordHash, role]
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
}

module.exports = new UserService();
