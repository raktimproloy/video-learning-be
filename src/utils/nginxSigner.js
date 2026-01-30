const crypto = require('crypto');

/**
 * Generates a signed URL compatible with Nginx secure_link_md5 module.
 * 
 * @param {string} path - The path to the file (e.g., /videos/course_1/lesson_1.m3u8)
 * @param {string} secret - The shared secret key
 * @param {number} expiresInSeconds - How long the link is valid (default 3600)
 * @returns {string} - The full relative URL with query parameters
 */
function generateSecurePath(path, secret, expiresInSeconds = 3600) {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    // Format: expires + path + " " + secret
    const input = `${expires}${path} ${secret}`;
    
    const md5 = crypto.createHash('md5')
        .update(input)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    return `${path}?md5=${md5}&expires=${expires}`;
}

module.exports = { generateSecurePath };
