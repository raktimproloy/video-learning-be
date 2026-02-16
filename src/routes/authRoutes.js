const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const authController = require('../controllers/authController');
const verifyToken = require('../middleware/authMiddleware');

router.post(
    '/register',
    [
        check('email', 'Please include a valid email').isEmail(),
        check('password', 'Password must be at least 6 characters').isLength({ min: 6 })
    ],
    authController.register
);

router.post(
    '/login',
    [
        check('email', 'Please include a valid email').isEmail(),
        check('password', 'Password is required').exists()
    ],
    authController.login
);

router.post(
    '/join-teacher',
    verifyToken,
    authController.joinTeacher
);

router.post(
    '/switch-role',
    verifyToken,
    [
        check('role', 'Role is required').notEmpty(),
        check('role', 'Role must be "student" or "teacher"').isIn(['student', 'teacher'])
    ],
    authController.switchRole
);

router.get(
    '/me',
    verifyToken,
    authController.getCurrentUser
);

module.exports = router;
