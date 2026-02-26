/**
 * Reusable SMS sending via BulkSMS BD API.
 * https://bulksmsbd.net/api/smsapi
 *
 * Env: BULKSMS_API_KEY, BULKSMS_SENDER_ID (e.g. 8809617611061)
 * If either is missing, sendSms no-ops and returns { sent: false, skipped: true }.
 */

const axios = require('axios');
const BULKSMS_BASE = 'https://bulksmsbd.net/api/smsapi';

/**
 * Normalize phone for BulkSMS BD (Bangladesh).
 * Expects number like 017..., 01..., 88017...; outputs 880XXXXXXXXXX (11 digits after 880).
 * @param {string} phone - Raw phone input
 * @returns {string|null} - Normalized 880XXXXXXXXXX or null if invalid
 */
function normalizePhone(phone) {
    if (!phone || typeof phone !== 'string') return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return null;
    if (digits.length === 10 && digits.startsWith('0')) {
        return '88' + digits; // 017... -> 88017...
    }
    if (digits.length === 11 && digits.startsWith('0')) {
        return '88' + digits;
    }
    if (digits.length >= 11 && digits.startsWith('88')) {
        return digits.slice(0, 13); // 88017xxxxxxxxx
    }
    if (digits.length === 11) {
        return '88' + digits;
    }
    return null;
}

/**
 * Send a single SMS via BulkSMS BD API (GET).
 *
 * @param {string} phone - Receiver number (e.g. 01712345678 or 8801712345678)
 * @param {string} message - Plain text message (will be encoded for query string)
 * @returns {Promise<{ sent: boolean, skipped?: boolean, responseCode?: number, successMessage?: string, errorMessage?: string }>}
 */
async function sendSms(phone, message) {
    const apiKey = process.env.BULKSMS_API_KEY;
    const senderId = process.env.BULKSMS_SENDER_ID || process.env.BULKSMS_SENDERID;

    if (!apiKey || !senderId) {
        return { sent: false, skipped: true, reason: 'SMS not configured (missing BULKSMS_API_KEY or BULKSMS_SENDER_ID)' };
    }

    const normalized = normalizePhone(phone);
    if (!normalized) {
        return { sent: false, reason: 'Invalid or unsupported phone number format' };
    }

    const trimmedMessage = (message && typeof message === 'string') ? message.trim() : '';
    if (!trimmedMessage) {
        return { sent: false, reason: 'Message is empty' };
    }

    const params = new URLSearchParams({
        api_key: apiKey,
        type: 'text',
        number: normalized,
        senderid: senderId,
        message: trimmedMessage,
    });
    const url = `${BULKSMS_BASE}?${params.toString()}`;

    try {
        const res = await axios.get(url, { timeout: 15000, responseType: 'json' });
        const data = res.data || {};

        const code = data.response_code;
        const successMessage = data.success_message || '';
        const errorMessage = data.error_message || '';

        // BulkSMS BD: typically 1000 or 2000 = success; 1001 etc = error
        const sent = (code === 1000 || code === 2000 || (typeof code === 'number' && code >= 2000));

        return {
            sent,
            responseCode: code,
            successMessage: successMessage || undefined,
            errorMessage: errorMessage || undefined,
        };
    } catch (err) {
        const reason = err.response?.data?.error_message || err.message || 'Request failed';
        return { sent: false, reason };
    }
}

/**
 * Send payment-pending SMS to the given phone (e.g. after student submits payment request).
 * Safe to call from payment flow; logs errors and does not throw.
 *
 * @param {string} phone - Sender/payer phone from payment form
 */
async function sendPaymentPendingSms(phone) {
    if (!phone || !String(phone).trim()) return;
    const message = 'Order pending. Please wait.';
    try {
        const result = await sendSms(phone, message);
        if (result.skipped) return;
        if (!result.sent) {
            console.warn('SMS (payment pending) not sent:', result.reason || result.errorMessage || result.responseCode);
        }
    } catch (err) {
        console.error('SMS (payment pending) error:', err.message);
    }
}

/**
 * Send payment-accepted SMS (e.g. after admin accepts the payment request).
 *
 * @param {string} phone - Sender/payer phone from payment request
 * @param {string} [courseTitle] - Unused; kept for API compatibility
 */
async function sendPaymentAcceptedSms(phone, courseTitle) {
    if (!phone || !String(phone).trim()) return;
    const message = 'Payment accepted. You have access now.';
    try {
        const result = await sendSms(phone, message);
        if (result.skipped) return;
        if (!result.sent) {
            console.warn('SMS (payment accepted) not sent:', result.reason || result.errorMessage || result.responseCode);
        }
    } catch (err) {
        console.error('SMS (payment accepted) error:', err.message);
    }
}

/**
 * Send payment-declined SMS (e.g. after admin rejects the payment request).
 *
 * @param {string} phone - Sender/payer phone from payment request
 * @param {string} [courseTitle] - Unused; kept for API compatibility
 */
async function sendPaymentDeclinedSms(phone, courseTitle) {
    if (!phone || !String(phone).trim()) return;
    const message = 'Payment declined. Contact support if needed.';
    try {
        const result = await sendSms(phone, message);
        if (result.skipped) return;
        if (!result.sent) {
            console.warn('SMS (payment declined) not sent:', result.reason || result.errorMessage || result.responseCode);
        }
    } catch (err) {
        console.error('SMS (payment declined) error:', err.message);
    }
}

module.exports = {
    sendSms,
    sendPaymentPendingSms,
    sendPaymentAcceptedSms,
    sendPaymentDeclinedSms,
    normalizePhone,
};
