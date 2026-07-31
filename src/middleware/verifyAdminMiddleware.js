const jwt = require('jsonwebtoken');
const adminUserService = require('../services/adminUserService');

const verifyAdmin = async (req, res, next) => {
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
        const admin = await adminUserService.findById(decoded.id);

        if (!admin) {
            return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
        }
        if (admin.status === 'suspended') {
            return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', reason: admin.suspended_reason });
        }

        req.admin = admin;
        req.user = admin;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

module.exports = verifyAdmin;
