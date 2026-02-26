const express = require('express');
const router = express.Router();
const verifyAdmin = require('../middleware/verifyAdminMiddleware');
const adminSettingsController = require('../controllers/adminSettingsController');

router.use(verifyAdmin);

// Share settings
router.get('/share', adminSettingsController.getShareSettings);
router.put('/share', adminSettingsController.updateShareSettings);

// Live settings (master switch + per-provider; includes usage stats)
router.get('/live', adminSettingsController.getLiveSettings);
router.put('/live', adminSettingsController.updateLiveSettings);

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
