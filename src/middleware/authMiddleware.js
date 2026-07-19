const jwt = require('jsonwebtoken');
const sessionService = require('../services/sessionService');
const ttlCache = require('../utils/ttlCache');

const SESSION_CACHE_TTL_MS = 15 * 1000;

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    let token;
    if (authHeader) {
        token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Tokens issued before device-session tracking was added have no jti —
    // treat them as revoked so the user simply logs in again (one-time only).
    if (!decoded.jti) {
        return res.status(401).json({ error: 'SESSION_REVOKED' });
    }

    try {
        const state = await ttlCache.getOrSet(
            `session:${decoded.jti}`,
            SESSION_CACHE_TTL_MS,
            () => sessionService.findActiveByJti(decoded.jti)
        );
        if (!state) {
            return res.status(401).json({ error: 'SESSION_REVOKED' });
        }
        if (state.userStatus === 'suspended') {
            return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', reason: state.suspendedReason });
        }
    } catch (err) {
        console.error('Session verification error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }

    req.user = decoded;
    next();
};

/** Optional auth: set req.user if valid token, otherwise continue without req.user */
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token;
    if (authHeader) {
        token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }
    if (!token) return next();
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        req.user = decoded;
    } catch (_) {
        // ignore invalid/expired
    }
    next();
};

module.exports = verifyToken;
module.exports.optional = optionalAuth;
