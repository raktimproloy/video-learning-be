const userService = require('../services/userService');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

class AuthController {
    async register(req, res) {
        // Validation check
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { email, password, role } = req.body;

            // Check if user exists
            const existingUser = await userService.findByEmail(email);
            if (existingUser) {
                return res.status(400).json({ error: 'User already exists' });
            }

            // Create user
            const user = await userService.createUser(email, password, role);
            res.status(201).json({ message: 'User created successfully', user });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async login(req, res) {
        // Validation check
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { email, password } = req.body;

            // Find user
            const user = await userService.findByEmail(email);
            if (!user) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }

            // Check password
            const isMatch = await userService.validatePassword(user, password);
            if (!isMatch) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }

            // Generate Token
            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role || 'student' },
                process.env.JWT_SECRET || 'your_jwt_secret',
                { expiresIn: '24h' }
            );

            res.json({ token, user: { id: user.id, email: user.email, role: user.role || 'student' } });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AuthController();
