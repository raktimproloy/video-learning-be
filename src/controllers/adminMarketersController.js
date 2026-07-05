const adminMarketersService = require('../services/adminMarketersService');

exports.listMarketers = async (req, res, next) => {
    try {
        const skip = parseInt(req.query.skip) || 0;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';

        const data = await adminMarketersService.list(skip, limit, search);
        res.json(data);
    } catch (err) {
        next(err);
    }
};

exports.getMarketer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const marketer = await adminMarketersService.getById(id);
        
        if (!marketer) {
            return res.status(404).json({ error: 'Marketer not found' });
        }
        
        res.json(marketer);
    } catch (err) {
        next(err);
    }
};

exports.updateMarketer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, phone, referralCode } = req.body;
        
        const updated = await adminMarketersService.update(id, { name, phone, referralCode });
        res.json(updated);
    } catch (err) {
        if (err.message === 'Marketer profile not found') {
            return res.status(404).json({ error: err.message });
        }
        if (err.code === '23505') { // unique violation in postgres
            return res.status(400).json({ error: 'Referral code already exists' });
        }
        next(err);
    }
};

exports.deleteMarketer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const response = await adminMarketersService.delete(id);
        res.json(response);
    } catch (err) {
        if (err.message === 'Marketer profile not found') {
            return res.status(404).json({ error: err.message });
        }
        next(err);
    }
};
