/**
 * Strict CORS allowlist. Only these origins are allowed for API and media.
 * Include both with and without trailing slash; browser Origin is usually without slash.
 */
const CORS_ALLOWED_ORIGINS = [
    'https://shikkhabhumi.com',
    'https://shikkhabhumi.com/',
    'http://shikkhabhumi.com',
    'http://shikkhabhumi.com/',
    'https://www.shikkhabhumi.com',
    'https://www.shikkhabhumi.com/',
    'http://www.shikkhabhumi.com',
    'http://www.shikkhabhumi.com/',
    'https://principal.shikkhabhumi.com',
    'http://principal.shikkhabhumi.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
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
