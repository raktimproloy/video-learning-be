const importStore = require('../services/externalCourseImportStore');

class AdminExternalCourseImportsController {
    async list(req, res) {
        try {
            const drafts = await importStore.listDraftSummaries();
            res.json({ drafts });
        } catch (error) {
            console.error('Admin external course import list error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async create(req, res) {
        try {
            const { fileName, rawData, sourceCandidates, sourcePath } = req.body || {};
            if (rawData === undefined) {
                return res.status(400).json({ error: 'rawData is required' });
            }
            if (!Array.isArray(sourceCandidates) || sourceCandidates.length === 0) {
                return res.status(400).json({ error: 'No importable records were found in the JSON file.' });
            }

            const draft = await importStore.createDraft({
                fileName,
                rawData,
                sourceCandidates,
                sourcePath,
                createdBy: {
                    id: req.admin?.id || null,
                    email: req.admin?.email || null,
                },
            });

            res.status(201).json(draft);
        } catch (error) {
            console.error('Admin external course import create error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async getById(req, res) {
        try {
            const draft = await importStore.readDraft(req.params.id);
            res.json(draft);
        } catch (error) {
            console.error('Admin external course import get error:', error);
            res.status(404).json({ error: error.message || 'Import draft not found' });
        }
    }

    async update(req, res) {
        try {
            const draft = await importStore.updateDraft(req.params.id, {
                status: req.body?.status,
                sourcePath: req.body?.sourcePath,
                mapping: req.body?.mapping,
                items: req.body?.items,
                importedCourseIds: req.body?.importedCourseIds,
                updatedBy: {
                    id: req.admin?.id || null,
                    email: req.admin?.email || null,
                },
            });
            res.json(draft);
        } catch (error) {
            console.error('Admin external course import update error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async delete(req, res) {
        try {
            await importStore.deleteDraft(req.params.id);
            res.json({ message: 'Draft deleted successfully' });
        } catch (error) {
            console.error('Admin external course import delete error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }
}

module.exports = new AdminExternalCourseImportsController();
