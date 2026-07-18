const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
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

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
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
