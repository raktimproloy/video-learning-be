const jwt = require('jsonwebtoken');
const adminUserService = require('../services/adminUserService');

const verifyAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Malformed token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        const admin = await adminUserService.findById(decoded.id);

        if (!admin) {
            return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
        }

        req.admin = admin;
        req.user = admin;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

module.exports = verifyAdmin;
