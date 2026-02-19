const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const adminAuthController = require('../controllers/adminAuthController');

router.post(
    '/login',
    [
        check('email', 'Please include a valid email').isEmail(),
        check('password', 'Password is required').exists(),
    ],
    adminAuthController.login
);

module.exports = router;
