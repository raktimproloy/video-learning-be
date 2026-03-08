/**
 * Send push notifications via Firebase Cloud Messaging (Legacy HTTP API).
 * Set FCM_SERVER_KEY in .env (Firebase Console → Project Settings → Cloud Messaging → Server key).
 */

const axios = require('axios');

const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;
const FCM_LEGACY_URL = 'https://fcm.googleapis.com/fcm/send';
const isConfigured = !!(FCM_SERVER_KEY && FCM_SERVER_KEY.trim());

/**
 * Send a data or notification message to a single FCM token.
 * @param {string} token - FCM device token
 * @param {object} options - { title, body, data?: Record<string, string> }
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendToToken(token, { title, body, data = {} }) {
    if (!token || typeof token !== 'string' || !token.trim()) {
        return { sent: false, error: 'FCM token is required' };
    }
    if (!isConfigured) {
        console.log('[FCM] Skipped (FCM_SERVER_KEY not set):', title);
        return { sent: false, error: 'FCM not configured' };
    }
    const payload = {
        to: token.trim(),
        notification: { title: title || 'Notification', body: body || '' },
        data: { ...data, title: title || '', body: body || '' },
    };
    try {
        const res = await axios.post(FCM_LEGACY_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `key=${FCM_SERVER_KEY.trim()}`,
            },
            timeout: 10000,
        });
        const success = res.data && res.data.success === 1;
        if (!success) {
            const err = (res.data && res.data.results && res.data.results[0] && res.data.results[0].error) || res.data?.failure || 'Unknown';
            return { sent: false, error: String(err) };
        }
        return { sent: true };
    } catch (err) {
        const message = err.response?.data?.error || err.message || 'Request failed';
        console.error('[FCM] Send failed:', message);
        return { sent: false, error: message };
    }
}

module.exports = {
    sendToToken,
    isConfigured,
};
