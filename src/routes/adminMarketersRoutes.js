const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const verifyToken = require('../middleware/authMiddleware');
const adminMarketersController = require('../controllers/adminMarketersController');

// Protect admin routes with JWT
router.use(verifyToken);

router.get(
    '/',
    adminMarketersController.listMarketers
);

router.get(
    '/:id',
    [
        check('id', 'Marketer User ID is required').isUUID()
    ],
    adminMarketersController.getMarketer
);

router.put(
    '/:id',
    [
        check('id', 'Marketer User ID is required').isUUID(),
        check('name', 'Name must not be empty').optional().not().isEmpty(),
        check('phone', 'Phone must not be empty').optional().not().isEmpty(),
        check('referralCode', 'Referral Code must not be empty').optional().not().isEmpty()
    ],
    adminMarketersController.updateMarketer
);

router.delete(
    '/:id',
    [
        check('id', 'Marketer User ID is required').isUUID()
    ],
    adminMarketersController.deleteMarketer
);

module.exports = router;
