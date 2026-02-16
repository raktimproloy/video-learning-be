const userService = require('../services/userService');

const requireRole = (allowedRoles) => {
    return async (req, res, next) => {
        try {
            // Get user from database to check actual role
            const user = await userService.findById(req.user.id);
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Check if user's role is in allowed roles
            if (!allowedRoles.includes(user.role)) {
                return res.status(403).json({ 
                    error: `Access denied. This route requires one of these roles: ${allowedRoles.join(', ')}` 
                });
            }

            // Attach user object with actual role from database
            req.user.role = user.role;
            next();
        } catch (error) {
            console.error('Role middleware error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    };
};

module.exports = { requireRole };
