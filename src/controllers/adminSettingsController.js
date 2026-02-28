const adminSettingsService = require('../services/adminSettingsService');
const liveUsageService = require('../services/liveUsageService');

function getAdminId(req) {
    return req.user?.id || req.admin?.id;
}

module.exports = {
    async getShareSettings(req, res) {
        try {
            const settings = await adminSettingsService.getShareSettings();
            res.json(settings || { ourStudentPercent: 0, teacherStudentPercent: 0, liveCoursesPercent: 0 });
        } catch (error) {
            console.error('Get share settings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async updateShareSettings(req, res) {
        try {
            const adminId = getAdminId(req);
            const { ourStudentPercent, teacherStudentPercent, liveCoursesPercent } = req.body || {};
            const settings = await adminSettingsService.updateShareSettings(adminId, {
                ourStudentPercent,
                teacherStudentPercent,
                liveCoursesPercent,
            });
            res.json(settings);
        } catch (error) {
            console.error('Update share settings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async listCoupons(req, res) {
        try {
            const { page, limit, status } = req.query;
            const result = await adminSettingsService.listCoupons({ page, limit, status });
            res.json(result);
        } catch (error) {
            console.error('List admin coupons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getCouponById(req, res) {
        try {
            const coupon = await adminSettingsService.getCouponById(req.params.id);
            if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
            res.json(coupon);
        } catch (error) {
            console.error('Get coupon error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async createCoupon(req, res) {
        try {
            const adminId = getAdminId(req);
            const coupon = await adminSettingsService.createCoupon(adminId, req.body || {});
            res.status(201).json(coupon);
        } catch (error) {
            if (['Coupon code already exists', 'Coupon code is required', 'Title is required', 'Type must be original or discount', 'Discount type required', 'Invalid discount amount', 'Percentage cannot exceed 100'].includes(error.message)) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Create coupon error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async updateCoupon(req, res) {
        try {
            const adminId = getAdminId(req);
            const coupon = await adminSettingsService.updateCoupon(req.params.id, adminId, req.body || {});
            if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
            res.json(coupon);
        } catch (error) {
            if (['Coupon code already exists', 'Coupon code is required'].includes(error.message)) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Update coupon error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async updateCouponStatus(req, res) {
        try {
            const adminId = getAdminId(req);
            const { status } = req.body || {};
            const coupon = await adminSettingsService.updateCouponStatus(req.params.id, adminId, status);
            if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
            res.json(coupon);
        } catch (error) {
            if (error.message === 'Invalid status') return res.status(400).json({ error: error.message });
            console.error('Update coupon status error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async deleteCoupon(req, res) {
        try {
            const deleted = await adminSettingsService.deleteCoupon(req.params.id);
            if (!deleted) return res.status(404).json({ error: 'Coupon not found' });
            res.json({ message: 'Coupon deleted' });
        } catch (error) {
            console.error('Delete coupon error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async listDiscounts(req, res) {
        try {
            const { page, limit, status } = req.query;
            const result = await adminSettingsService.listDiscounts({ page, limit, status });
            res.json(result);
        } catch (error) {
            console.error('List admin discounts error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getDiscountById(req, res) {
        try {
            const discount = await adminSettingsService.getDiscountById(req.params.id);
            if (!discount) return res.status(404).json({ error: 'Discount not found' });
            res.json(discount);
        } catch (error) {
            console.error('Get discount error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async createDiscount(req, res) {
        try {
            const adminId = getAdminId(req);
            const discount = await adminSettingsService.createDiscount(adminId, req.body || {});
            res.status(201).json(discount);
        } catch (error) {
            if (['Name is required', 'Discount type required', 'Invalid discount amount', 'Percentage cannot exceed 100'].includes(error.message)) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Create discount error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async updateDiscount(req, res) {
        try {
            const adminId = getAdminId(req);
            const discount = await adminSettingsService.updateDiscount(req.params.id, adminId, req.body || {});
            if (!discount) return res.status(404).json({ error: 'Discount not found' });
            res.json(discount);
        } catch (error) {
            console.error('Update discount error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async deleteDiscount(req, res) {
        try {
            const deleted = await adminSettingsService.deleteDiscount(req.params.id);
            if (!deleted) return res.status(404).json({ error: 'Discount not found' });
            res.json({ message: 'Discount deleted' });
        } catch (error) {
            console.error('Delete discount error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** GET /admin/settings/live — settings + usage (teachers/students per service) */
    async getLiveSettings(req, res) {
        try {
            const [settings, usage] = await Promise.all([
                adminSettingsService.getLiveSettings(),
                adminSettingsService.getLiveUsageStats(),
            ]);
            res.json({
                ...(settings || {
                    liveClassEnabled: true,
                    agoraEnabled: true,
                    hundredMsEnabled: true,
                    awsIvsEnabled: false,
                    youtubeEnabled: true,
                    liveClassDurationMinutes: 60,
                }),
                usage: usage || {
                    teachersByService: { agora: 0, '100ms': 0, aws_ivs: 0, youtube: 0 },
                    studentsByService: { agora: 0, '100ms': 0, aws_ivs: 0, youtube: 0 },
                    sessionsByService: { agora: 0, '100ms': 0, aws_ivs: 0, youtube: 0 },
                    activeNow: 0,
                },
            });
        } catch (error) {
            console.error('Get live settings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** PUT /admin/settings/live — update live toggles */
    async updateLiveSettings(req, res) {
        try {
            const adminId = getAdminId(req);
            const { liveClassEnabled, agoraEnabled, hundredMsEnabled, awsIvsEnabled, youtubeEnabled, liveClassDurationMinutes } = req.body || {};
            const settings = await adminSettingsService.updateLiveSettings(adminId, {
                liveClassEnabled,
                agoraEnabled,
                hundredMsEnabled,
                awsIvsEnabled,
                youtubeEnabled,
                liveClassDurationMinutes,
            });
            res.json(settings);
        } catch (error) {
            console.error('Update live settings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** GET /admin/settings/live-usage/packages — list provider packages (cap, used, remaining minutes) */
    async getLiveUsagePackages(req, res) {
        try {
            const packages = await liveUsageService.getProviderPackages();
            res.json({ packages });
        } catch (error) {
            console.error('Get live usage packages error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** PUT /admin/settings/live-usage/packages/:provider — update free minute cap for a provider */
    async updateLiveUsagePackage(req, res) {
        try {
            const { provider } = req.params;
            const { freeMinutesCap } = req.body || {};
            if (!liveUsageService.PROVIDERS.includes(provider)) {
                return res.status(400).json({ error: 'Invalid provider' });
            }
            await liveUsageService.updateProviderPackage(provider, freeMinutesCap);
            const packages = await liveUsageService.getProviderPackages();
            const pkg = packages.find(p => p.provider === provider);
            res.json(pkg || { provider, freeMinutesCap: Number(freeMinutesCap) });
        } catch (error) {
            console.error('Update live usage package error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** GET /admin/settings/live-usage/report — full usage report (by provider, teacher, student) */
    async getLiveUsageReport(req, res) {
        try {
            const report = await liveUsageService.getUsageReport();
            res.json(report);
        } catch (error) {
            console.error('Get live usage report error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
