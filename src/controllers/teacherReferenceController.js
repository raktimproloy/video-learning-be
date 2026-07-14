const teacherReferenceService = require('../services/teacherReferenceService');

class TeacherReferenceController {
    async getConnectedReferences(req, res, next) {
        try {
            const teacherId = req.user.id;
            const references = await teacherReferenceService.getConnectedReferences(teacherId);
            res.json(references);
        } catch (err) {
            next(err);
        }
    }

    async connectReference(req, res, next) {
        try {
            const teacherId = req.user.id;
            const { marketerId } = req.body;
            
            if (!marketerId) {
                return res.status(400).json({ error: 'Marketer ID is required' });
            }

            const references = await teacherReferenceService.connectReference(teacherId, marketerId);
            res.json(references);
        } catch (err) {
            if (err.message === 'Marketer not found' || err.message === 'Already connected to this reference user') {
                return res.status(400).json({ error: err.message });
            }
            next(err);
        }
    }

    async updateSharedPercent(req, res, next) {
        try {
            const teacherId = req.user.id;
            const { marketerId, sharedPercent } = req.body;
            
            if (!marketerId || sharedPercent === undefined) {
                return res.status(400).json({ error: 'Marketer ID and shared percent are required' });
            }
            
            if (sharedPercent < 0 || sharedPercent > 100) {
                return res.status(400).json({ error: 'Shared percent must be between 0 and 100' });
            }

            const references = await teacherReferenceService.updateSharedPercent(teacherId, marketerId, sharedPercent);
            res.json(references);
        } catch (err) {
            if (err.message === 'Connection not found') {
                return res.status(404).json({ error: err.message });
            }
            next(err);
        }
    }

    async disconnectReference(req, res, next) {
        try {
            const teacherId = req.user.id;
            const { marketerId } = req.params;
            
            const response = await teacherReferenceService.disconnectReference(teacherId, marketerId);
            res.json(response);
        } catch (err) {
            if (err.message === 'Connection not found') {
                return res.status(404).json({ error: err.message });
            }
            next(err);
        }
    }

    async searchMarketers(req, res, next) {
        try {
            const { q } = req.query;
            const marketers = await teacherReferenceService.searchMarketers(q);
            res.json(marketers);
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new TeacherReferenceController();
