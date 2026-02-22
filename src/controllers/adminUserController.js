const adminUserService = require('../services/adminUserService');
const { validationResult } = require('express-validator');

class AdminUserController {
    async getList(req, res) {
        try {
            const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

            const { admins, total } = await adminUserService.findAll(skip, limit);

            res.json({
                admins: admins.map((a) => ({
                    id: a.id,
                    email: a.email,
                    role: a.role || 'admin',
                    status: 'active',
                    createdAt: a.created_at,
                })),
                total,
            });
        } catch (error) {
            console.error('Get admins list error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async create(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { email, password, role } = req.body;
            const admin = await adminUserService.create(email, password, role || 'admin');

            res.status(201).json({
                admin: {
                    id: admin.id,
                    email: admin.email,
                    role: admin.role || 'admin',
                    status: 'active',
                    createdAt: admin.created_at,
                },
            });
        } catch (error) {
            if (error.message === 'Admin with this email already exists') {
                return res.status(400).json({ error: error.message });
            }
            console.error('Create admin error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async update(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { id } = req.params;
            const { email, password, role } = req.body;
            const admin = await adminUserService.update(id, { email, password, role });

            res.json({
                admin: {
                    id: admin.id,
                    email: admin.email,
                    role: admin.role || 'admin',
                    status: 'active',
                    createdAt: admin.created_at,
                },
            });
        } catch (error) {
            if (error.message === 'Admin not found') {
                return res.status(404).json({ error: error.message });
            }
            if (error.message === 'Email already in use') {
                return res.status(400).json({ error: error.message });
            }
            console.error('Update admin error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminUserController();
