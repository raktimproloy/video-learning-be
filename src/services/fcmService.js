/**
 * Send push notifications via Firebase Cloud Messaging (HTTP v1 API).
 * Uses Firebase Admin SDK with a service account (no legacy server key).
 *
 * Setup (one of):
 * 1. FCM_SERVICE_ACCOUNT_JSON = full JSON string from Firebase Console → Project Settings → Service accounts → Generate new private key.
 *    (Same Firebase project as frontend. For Docker: pass as single line or use GOOGLE_APPLICATION_CREDENTIALS with a mounted file.)
 * 2. GOOGLE_APPLICATION_CREDENTIALS = path to that JSON file.
 *
 * Optional: FRONTEND_URL = https://your-app.vercel.app — so push notification click opens the correct origin (e.g. live class URL).
 */

let messaging = null;
let initError = null;

function initFcm() {
    if (messaging !== null) return messaging;
    if (initError !== null) return null;

    const json = process.env.FCM_SERVICE_ACCOUNT_JSON;
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    try {
        const admin = require('firebase-admin');

        if (admin.apps.length > 0) {
            messaging = admin.messaging();
            return messaging;
        }

        if (json && json.trim()) {
            const serviceAccount = JSON.parse(json.trim());
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        } else if (credPath && credPath.trim()) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        } else {
            initError = new Error('FCM not configured');
            return null;
        }

        messaging = admin.messaging();
        return messaging;
    } catch (e) {
        initError = e;
        console.warn('[FCM] Init failed:', e?.message || e);
        return null;
    }
}

const isConfigured = () => {
    const m = initFcm();
    return m !== null;
};

/**
 * Send a notification + data message to a single FCM token (HTTP v1).
 * @param {string} token - FCM device token
 * @param {object} options - { title, body, data?: Record<string, string> }
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendToToken(token, { title, body, data = {} }) {
    if (!token || typeof token !== 'string' || !token.trim()) {
        return { sent: false, error: 'FCM token is required' };
    }

    const m = initFcm();
    if (!m) {
        console.log('[FCM] Skipped (no service account):', title);
        return { sent: false, error: 'FCM not configured' };
    }

    const dataPayload = { ...data, title: title || '', body: body || '' };
    for (const k of Object.keys(dataPayload)) {
        if (typeof dataPayload[k] !== 'string') dataPayload[k] = String(dataPayload[k]);
    }

    const message = {
        token: token.trim(),
        notification: { title: title || 'Notification', body: body || '' },
        data: dataPayload,
        webpush: {
            headers: { Urgency: 'high' },
            notification: {
                title: title || 'Notification',
                body: body || '',
                requireInteraction: true,
            },
        },
    };

    try {
        await m.send(message);
        return { sent: true };
    } catch (err) {
        const code = err.code || err.message || '';
        const message = String(code || 'Request failed');
        const invalidToken =
            message.includes('registration-token-not-registered') ||
            message.includes('invalid-registration-token') ||
            message.includes('invalid-argument');
        if (invalidToken) {
            console.warn('[FCM] Invalid or unregistered token (will be removed):', message);
        } else {
            console.error('[FCM] Send failed:', message);
        }
        return { sent: false, error: message, invalidToken: !!invalidToken };
    }
}

module.exports = {
    sendToToken,
    isConfigured,
};
