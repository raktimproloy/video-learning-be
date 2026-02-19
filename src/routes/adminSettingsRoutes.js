const express = require('express');
const router = express.Router();
const verifyAdmin = require('../middleware/verifyAdminMiddleware');
const adminSettingsController = require('../controllers/adminSettingsController');

router.use(verifyAdmin);

// Share settings
router.get('/share', adminSettingsController.getShareSettings);
router.put('/share', adminSettingsController.updateShareSettings);

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
