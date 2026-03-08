/**
 * SMS service for sending OTP to phone numbers.
 * Uses BulkSMS BD (bulksmsbd.net) when BULKSMS_API_KEY and BULKSMS_SENDER_ID are set.
 * Otherwise logs OTP to console (development).
 */

const bulkSms = require('../utils/smsService');

const isConfigured = !!(process.env.BULKSMS_API_KEY && process.env.BULKSMS_SENDER_ID);

/**
 * Send OTP to the given phone number.
 * @param {string} to - Phone number (e.g. 01712345678 or 8801712345678)
 * @param {string} otp - 6-digit OTP
 * @returns {Promise<{ sent: boolean }>}
 */
async function sendOtpSms(to, otp) {
    const message = `Your verification code is: ${otp}. Valid for 10 minutes. Do not share.`;

    const result = await bulkSms.sendSms(to, message);

    if (result.sent) {
        return { sent: true };
    }

    if (result.skipped || result.reason?.includes('not configured')) {
        console.log(`[SMS OTP] To: ${to} | Code: ${otp} (BulkSMS not configured – set BULKSMS_API_KEY and BULKSMS_SENDER_ID to send real SMS)`);
        return { sent: false };
    }

    console.warn('[SMS OTP] Send failed:', result.reason || result.errorMessage || result.responseCode);
    return { sent: false };
}

module.exports = {
    sendOtpSms,
    isConfigured,
};
