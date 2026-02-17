const jwt = require('jsonwebtoken');

/**
 * Optional authentication middleware - doesn't fail if no token is provided
 * Sets req.user if token is valid, otherwise continues without setting it
 */
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        // No token provided - continue as public user
        return next();
    }

    // Assuming format "Bearer <token>"
    const token = authHeader.split(' ')[1];

    if (!token) {
        // Malformed token - continue as public user
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        req.user = decoded;
        next();
    } catch (err) {
        // Invalid or expired token - continue as public user
        next();
    }
};

module.exports = optionalAuth;
