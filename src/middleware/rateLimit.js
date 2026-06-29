const rateLimit = require('express-rate-limit');

/** Standard JSON error for rate-limited requests */
function rateLimitHandler(_req, res) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
}

/** Auth endpoints — brute-force protection */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: () => process.env.RATE_LIMIT_ENABLED === 'false',
});

/** Analytics heartbeat — high volume but abusable */
const analyticsHeartbeatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_ANALYTICS_MAX || '120', 10),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: () => process.env.RATE_LIMIT_ENABLED === 'false',
});

/** General API per IP */
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_API_MAX || '300', 10),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: () => process.env.RATE_LIMIT_ENABLED === 'false',
});

module.exports = {
    authLimiter,
    analyticsHeartbeatLimiter,
    apiLimiter,
};
