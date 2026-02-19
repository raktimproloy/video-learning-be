const db = require('../../db');
const bcrypt = require('bcryptjs');

class AdminUserService {
    async findAll(skip = 0, limit = 100) {
        const result = await db.query(
            `SELECT id, email, role, created_at FROM users 
             WHERE role = 'admin' 
             ORDER BY created_at DESC 
             LIMIT $1 OFFSET $2`,
            [limit, skip]
        );
        const countResult = await db.query(
            `SELECT COUNT(*) as total FROM users WHERE role = 'admin'`
        );
        return {
            admins: result.rows,
            total: parseInt(countResult.rows[0].total, 10),
        };
    }

    async findById(id) {
        const result = await db.query(
            `SELECT id, email, role, created_at FROM users 
             WHERE id = $1 AND role = 'admin'`,
            [id]
        );
        return result.rows[0];
    }

    async findByEmail(email) {
        const result = await db.query(
            `SELECT * FROM users WHERE email = $1 AND role = 'admin'`,
            [email]
        );
        return result.rows[0];
    }

    async create(email, password, role = 'admin') {
        const existing = await db.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        if (existing.rows.length > 0) {
            throw new Error('Admin with this email already exists');
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const result = await db.query(
            `INSERT INTO users (email, password_hash, role) 
             VALUES ($1, $2, $3) 
             RETURNING id, email, role, created_at`,
            [email, passwordHash, role]
        );
        return result.rows[0];
    }

    async update(id, data) {
        const { email, password, role } = data;

        const admin = await this.findById(id);
        if (!admin) {
            throw new Error('Admin not found');
        }

        let passwordHash = null;
        if (password && password.length >= 6) {
            const salt = await bcrypt.genSalt(10);
            passwordHash = await bcrypt.hash(password, salt);
        }

        const updates = [];
        const values = [];
        let i = 1;

        if (email !== undefined) {
            const existing = await db.query(
                'SELECT id FROM users WHERE email = $1 AND id != $2',
                [email, id]
            );
            if (existing.rows.length > 0) {
                throw new Error('Email already in use');
            }
            updates.push(`email = $${i++}`);
            values.push(email);
        }
        if (passwordHash) {
            updates.push(`password_hash = $${i++}`);
            values.push(passwordHash);
        }
        if (role !== undefined) {
            updates.push(`role = $${i++}`);
            values.push(role);
        }

        if (updates.length === 0) {
            return admin;
        }

        values.push(id);
        const result = await db.query(
            `UPDATE users SET ${updates.join(', ')}
             WHERE id = $${i} AND role = 'admin'
             RETURNING id, email, role, created_at`,
            values
        );
        return result.rows[0];
    }

    async validatePassword(admin, password) {
        const fullUser = await db.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [admin.id]
        );
        if (!fullUser.rows[0]) return false;
        return bcrypt.compare(password, fullUser.rows[0].password_hash);
    }
}

module.exports = new AdminUserService();
