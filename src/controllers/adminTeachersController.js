const adminTeachersService = require('../services/adminTeachersService');

class AdminTeachersController {
    async list(req, res) {
        try {
            const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
            const q = req.query.q || null;

            const { teachers, total } = await adminTeachersService.list(skip, limit);
            res.json({ teachers, total });
        } catch (error) {
            console.error('Admin teachers list error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getById(req, res) {
        try {
            const teacher = await adminTeachersService.getById(req.params.id);
            if (!teacher) {
                return res.status(404).json({ error: 'Teacher not found' });
            }
            res.json(teacher);
        } catch (error) {
            console.error('Admin get teacher error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminTeachersController();
