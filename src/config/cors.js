/**
 * Strict CORS allowlist. Only these origins are allowed for API and media.
 */
const CORS_ALLOWED_ORIGINS = [
    'https://shikkhabhumi.com',
    'http://shikkhabhumi.com',
    'https://principal.shikkhabhumi.com',
    'http://principal.shikkhabhumi.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
];

/**
 * Returns the request Origin if it is in the allowlist; otherwise null.
 * Use when setting Access-Control-Allow-Origin on specific responses (e.g. media streams).
 */
function getAllowedOrigin(origin) {
    if (!origin) return null;
    return CORS_ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

module.exports = { CORS_ALLOWED_ORIGINS, getAllowedOrigin };
