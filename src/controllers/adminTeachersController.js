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

    async update(req, res) {
        try {
            const teacher = await adminTeachersService.updateTeacher(req.params.id, req.body);
            if (!teacher) {
                return res.status(404).json({ error: 'Teacher not found' });
            }
            res.json(teacher);
        } catch (error) {
            console.error('Admin update teacher error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async delete(req, res) {
        try {
            const id = req.params.id;
            const result = await adminTeachersService.deleteTeacher(id);
            res.json(result);
        } catch (error) {
            if (error.message === 'Teacher not found' || error.message === 'User is not a teacher and cannot be deleted via this action') {
                return res.status(404).json({ error: error.message });
            }
            if (error.message && error.message.includes('storage')) {
                return res.status(502).json({ error: error.message });
            }
            console.error('Admin delete teacher error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }
}

module.exports = new AdminTeachersController();
