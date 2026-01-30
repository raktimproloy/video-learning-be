const crypto = require('crypto');
require('dotenv').config();

const NGINX_SECRET = process.env.NGINX_SECRET || 'YOUR_SHARED_SECRET_FROM_ENV';

/**
 * Simulates the Nginx secure_link_md5 verification logic.
 * Nginx Config: secure_link_md5 "$arg_expires$uri $secret";
 * Node Logic: md5(expires + uri + " " + secret)
 */
function verifyNginxSignature(uri, queryParams) {
    const { md5: providedMd5, expires } = queryParams;

    if (!providedMd5 || !expires) {
        return { valid: false, reason: 'Missing signature or expiration' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (parseInt(expires) < now) {
        return { valid: false, reason: 'Link expired' };
    }

    // Reconstruct input string to match Nginx config
    // Note: URI usually includes the leading slash, e.g., /videos/course1/master.m3u8
    const input = `${expires}${uri} ${NGINX_SECRET}`;
    
    const calculatedMd5 = crypto.createHash('md5')
        .update(input)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    if (calculatedMd5 === providedMd5) {
        return { valid: true };
    } else {
        return { valid: false, reason: 'Invalid signature', expected: calculatedMd5, actual: providedMd5 };
    }
}

module.exports = { verifyNginxSignature };
