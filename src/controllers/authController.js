const userService = require('../services/userService');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { validationResult } = require('express-validator');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

class AuthController {
    async register(req, res) {
        // Validation check
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const password = req.body.password;
            if (!email) {
                return res.status(400).json({ error: 'Valid email is required' });
            }

            // Check if user exists
            const existingUser = await userService.findByEmail(email);
            if (existingUser) {
                return res.status(400).json({ error: 'User already exists' });
            }

            // Create user - all users start as 'student' by default
            // They can join as teacher later via join-teacher endpoint
            const user = await userService.createUser(email, password);
            res.status(201).json({ 
                message: 'User created successfully. You can join as a teacher anytime from your profile.',
                user: { id: user.id, email: user.email, role: user.role }
            });
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
            const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const password = req.body.password;
            if (!email) {
                return res.status(400).json({ error: 'Valid email is required' });
            }

            // Find user
            const user = await userService.findByEmail(email);
            if (!user) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }
            if (!user.password_hash) {
                return res.status(400).json({ error: 'This account uses Google sign-in. Please use Continue with Google.' });
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

    async joinTeacher(req, res) {
        try {
            const userId = req.user.id;

            const user = await userService.findById(userId);
            if (user.role === 'teacher') {
                return res.status(400).json({ error: 'You are already a teacher' });
            }
            // Teachers must have a linked Gmail account (verification)
            if (!user.google_id) {
                return res.status(403).json({
                    error: 'Please link your Gmail account to become a teacher.',
                    code: 'GMAIL_LINK_REQUIRED'
                });
            }

            // Update role to teacher
            const updatedUser = await userService.updateRole(userId, 'teacher');

            // Create teacher profile with dummy data
            const emailName = user.email.split('@')[0];
            const capitalizedName = emailName.charAt(0).toUpperCase() + emailName.slice(1);
            
            await userService.createTeacherProfile(userId, {
                name: capitalizedName,
                bio: `Experienced educator passionate about sharing knowledge and helping students succeed. Join me on this learning journey!`,
                location: 'Online',
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(capitalizedName)}&background=random&size=200`,
                specialization: ['General Education', 'Online Teaching'],
                experience: '1+ years',
                certifications: ['Teaching Certificate']
            });

            // Generate new token with updated role
            const token = jwt.sign(
                { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role },
                process.env.JWT_SECRET || 'your_jwt_secret',
                { expiresIn: '24h' }
            );

            res.json({ 
                message: 'Successfully joined as teacher',
                token,
                user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role }
            });
        } catch (error) {
            console.error('Join teacher error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async switchRole(req, res) {
        try {
            const userId = req.user.id;
            const { role } = req.body;

            // Validate role
            if (role !== 'student' && role !== 'teacher') {
                return res.status(400).json({ error: 'Invalid role. Must be "student" or "teacher"' });
            }

            // Get current user to check their actual role in database
            const user = await userService.findById(userId);
            
            // Check if user is trying to switch to teacher
            if (role === 'teacher') {
                if (!user.google_id) {
                    return res.status(403).json({
                        error: 'Please link your Gmail account first.',
                        code: 'GMAIL_LINK_REQUIRED'
                    });
                }
                const teacherProfile = await userService.getTeacherProfile(userId);
                if (!teacherProfile) {
                    return res.status(403).json({ error: 'You must join as a teacher first' });
                }
                // Update role to teacher in database
                const updatedUser = await userService.updateRole(userId, 'teacher');
                
                // Generate new token with teacher role
                const token = jwt.sign(
                    { id: updatedUser.id, email: updatedUser.email, role: 'teacher' },
                    process.env.JWT_SECRET || 'your_jwt_secret',
                    { expiresIn: '24h' }
                );

                return res.json({ 
                    message: `Role switched to teacher`,
                    token,
                    user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role }
                });
            } else {
                // Switching to student - update database role to student
                const updatedUser = await userService.updateRole(userId, 'student');
                
                // Generate new token with student role
                const token = jwt.sign(
                    { id: updatedUser.id, email: updatedUser.email, role: 'student' },
                    process.env.JWT_SECRET || 'your_jwt_secret',
                    { expiresIn: '24h' }
                );

                return res.json({ 
                    message: `Role switched to student`,
                    token,
                    user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role }
                });
            }
        } catch (error) {
            console.error('Switch role error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Google OAuth: frontend sends the authorization code. Backend exchanges code for tokens,
     * verifies the ID token with Google (signature, audience, expiry), validates userinfo,
     * then finds or creates the user and returns JWT + user. No client-supplied identity is trusted.
     */
    async postGoogleAuth(req, res) {
        if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
            return res.status(503).json({ error: 'Google sign-in is not configured' });
        }
        const { code, redirectUri } = req.body || {};
        if (!code || typeof redirectUri !== 'string' || !redirectUri.trim()) {
            return res.status(400).json({ error: 'code and redirectUri are required' });
        }

        try {
            // 1. Exchange authorization code for tokens (id_token + access_token)
            const tokenRes = await axios.post(
                'https://oauth2.googleapis.com/token',
                new URLSearchParams({
                    code: code.trim(),
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: redirectUri.trim(),
                    grant_type: 'authorization_code',
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const idToken = tokenRes.data?.id_token;
            if (!idToken) {
                console.error('Google token response missing id_token');
                return res.status(401).json({ error: 'Google sign-in failed: invalid response' });
            }

            // 2. Verify ID token (signature, audience, expiration) — do not trust client data
            const oauth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
            let ticket;
            try {
                ticket = await oauth2Client.verifyIdToken({
                    idToken,
                    audience: GOOGLE_CLIENT_ID,
                });
            } catch (verifyErr) {
                console.error('Google ID token verification failed:', verifyErr.message);
                return res.status(401).json({ error: 'Google sign-in failed: invalid or expired token' });
            }

            const payload = ticket.getPayload();
            if (!payload) {
                console.error('Google ID token has no payload');
                return res.status(401).json({ error: 'Google sign-in failed' });
            }

            // 3. Validate required claims (sub = Google user id, email)
            const { sub: googleId, email, email_verified, name } = payload;
            if (!googleId || !email) {
                console.error('Google ID token missing sub or email');
                return res.status(401).json({ error: 'Google sign-in failed: missing identity' });
            }
            if (email_verified === false) {
                console.error('Google email not verified');
                return res.status(403).json({ error: 'Google email must be verified' });
            }

            // 4. Find or create user and issue app JWT
            const user = await userService.findOrCreateByGoogle(googleId, email, name || null);
            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role || 'student' },
                process.env.JWT_SECRET || 'your_jwt_secret',
                { expiresIn: '24h' }
            );
            res.json({ token, user: { id: user.id, email: user.email, role: user.role || 'student' } });
        } catch (err) {
            const status = err.response?.status;
            const data = err.response?.data;
            if (status === 400 && data) {
                // Google returns 400 with error_description e.g. "redirect_uri_mismatch" or "Bad Request" (code already used)
                const reason = data.error_description || data.error || 'invalid or expired code';
                console.error('Google token exchange failed:', reason, data);
                return res.status(401).json({
                    error: 'Google sign-in failed: invalid or expired code',
                    hint: typeof reason === 'string' ? reason : undefined,
                });
            }
            console.error('Google OAuth error:', data || err.message);
            res.status(401).json({ error: 'Google sign-in failed' });
        }
    }

    /**
     * Link Gmail to the current user (for teachers who signed up with email/password).
     * Requires auth. Exchanges code with Google, verifies ID token, ensures Google email
     * matches the account email, then sets google_id on the user.
     */
    async postLinkGoogle(req, res) {
        if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
            return res.status(503).json({ error: 'Google sign-in is not configured' });
        }
        const { code, redirectUri } = req.body || {};
        if (!code || typeof redirectUri !== 'string' || !redirectUri.trim()) {
            return res.status(400).json({ error: 'code and redirectUri are required' });
        }
        const userId = req.user.id;
        const currentUser = await userService.findById(userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        try {
            const tokenRes = await axios.post(
                'https://oauth2.googleapis.com/token',
                new URLSearchParams({
                    code: code.trim(),
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: redirectUri.trim(),
                    grant_type: 'authorization_code',
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const idToken = tokenRes.data?.id_token;
            if (!idToken) {
                return res.status(401).json({ error: 'Invalid Google response' });
            }

            const oauth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
            let ticket;
            try {
                ticket = await oauth2Client.verifyIdToken({
                    idToken,
                    audience: GOOGLE_CLIENT_ID,
                });
            } catch (verifyErr) {
                return res.status(401).json({ error: 'Invalid or expired Google sign-in' });
            }

            const payload = ticket.getPayload();
            const { sub: googleId, email: googleEmail, email_verified } = payload || {};
            if (!googleId || !googleEmail) {
                return res.status(401).json({ error: 'Could not get Gmail from Google' });
            }
            if (email_verified === false) {
                return res.status(403).json({ error: 'Gmail must be verified' });
            }

            const accountEmail = (currentUser.email || '').trim().toLowerCase();
            const gmail = (googleEmail || '').trim().toLowerCase();
            if (accountEmail !== gmail) {
                return res.status(400).json({
                    error: 'Gmail must match your account email. Sign in with the same email you use on this site.'
                });
            }

            await userService.linkGoogle(userId, googleId);
            return res.json({ success: true, linkedGoogle: true });
        } catch (err) {
            if (err.response?.status === 400) {
                return res.status(401).json({ error: 'Invalid or expired code. Please try linking again.' });
            }
            console.error('Link Google error:', err.response?.data || err.message);
            return res.status(401).json({ error: 'Failed to link Gmail' });
        }
    }

    async getCurrentUser(req, res) {
        try {
            const userId = req.user.id;
            const user = await userService.findById(userId);
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const userData = { 
                id: user.id, 
                email: user.email, 
                role: user.role || 'student',
                linkedGoogle: !!user.google_id
            };

            // Always check if teacher profile exists, regardless of current role
            // This allows users who joined as teacher to see their teacher data
            // even if they're currently in student mode (after switching)
            const teacherProfile = await userService.getTeacherProfile(userId);
            if (teacherProfile) {
                userData.teacherProfile = {
                    name: teacherProfile.name,
                    bio: teacherProfile.bio,
                    location: teacherProfile.location,
                    avatar: teacherProfile.avatar,
                    specialization: typeof teacherProfile.specialization === 'string' 
                        ? JSON.parse(teacherProfile.specialization) 
                        : teacherProfile.specialization || [],
                    experience: teacherProfile.experience,
                    certifications: typeof teacherProfile.certifications === 'string'
                        ? JSON.parse(teacherProfile.certifications)
                        : teacherProfile.certifications || [],
                    created_at: teacherProfile.created_at,
                    updated_at: teacherProfile.updated_at
                };
                // Don't auto-update role - keep the role as it is in database
                // User can switch roles via switch-role API
            }

            res.json(userData);
        } catch (error) {
            console.error('Get current user error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AuthController();
