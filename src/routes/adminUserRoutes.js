const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const adminUserController = require('../controllers/adminUserController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);

router.get('/', adminUserController.getList);

router.post(
    '/',
    [
        check('email', 'Please include a valid email').isEmail(),
        check('password', 'Password must be at least 6 characters').isLength({ min: 6 }),
        check('role', 'Role must be a valid string').optional().isString(),
    ],
    adminUserController.create
);

router.put(
    '/:id',
    [
        check('id', 'Invalid admin ID').isUUID(),
        check('email', 'Please include a valid email').optional().isEmail(),
        check('password', 'Password must be at least 6 characters').optional().isLength({ min: 6 }),
        check('role', 'Role must be a valid string').optional().isString(),
    ],
    adminUserController.update
);

module.exports = router;
