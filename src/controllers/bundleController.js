const bundleService = require('../services/bundleService');

module.exports = {
    async list(req, res) {
        try {
            const teacherId = req.user.id;
            const bundles = await bundleService.getByTeacher(teacherId);
            res.json(bundles.map(b => ({
                id: b.id,
                teacher_id: b.teacher_id,
                title: b.title,
                description: b.description,
                main_price: b.main_price,
                discount_price: b.discount_price,
                currency: b.currency,
                created_at: b.created_at,
                updated_at: b.updated_at,
                course_count: b.course_count,
                course_ids: b.course_ids,
            })));
        } catch (error) {
            console.error('List bundles error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getOne(req, res) {
        try {
            const teacherId = req.user.id;
            const bundle = await bundleService.getById(req.params.id, teacherId);
            if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
            res.json({
                id: bundle.id,
                title: bundle.title,
                description: bundle.description,
                main_price: bundle.main_price,
                discount_price: bundle.discount_price,
                currency: bundle.currency,
                created_at: bundle.created_at,
                updated_at: bundle.updated_at,
                courses: bundle.courses,
            });
        } catch (error) {
            console.error('Get bundle error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async create(req, res) {
        try {
            const teacherId = req.user.id;
            const { title, description, mainPrice, discountPrice, currency, courseIds } = req.body || {};
            const bundle = await bundleService.create(teacherId, {
                title,
                description,
                mainPrice,
                discountPrice,
                currency: currency || 'USD',
                courseIds: Array.isArray(courseIds) ? courseIds : [],
            });
            res.status(201).json({
                id: bundle.id,
                title: bundle.title,
                description: bundle.description,
                main_price: bundle.main_price,
                discount_price: bundle.discount_price,
                currency: bundle.currency,
                created_at: bundle.created_at,
                courses: bundle.courses,
            });
        } catch (error) {
            if (error.message === 'At least one course is required') {
                return res.status(400).json({ error: error.message });
            }
            console.error('Create bundle error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async update(req, res) {
        try {
            const teacherId = req.user.id;
            const { title, description, mainPrice, discountPrice, currency } = req.body || {};
            const bundle = await bundleService.update(teacherId, req.params.id, {
                title,
                description,
                mainPrice,
                discountPrice,
                currency,
            });
            if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
            res.json({
                id: bundle.id,
                title: bundle.title,
                description: bundle.description,
                main_price: bundle.main_price,
                discount_price: bundle.discount_price,
                currency: bundle.currency,
                updated_at: bundle.updated_at,
                courses: bundle.courses,
            });
        } catch (error) {
            console.error('Update bundle error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async delete(req, res) {
        try {
            const teacherId = req.user.id;
            const deleted = await bundleService.delete(teacherId, req.params.id);
            if (!deleted) return res.status(404).json({ error: 'Bundle not found' });
            res.json({ message: 'Bundle deleted' });
        } catch (error) {
            console.error('Delete bundle error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
