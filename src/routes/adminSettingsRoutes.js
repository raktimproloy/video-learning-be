const express = require('express');
const multer = require('multer');
const router = express.Router();
const verifyAdmin = require('../middleware/verifyAdminMiddleware');
const adminSettingsController = require('../controllers/adminSettingsController');

const uploadApk = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 300 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const name = (file.originalname || '').toLowerCase();
        if (file.mimetype === 'application/vnd.android.package-archive' || name.endsWith('.apk')) {
            return cb(null, true);
        }
        return cb(new Error('File must be a .apk package'));
    },
});

router.use(verifyAdmin);

// Share settings
router.get('/share', adminSettingsController.getShareSettings);
router.put('/share', adminSettingsController.updateShareSettings);

// Book share / limits
router.get('/book-share', adminSettingsController.getBookShareSettings);
router.put('/book-share', adminSettingsController.updateBookShareSettings);

// Live settings (master switch + per-provider; includes usage stats)
router.get('/live', adminSettingsController.getLiveSettings);
router.put('/live', adminSettingsController.updateLiveSettings);

// Force-update gate (blocking modal shown app-wide on mobile)
router.get('/app-update-gate', adminSettingsController.getAppUpdateGate);
router.put('/app-update-gate', adminSettingsController.updateAppUpdateGate);

// APK release history (upload, publish, delete) — feeds the public download page
router.get('/app-releases', adminSettingsController.listAppReleases);
router.post('/app-releases', uploadApk.single('apk'), adminSettingsController.createAppRelease);
router.patch('/app-releases/:id/publish', adminSettingsController.publishAppRelease);
router.delete('/app-releases/:id', adminSettingsController.deleteAppRelease);

// Push notification broadcast (all devices, or a role subset)
router.post('/notifications/broadcast', adminSettingsController.sendNotificationBroadcast);

// Live usage: packages (free minute caps) and usage report
router.get('/live-usage/packages', adminSettingsController.getLiveUsagePackages);
router.put('/live-usage/packages/:provider', adminSettingsController.updateLiveUsagePackage);
router.get('/live-usage/report', adminSettingsController.getLiveUsageReport);

// Coupons
router.get('/coupons', adminSettingsController.listCoupons);
router.get('/coupons/:id', adminSettingsController.getCouponById);
router.post('/coupons', adminSettingsController.createCoupon);
router.put('/coupons/:id', adminSettingsController.updateCoupon);
router.patch('/coupons/:id/status', adminSettingsController.updateCouponStatus);
router.delete('/coupons/:id', adminSettingsController.deleteCoupon);

// Discounts
router.get('/discounts', adminSettingsController.listDiscounts);
router.get('/discounts/:id', adminSettingsController.getDiscountById);
router.post('/discounts', adminSettingsController.createDiscount);
router.put('/discounts/:id', adminSettingsController.updateDiscount);
router.delete('/discounts/:id', adminSettingsController.deleteDiscount);

module.exports = router;
