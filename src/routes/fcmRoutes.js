const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');

const fcmService = require('../services/fcmService');

// All FCM routes require authentication (student/teacher)
router.use(authMiddleware);

/**
 * Register or update an FCM device token for the current user.
 * Body: { token: string }
 */
router.post('/register-device', async (req, res) => {
    try {
        const userId = req.user.id;
        const { token } = req.body || {};

        if (!token || typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ error: 'FCM token is required' });
        }

        await fcmService.registerToken(userId, token.trim());
        res.json({ success: true });
    } catch (err) {
        console.error('Register FCM device error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

