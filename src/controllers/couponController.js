const couponService = require('../services/couponService');

module.exports = {
    async list(req, res) {
        try {
            const teacherId = req.user.id;
            const { page, limit, status } = req.query;
            const result = await couponService.listByTeacher(teacherId, { page, limit, status });
            res.json(result);
        } catch (error) {
            console.error('List coupons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getById(req, res) {
        try {
            const teacherId = req.user.id;
            const coupon = await couponService.getById(req.params.id, teacherId);
            if (!coupon) {
                return res.status(404).json({ error: 'Coupon not found' });
            }
            res.json(coupon);
        } catch (error) {
            console.error('Get coupon error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async create(req, res) {
        try {
            const teacherId = req.user.id;
            const {
                title,
                couponCode,
                type,
                discountType,
                discountAmount,
                startAt,
                expireAt,
                status,
            } = req.body || {};

            const coupon = await couponService.create(teacherId, {
                title,
                couponCode,
                type,
                discountType,
                discountAmount,
                startAt: startAt || null,
                expireAt: expireAt || null,
                status,
            });
            res.status(201).json(coupon);
        } catch (error) {
            if (
                error.message === 'Coupon code already exists' ||
                error.message === 'Coupon code is required' ||
                error.message === 'Title is required' ||
                error.message === 'Type must be original or discount' ||
                error.message === 'Discount type must be amount or percentage' ||
                error.message === 'Invalid discount amount' ||
                error.message === 'Percentage discount cannot exceed 100'
            ) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Create coupon error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async update(req, res) {
        try {
            const teacherId = req.user.id;
            const {
                title,
                couponCode,
                type,
                discountType,
                discountAmount,
                startAt,
                expireAt,
                status,
            } = req.body || {};

            const coupon = await couponService.update(req.params.id, teacherId, {
                title,
                couponCode,
                type,
                discountType,
                discountAmount,
                startAt: startAt ?? undefined,
                expireAt: expireAt ?? undefined,
                status,
            });
            if (!coupon) {
                return res.status(404).json({ error: 'Coupon not found' });
            }
            res.json(coupon);
        } catch (error) {
            if (
                error.message === 'Coupon code already exists' ||
                error.message === 'Coupon code is required'
            ) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Update coupon error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async updateStatus(req, res) {
        try {
            const teacherId = req.user.id;
            const { status } = req.body || {};
            const coupon = await couponService.updateStatus(req.params.id, teacherId, status);
            if (!coupon) {
                return res.status(404).json({ error: 'Coupon not found' });
            }
            res.json(coupon);
        } catch (error) {
            if (error.message === 'Status must be active or inactive') {
                return res.status(400).json({ error: error.message });
            }
            console.error('Update coupon status error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async delete(req, res) {
        try {
            const teacherId = req.user.id;
            const deleted = await couponService.delete(req.params.id, teacherId);
            if (!deleted) {
                return res.status(404).json({ error: 'Coupon not found' });
            }
            res.json({ message: 'Coupon deleted successfully' });
        } catch (error) {
            console.error('Delete coupon error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
