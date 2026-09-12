const adminSettingsService = require('../services/adminSettingsService');
const liveUsageService = require('../services/liveUsageService');
const fcmService = require('../services/fcmService');
const cache = require('../utils/ttlCache');

function getAdminId(req) {
    return req.user?.id || req.admin?.id;
}

module.exports = {
    async getShareSettings(req, res) {
        try {
            const settings = await adminSettingsService.getShareSettings();
            res.json(settings || { ourStudentPercent: 0, teacherStudentPercent: 0, liveCoursesPercent: 0, referencePercent: 10, referenceTeacherPercent: 40 });
        } catch (error) {
            console.error('Get share settings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async updateShareSettings(req, res) {
        try {
            const adminId = getAdminId(req);
            const {
                ourStudentPercent,
                teacherStudentPercent,
                liveCoursesPercent,
                referencePercent,
                referenceTeacherPercent,
                bookPlatformPercent,
                bookMaxPreviewPages,
                bookMaxUploadMb,
            } = req.body || {};
            const settings = await adminSettingsService.updateShareSettings(adminId, {
                ourStudentPercent,
                teacherStudentPercent,
                liveCoursesPercent,
                referencePercent,
                referenceTeacherPercent,
                bookPlatformPercent,
                bookMaxPreviewPages,
                bookMaxUploadMb,
            });
            res.json(settings);
        } catch (error) {
            console.error('Update share settings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getBookShareSettings(req, res) {
        try {
            const settings = await adminSettingsService.getBookShareSettings();
            res.json(settings);
        } catch (error) {
            console.error('Get book share settings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async updateBookShareSettings(req, res) {
        try {
            const adminId = getAdminId(req);
            const settings = await adminSettingsService.updateBookShareSettings(adminId, req.body || {});
            res.json(settings);
        } catch (error) {
            console.error('Update book share settings error:', error);
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
            if (['Coupon code already exists', 'Coupon code is required', 'Title is required', 'Type must be original or discount', 'Discount type required', 'Invalid discount amount', 'Percentage cannot exceed 100', 'Max total uses must be at least 1'].includes(error.message)) {
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
                    streamEnabled: false,
                    hundredMsEnabled: true,
                    awsIvsEnabled: false,
                    youtubeEnabled: true,
                    r2LiveEnabled: false,
                    liveClassDurationMinutes: 60,
                }),
                usage: usage || {
                    teachersByService: { agora: 0, stream: 0, '100ms': 0, aws_ivs: 0, youtube: 0, r2_live: 0 },
                    studentsByService: { agora: 0, stream: 0, '100ms': 0, aws_ivs: 0, youtube: 0, r2_live: 0 },
                    sessionsByService: { agora: 0, stream: 0, '100ms': 0, aws_ivs: 0, youtube: 0, r2_live: 0 },
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
            const { liveClassEnabled, agoraEnabled, streamEnabled, hundredMsEnabled, awsIvsEnabled, youtubeEnabled, r2LiveEnabled, liveClassDurationMinutes } = req.body || {};
            const settings = await adminSettingsService.updateLiveSettings(adminId, {
                liveClassEnabled,
                agoraEnabled,
                streamEnabled,
                hundredMsEnabled,
                awsIvsEnabled,
                youtubeEnabled,
                r2LiveEnabled,
                liveClassDurationMinutes,
            });
            res.json(settings);
        } catch (error) {
            console.error('Update live settings error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** GET /admin/settings/app-update-gate — force-update modal config */
    async getAppUpdateGate(req, res) {
        try {
            const gate = await adminSettingsService.getAppUpdateGate();
            res.json(gate);
        } catch (error) {
            console.error('Get app update gate error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** PUT /admin/settings/app-update-gate — toggle + edit the force-update modal */
    async updateAppUpdateGate(req, res) {
        try {
            const adminId = getAdminId(req);
            const { enabled, title, description, link } = req.body || {};
            const gate = await adminSettingsService.updateAppUpdateGate(adminId, {
                enabled,
                title,
                description,
                link,
            });
            // The public /v1/settings response is cached for 10 minutes — drop it
            // so a toggle here takes effect on the next app check, not up to 10
            // minutes later.
            cache.delete('public:settings:v5');
            res.json(gate);
        } catch (error) {
            console.error('Update app update gate error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** GET /admin/settings/app-releases — release history, newest first */
    async listAppReleases(req, res) {
        try {
            const releases = await adminSettingsService.listAppReleases();
            res.json({ releases });
        } catch (error) {
            console.error('List app releases error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** POST /admin/settings/app-releases — upload a new APK (multipart, field name "apk") */
    async createAppRelease(req, res) {
        try {
            const adminId = getAdminId(req);
            if (!req.file) return res.status(400).json({ error: 'APK file is required' });
            const { versionName, versionCode, changelog } = req.body || {};
            const release = await adminSettingsService.createAppRelease(adminId, {
                versionName,
                versionCode,
                changelog,
                fileBuffer: req.file.buffer,
            });
            res.status(201).json(release);
        } catch (error) {
            if (['Version name is required', 'Version code must be a positive integer', 'APK file is required'].includes(error.message)
                || error.message.startsWith('Version code must be greater than')) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Create app release error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** PATCH /admin/settings/app-releases/:id/publish — make this release the live download */
    async publishAppRelease(req, res) {
        try {
            const release = await adminSettingsService.publishAppRelease(req.params.id);
            if (!release) return res.status(404).json({ error: 'Release not found' });
            // Public /v1/settings caches appRelease — drop it so the download
            // page and force-update gate see the new version immediately.
            cache.delete('public:settings:v5');
            res.json(release);
        } catch (error) {
            console.error('Publish app release error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** DELETE /admin/settings/app-releases/:id — remove a non-live release */
    async deleteAppRelease(req, res) {
        try {
            const deleted = await adminSettingsService.deleteAppRelease(req.params.id);
            if (!deleted) return res.status(404).json({ error: 'Release not found' });
            res.json({ message: 'Release deleted' });
        } catch (error) {
            if (error.message === 'Cannot delete the currently published release') {
                return res.status(400).json({ error: error.message });
            }
            console.error('Delete app release error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /** POST /admin/settings/notifications/broadcast — push to every device (or a role subset) */
    async sendNotificationBroadcast(req, res) {
        try {
            const { title, body, link, audience } = req.body || {};
            if (!title || typeof title !== 'string' || !title.trim()) {
                return res.status(400).json({ error: 'Title is required' });
            }
            const result = await fcmService.sendAdminBroadcastPush({
                title: title.trim(),
                body: typeof body === 'string' ? body.trim() : '',
                link: typeof link === 'string' ? link.trim() : '',
                audience: ['students', 'teachers'].includes(audience) ? audience : 'all',
            });
            res.json(result);
        } catch (error) {
            console.error('Send notification broadcast error:', error);
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
