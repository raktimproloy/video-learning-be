const userService = require('../services/userService');
const db = require('../../db');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

// Helper to generate a memorable referral code
const generateReferralCode = (name) => {
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
    const randomChars = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${cleanName}-${randomChars}`;
};

class ReferenceAuthController {
    async register(req, res) {
        try {
            const { name, email, phone, password } = req.body;

            if (!name || !email || !phone || !password) {
                return res.status(400).json({ error: 'Name, email, phone, and password are required' });
            }

            // Check if marketer exists
            const emailCheck = await db.query('SELECT id FROM marketers WHERE email = $1', [email.trim().toLowerCase()]);
            if (emailCheck.rows.length > 0) {
                return res.status(400).json({ error: 'Email already registered as a marketer' });
            }

            const phoneCheck = await db.query('SELECT id FROM marketers WHERE phone = $1', [phone]);
            if (phoneCheck.rows.length > 0) {
                return res.status(400).json({ error: 'Phone number already registered as a marketer' });
            }

            // Generate unique referral code
            let referralCode = generateReferralCode(name);
            let codeExists = true;
            while (codeExists) {
                const checkRes = await db.query('SELECT 1 FROM marketers WHERE referral_code = $1', [referralCode]);
                if (checkRes.rows.length === 0) {
                    codeExists = false;
                } else {
                    referralCode = generateReferralCode(name);
                }
            }

            // Hash password
            const bcrypt = require('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);

            // Create marketer
            const marketerResult = await db.query(
                'INSERT INTO marketers (name, email, phone, password_hash, referral_code) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, phone, referral_code',
                [name, email.trim().toLowerCase(), phone, passwordHash, referralCode]
            );
            
            const marketer = marketerResult.rows[0];

            const token = jwt.sign(
                { id: marketer.id, email: marketer.email, role: 'marketer' },
                process.env.JWT_SECRET || 'your_jwt_secret',
                { expiresIn: '7d' }
            );

            res.status(201).json({ 
                message: 'Marketer account created successfully.',
                user: { id: marketer.id, email: marketer.email, role: 'marketer', name: marketer.name, referralCode: marketer.referral_code },
                token
            });

        } catch (error) {
            console.error('Reference Registration error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async login(req, res) {
        try {
            let { email, phone, password } = req.body;
            
            let marketer;
            if (phone) {
                const marketerRes = await db.query('SELECT * FROM marketers WHERE phone = $1', [phone]);
                marketer = marketerRes.rows[0];
            } else if (email) {
                const marketerRes = await db.query('SELECT * FROM marketers WHERE email = $1', [email.trim().toLowerCase()]);
                marketer = marketerRes.rows[0];
            }
            
            if (!marketer) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }

            // Check password
            const bcrypt = require('bcryptjs');
            const isMatch = await bcrypt.compare(password, marketer.password_hash);
            if (!isMatch) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }

            // Generate Token
            const token = jwt.sign(
                { id: marketer.id, email: marketer.email, role: 'marketer' },
                process.env.JWT_SECRET || 'your_jwt_secret',
                { expiresIn: '7d' }
            );

            res.json({
                token,
                user: {
                    id: marketer.id,
                    email: marketer.email,
                    role: 'marketer',
                    name: marketer.name,
                    referralCode: marketer.referral_code
                }
            });
        } catch (error) {
            console.error('Reference Login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new ReferenceAuthController();
