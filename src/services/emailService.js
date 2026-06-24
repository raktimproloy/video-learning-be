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
            <p style="color: #666;">This code expires in 5 minutes. Do not share it with anyone.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request this code, you can ignore this email.</p>
        </div>
    `;
    const text = `Your ${SITE_NAME} verification code is: ${otp}. It expires in 5 minutes.`;

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

/**
 * Send an email to the teacher notifying them of a new course purchase.
 */
async function sendCoursePurchasedEmail({ teacherEmail, teacherName, courseTitle, amount, currency, studentName, studentEmail }) {
    const subject = `🎉 New Student Enrolled in Your Course: ${courseTitle}`;
    
    // Formatting the price beautifully
    const formattedAmount = `${amount} ${currency}`;
    const dateString = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Course Enrollment</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background-color: #f3f4f6;
                    color: #1f2937;
                    margin: 0;
                    padding: 0;
                    -webkit-font-smoothing: antialiased;
                }
                .email-container {
                    max-width: 600px;
                    margin: 40px auto;
                    background-color: #ffffff;
                    border-radius: 16px;
                    overflow: hidden;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
                    border: 1px solid #e5e7eb;
                }
                .email-header {
                    background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
                    color: #ffffff;
                    padding: 40px 30px;
                    text-align: center;
                    position: relative;
                }
                .email-header h1 {
                    margin: 0;
                    font-size: 26px;
                    font-weight: 800;
                    letter-spacing: -0.5px;
                }
                .email-header p {
                    margin: 8px 0 0 0;
                    font-size: 15px;
                    opacity: 0.9;
                }
                .badge {
                    background-color: rgba(255, 255, 255, 0.2);
                    display: inline-block;
                    padding: 6px 16px;
                    border-radius: 9999px;
                    font-size: 12px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 12px;
                }
                .email-body {
                    padding: 40px 30px;
                }
                .greeting {
                    font-size: 18px;
                    font-weight: 600;
                    margin-bottom: 16px;
                    color: #111827;
                }
                .intro-text {
                    font-size: 15px;
                    line-height: 1.6;
                    color: #4b5563;
                    margin-bottom: 30px;
                }
                .details-card {
                    background-color: #f9fafb;
                    border: 1px solid #f3f4f6;
                    border-radius: 12px;
                    padding: 24px;
                    margin-bottom: 30px;
                }
                .cta-container {
                    text-align: center;
                    margin-top: 35px;
                }
                .cta-button {
                    background-color: #4f46e5;
                    color: #ffffff !important;
                    display: inline-block;
                    padding: 14px 28px;
                    border-radius: 10px;
                    font-size: 15px;
                    font-weight: 600;
                    text-decoration: none;
                    box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);
                    transition: all 0.2s ease;
                }
                .email-footer {
                    background-color: #f9fafb;
                    padding: 24px 30px;
                    text-align: center;
                    border-top: 1px solid #e5e7eb;
                    font-size: 12px;
                    color: #9ca3af;
                }
                .email-footer p {
                    margin: 4px 0;
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="email-header">
                    <span class="badge">Sale Notification</span>
                    <h1>New Course Purchase!</h1>
                    <p>Great news, your student base is growing!</p>
                </div>
                <div class="email-body">
                    <p class="greeting">Hello ${teacherName},</p>
                    <p class="intro-text">
                        Congratulations! A student has just purchased your course. Below are the details of the transaction:
                    </p>
                    
                    <div class="details-card">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr style="border-bottom: 1px dashed #e5e7eb;">
                                <td style="padding: 12px 0; font-size: 13px; font-weight: 600; color: #9ca3af; text-transform: uppercase;">Course Title</td>
                                <td style="padding: 12px 0; font-size: 15px; font-weight: 600; color: #111827; text-align: right;">${courseTitle}</td>
                            </tr>
                            <tr style="border-bottom: 1px dashed #e5e7eb;">
                                <td style="padding: 12px 0; font-size: 13px; font-weight: 600; color: #9ca3af; text-transform: uppercase;">Student Name</td>
                                <td style="padding: 12px 0; font-size: 15px; font-weight: 600; color: #111827; text-align: right;">${studentName}</td>
                            </tr>
                            <tr style="border-bottom: 1px dashed #e5e7eb;">
                                <td style="padding: 12px 0; font-size: 13px; font-weight: 600; color: #9ca3af; text-transform: uppercase;">Student Email</td>
                                <td style="padding: 12px 0; font-size: 14px; color: #4b5563; text-align: right;">${studentEmail}</td>
                            </tr>
                            <tr style="border-bottom: 1px dashed #e5e7eb;">
                                <td style="padding: 12px 0; font-size: 13px; font-weight: 600; color: #9ca3af; text-transform: uppercase;">Purchase Date</td>
                                <td style="padding: 12px 0; font-size: 14px; color: #4b5563; text-align: right;">${dateString}</td>
                            </tr>
                            <tr>
                                <td style="padding: 16px 0 0 0; font-size: 13px; font-weight: 600; color: #9ca3af; text-transform: uppercase;">Earnings</td>
                                <td style="padding: 16px 0 0 0; font-size: 20px; font-weight: 800; color: #4f46e5; text-align: right;">${formattedAmount}</td>
                            </tr>
                        </table>
                    </div>
                    
                    <p class="intro-text" style="margin-bottom: 0;">
                        Keep up the excellent work! You can view your updated revenue details and student registrations inside your dashboard at any time.
                    </p>
                    
                    <div class="cta-container">
                        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/teacher/dashboard" class="cta-button" target="_blank">
                            Go to Teacher Dashboard
                        </a>
                    </div>
                </div>
                <div class="email-footer">
                    <p>This is an automated email from ${SITE_NAME}.</p>
                    <p>&copy; ${new Date().getFullYear()} ${SITE_NAME}. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    const text = `Hello ${teacherName},\n\nCongratulations! A student has purchased your course.\n\nDetails:\nCourse: ${courseTitle}\nStudent: ${studentName} (${studentEmail})\nEarnings: ${formattedAmount}\nDate: ${dateString}\n\nView details in your dashboard: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/teacher/dashboard\n\nBest regards,\n${SITE_NAME} Team`;

    if (!transporter) {
        console.log(`[Email Purchase Alert] To: ${teacherEmail} | Course: ${courseTitle} | Student: ${studentName}`);
        return { sent: false };
    }

    try {
        await transporter.sendMail({
            from: getFromAddress(),
            to: (teacherEmail || '').trim().toLowerCase(),
            subject,
            text,
            html,
        });
        return { sent: true };
    } catch (err) {
        console.error('[Email Purchase Alert] SMTP send failed:', err.message);
        return { sent: false };
    }
}

module.exports = {
    generateOtp,
    sendOtpEmail,
    sendCoursePurchasedEmail,
    isConfigured,
};
