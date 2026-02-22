const adminStudentsService = require('../services/adminStudentsService');

class AdminStudentsController {
    async list(req, res) {
        try {
            const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
            const q = req.query.q || null;

            const { students, total } = await adminStudentsService.list(skip, limit, q);
            res.json({ students, total });
        } catch (error) {
            console.error('Admin students list error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getById(req, res) {
        try {
            const student = await adminStudentsService.getById(req.params.id);
            if (!student) {
                return res.status(404).json({ error: 'Student not found' });
            }
            res.json(student);
        } catch (error) {
            console.error('Admin get student error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminStudentsController();
