/**
 * CORS allowlist for REST API, media streams, and Socket.io.
 *
 * Env:
 *   FRONTEND_URL          — primary site (e.g. https://shikkhabhumi.com)
 *   CORS_EXTRA_ORIGINS    — comma-separated extra origins (Vercel preview URL, etc.)
 */

const DEFAULT_ORIGINS = [
    'https://shikkhabhumi.com',
    'https://www.shikkhabhumi.com',
    'http://shikkhabhumi.com',
    'http://www.shikkhabhumi.com',
    'https://principal.shikkhabhumi.com',
    'http://principal.shikkhabhumi.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
];

/** Subdomain / preview patterns (HTTPS only for wildcards) */
const WILDCARD_PATTERNS = [
    /^https:\/\/[\w-]+\.vercel\.app$/i,
    /^https:\/\/[\w-]+\.shikkhabhumi\.com$/i,
];

function normalizeOrigin(origin) {
    if (!origin || typeof origin !== 'string') return null;
    return origin.trim().replace(/\/$/, '');
}

function parseEnvOrigins() {
    const list = [];
    if (process.env.FRONTEND_URL) {
        list.push(process.env.FRONTEND_URL);
    }
    if (process.env.CORS_EXTRA_ORIGINS) {
        list.push(
            ...process.env.CORS_EXTRA_ORIGINS.split(',')
                .map((s) => s.trim())
                .filter(Boolean),
        );
    }
    return list.map(normalizeOrigin).filter(Boolean);
}

function buildAllowlistSet() {
    const set = new Set();
    for (const o of DEFAULT_ORIGINS) {
        const n = normalizeOrigin(o);
        if (n) set.add(n);
    }
    for (const o of parseEnvOrigins()) {
        set.add(o);
    }
    return set;
}

let allowlistSet = buildAllowlistSet();

function refreshAllowlist() {
    allowlistSet = buildAllowlistSet();
}

function isOriginAllowed(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    if (allowlistSet.has(normalized)) return true;
    return WILDCARD_PATTERNS.some((rx) => rx.test(normalized));
}

/**
 * Returns normalized Origin if allowed, else null.
 */
function getAllowedOrigin(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized || !isOriginAllowed(normalized)) return null;
    return normalized;
}

/** For logging / debugging */
function getAllowlistSnapshot() {
    return [...allowlistSet];
}

module.exports = {
    CORS_ALLOWED_ORIGINS: [...allowlistSet],
    isOriginAllowed,
    getAllowedOrigin,
    getAllowlistSnapshot,
    refreshAllowlist,
};
