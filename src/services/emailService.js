/**
 * Email service via nodemailer SMTP. Use your email provider with an app password.
 * Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (app password from your email provider).
 */

const nodemailer = require('nodemailer');

const SITE_NAME = process.env.SITE_NAME || 'Learning Platform';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = (process.env.SMTP_USER || '').trim();
// App passwords: strip quotes if present, remove spaces (Gmail shows "xxxx xxxx xxxx xxxx")
const SMTP_PASS = (process.env.SMTP_PASS || '').replace(/^["']|["']$/g, '').replace(/\s+/g, '').trim();
const MAIL_FROM = (process.env.MAIL_FROM || SMTP_USER || 'noreply@example.com').trim();
const MAIL_FROM_NAME = (process.env.MAIL_FROM_NAME || SITE_NAME || '').trim();

const SMTP_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
const isConfigured = SMTP_ENABLED;

let transporter = null;
if (SMTP_ENABLED) {
    // Port 587 = STARTTLS (secure: false). Port 465 = TLS (secure: true).
    const secure = SMTP_PORT === 465 || SMTP_SECURE;
    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
        },
    });
}

/**
 * Generate a random 6-digit OTP (numeric string).
 */
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Build "from" field: "Name <email>" or just email to avoid encoding issues.
 */
function getFromAddress() {
    if (!MAIL_FROM) return undefined;
    if (MAIL_FROM_NAME && /^[\x00-\x7F]*$/.test(MAIL_FROM_NAME)) {
        return `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`;
    }
    return MAIL_FROM;
}

/**
 * Send OTP to the given email address via SMTP.
 * @param {string} to - Recipient email
 * @param {string} otp - 6-digit OTP
 * @param {string} [purpose] - e.g. 'account email', 'support email'
 * @returns {Promise<{ sent: boolean }>}
 */
async function sendOtpEmail(to, otp, purpose = 'verification') {
    const subject = `${SITE_NAME} – Your verification code`;
    const html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Verification code</h2>
            <p>Use this code to verify your ${purpose}:</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 16px 0;">${otp}</p>
            <p style="color: #666;">This code expires in 10 minutes. Do not share it with anyone.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request this code, you can ignore this email.</p>
        </div>
    `;
    const text = `Your ${SITE_NAME} verification code is: ${otp}. It expires in 10 minutes.`;

    if (!transporter) {
        console.log(`[Email OTP] To: ${to} | Code: ${otp} (Set SMTP_HOST, SMTP_USER, SMTP_PASS to send real emails)`);
        return { sent: false };
    }

    const toAddress = (to || '').trim().toLowerCase();
    if (!toAddress) {
        console.error('[Email OTP] No recipient address');
        return { sent: false };
    }

    try {
        await transporter.sendMail({
            from: getFromAddress(),
            to: toAddress,
            subject,
            text,
            html,
        });
        return { sent: true };
    } catch (err) {
        console.error('[Email OTP] SMTP send failed:', err.message);
        if (err.response) console.error('[Email OTP] Response:', err.response);
        return { sent: false };
    }
}

module.exports = {
    generateOtp,
    sendOtpEmail,
    isConfigured,
};
