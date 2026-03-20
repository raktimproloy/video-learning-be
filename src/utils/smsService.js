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
 * Accepts: 01303644935, +8801303644935, 8801303644935, 1303644935.
 * Output: 880XXXXXXXXXX (13 digits total: 88 + 0 + 10 digits).
 * @param {string} phone - Raw phone input
 * @returns {string|null} - Normalized 880XXXXXXXXXX or null if invalid
 */
function normalizePhone(phone) {
    if (!phone || typeof phone !== 'string') return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return null;
    // Already with country code: +8801303644935 or 8801303644935 -> 13 digits
    if (digits.startsWith('88') && digits.length >= 13) {
        return digits.slice(0, 13);
    }
    if (digits.startsWith('88') && digits.length >= 11) {
        return digits.length > 13 ? digits.slice(0, 13) : digits;
    }
    // Local format with leading 0: 01303644935 (11 digits)
    if (digits.startsWith('0') && digits.length === 11) {
        return '88' + digits;
    }
    // 10 digits without 0: 1303644935 -> assume Bangladesh mobile 01303644935
    if (digits.length === 10 && digits.startsWith('1')) {
        return '880' + digits;
    }
    // 11 digits without leading 0 (e.g. 13036449351) – treat as 0 + 10 digits for BD
    if (digits.length === 11) {
        return '88' + digits;
    }
    if (digits.length === 10) {
        return '880' + digits;
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

/**
 * Send admin alert SMS when a new payment request is submitted.
 *
 * @param {string} phone - Admin receiver phone
 * @param {{ requestId?: string, courseId?: string, amount?: number|string, currency?: string, method?: string }} payload
 */
async function sendNewPaymentRequestAlertSms(phone, payload = {}) {
    if (!phone || !String(phone).trim()) return;
    const method = payload.method ? String(payload.method).toUpperCase() : 'UNKNOWN';
    const amount =
        payload.amount != null && !Number.isNaN(Number(payload.amount))
            ? Number(payload.amount).toFixed(2)
            : null;
    const currency = payload.currency ? String(payload.currency).toUpperCase() : 'BDT';
    const amountPart = amount ? `${amount} ${currency}` : currency;
    const message = `Request added - ${amountPart} - ${method}`;

    try {
        const result = await sendSms(phone, message);
        if (result.skipped) return;
        if (!result.sent) {
            console.warn('SMS (new payment request alert) not sent:', result.reason || result.errorMessage || result.responseCode);
        }
    } catch (err) {
        console.error('SMS (new payment request alert) error:', err.message);
    }
}

module.exports = {
    sendSms,
    sendPaymentPendingSms,
    sendPaymentAcceptedSms,
    sendPaymentDeclinedSms,
    sendNewPaymentRequestAlertSms,
    normalizePhone,
};
