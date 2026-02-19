const jwt = require('jsonwebtoken');
const adminUserService = require('../services/adminUserService');
const { validationResult } = require('express-validator');

class AdminAuthController {
    async login(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { email, password } = req.body;

            const admin = await adminUserService.findByEmail(email);
            if (!admin) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const isValid = await adminUserService.validatePassword(admin, password);
            if (!isValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const token = jwt.sign(
                { id: admin.id, email: admin.email, role: 'admin' },
                process.env.JWT_SECRET || 'your_jwt_secret',
                { expiresIn: '24h' }
            );

            res.json({
                token,
                admin: {
                    id: admin.id,
                    email: admin.email,
                    role: admin.role || 'admin',
                    createdAt: admin.created_at,
                },
            });
        } catch (error) {
            console.error('Admin login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminAuthController();
