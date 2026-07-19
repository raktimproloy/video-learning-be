const userService = require('../services/userService');
const teacherProfileService = require('../services/teacherProfileService');
const sessionService = require('../services/sessionService');
const moderationService = require('../services/moderationService');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { validationResult } = require('express-validator');
const { isStaffEmailAddress, staffEmailBlockedMessage } = require('../utils/staffEmail');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const PENDING_SESSION_TOKEN_TTL_SECONDS = parseInt(process.env.PENDING_SESSION_TOKEN_TTL_SECONDS || '300', 10);

function publicSessionSummary(row) {
    return {
        id: row.id,
        deviceLabel: row.device_label,
        deviceType: row.device_type,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
    };
}

/**
 * Shared login-completion logic used by password login, Google login, and the
 * "free a device slot" continuation. Enforces the account-suspension check and
 * the max-concurrent-device cap, records the new session, and runs abuse
 * detection. Returns { status, body } for the caller to send directly.
 */
async function issueSession(user, req) {
    if (user.status === 'suspended') {
        return {
            status: 403,
            body: { error: 'ACCOUNT_SUSPENDED', reason: user.suspended_reason || 'Your account has been suspended.' },
        };
    }

    const deviceId = typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].trim() : '';
    const activeSessions = await sessionService.countActive(user.id);

    const sameDeviceSession = deviceId ? activeSessions.find((s) => s.device_id === deviceId) : null;
    if (sameDeviceSession) {
        await sessionService.revoke(sameDeviceSession.id, 'superseded');
    } else if (activeSessions.length >= sessionService.maxConcurrentDevices) {
        const pendingToken = jwt.sign({ id: user.id, purpose: 'free_slot' }, JWT_SECRET, {
            expiresIn: PENDING_SESSION_TOKEN_TTL_SECONDS,
        });
        return {
            status: 409,
            body: {
                error: 'DEVICE_LIMIT_REACHED',
                message: 'You are already logged in on the maximum number of devices. Log out one to continue.',
                maxDevices: sessionService.maxConcurrentDevices,
                sessions: activeSessions.map(publicSessionSummary),
                pendingToken,
            },
        };
    }

    const jti = crypto.randomUUID();
    const expiresInSeconds = 7 * 24 * 60 * 60;
    const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role || 'student', jti },
        JWT_SECRET,
        { expiresIn: expiresInSeconds }
    );
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    await sessionService.create({ userId: user.id, jti, deviceId: deviceId || jti, req, expiresAt });

    let warning = null;
    try {
        const evaluation = await moderationService.evaluateDeviceAbuse(user.id);
        if (evaluation?.action === 'warning') {
            warning = evaluation.message;
        } else if (evaluation?.action === 'suspended') {
            // Suspended as a direct result of this very login — reject it immediately.
            return {
                status: 403,
                body: { error: 'ACCOUNT_SUSPENDED', reason: evaluation.message },
            };
        }
    } catch (evalErr) {
        console.error('Device abuse evaluation error:', evalErr);
    }

    return { status: 200, body: { token, warning } };
}

/**
 * Re-signs the JWT with a new role for the caller's *existing* device session
 * (join-teacher / switch-role). Reuses the same user_sessions row in place so
 * a role change never consumes an extra device slot. Falls back to minting a
 * brand-new tracked session if the old one can't be found (e.g. a legacy
 * pre-session token), rather than issuing an untracked token.
 */
async function reissueTokenForRoleChange(req, updatedUser) {
    const jti = crypto.randomUUID();
    const expiresInSeconds = 7 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const token = jwt.sign(
        { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role, jti },
        JWT_SECRET,
        { expiresIn: expiresInSeconds }
    );

    const existing = req.user?.jti ? await sessionService.findByJti(req.user.jti) : null;
    if (existing) {
        await sessionService.reissue(existing.id, { jti, expiresAt });
        const ttlCache = require('../utils/ttlCache');
        ttlCache.delete(`session:${req.user.jti}`);
    } else {
        await sessionService.create({ userId: updatedUser.id, jti, deviceId: jti, req, expiresAt });
    }
    return token;
}

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

            if (isStaffEmailAddress(email)) {
                return res.status(400).json({ error: staffEmailBlockedMessage() });
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
            if (error.status === 400) {
                return res.status(400).json({ error: error.message });
            }
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

            // Enforce suspension / device-limit / issue session token
            const sessionResult = await issueSession(user, req);
            if (sessionResult.status !== 200) {
                return res.status(sessionResult.status).json(sessionResult.body);
            }

            const needsProfileCompletion = user.onboarding_completed === false;

            res.json({
                token: sessionResult.body.token,
                warning: sessionResult.body.warning || undefined,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role || 'student',
                    name: user.name || null,
                    coreMember: !!user.core_member,
                    onboardingCompleted: !!user.onboarding_completed,
                    onboardingRole: user.onboarding_role || null,
                    onboardingCategory: user.onboarding_category || null,
                    mustChangePassword: !!user.must_change_password,
                },
                needsProfileCompletion,
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Continuation of a blocked login: the client picked a device session to
     * free up (from the DEVICE_LIMIT_REACHED response) and presents the
     * short-lived pendingToken instead of credentials.
     */
    async freeSlotAndLogin(req, res) {
        const authHeader = req.headers.authorization;
        const pendingToken = authHeader ? authHeader.split(' ')[1] : null;
        const { sessionId } = req.body || {};
        if (!pendingToken || !sessionId) {
            return res.status(400).json({ error: 'sessionId and a valid pendingToken are required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(pendingToken, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Your session selection has expired. Please log in again.' });
        }
        if (decoded.purpose !== 'free_slot' || !decoded.id) {
            return res.status(401).json({ error: 'Invalid session token' });
        }

        try {
            const user = await userService.findById(decoded.id);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const revoked = await sessionService.revoke(sessionId, 'slot_freed');
            if (!revoked || revoked.user_id !== user.id) {
                return res.status(400).json({ error: 'That device session could not be freed. Please try again.' });
            }

            const sessionResult = await issueSession(user, req);
            if (sessionResult.status !== 200) {
                return res.status(sessionResult.status).json(sessionResult.body);
            }

            const needsProfileCompletion = user.onboarding_completed === false;
            res.json({
                token: sessionResult.body.token,
                warning: sessionResult.body.warning || undefined,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role || 'student',
                    name: user.name || null,
                    coreMember: !!user.core_member,
                    onboardingCompleted: !!user.onboarding_completed,
                    onboardingRole: user.onboarding_role || null,
                    onboardingCategory: user.onboarding_category || null,
                    mustChangePassword: !!user.must_change_password,
                },
                needsProfileCompletion,
            });
        } catch (error) {
            console.error('Free slot login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async logout(req, res) {
        try {
            if (req.user?.jti) {
                await sessionService.revoke((await sessionService.findByJti(req.user.jti))?.id, 'user_logout');
                const ttlCache = require('../utils/ttlCache');
                ttlCache.delete(`session:${req.user.jti}`);
            }
            res.json({ success: true });
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async listSessions(req, res) {
        try {
            const sessions = await sessionService.listForUser(req.user.id);
            res.json({ sessions });
        } catch (error) {
            console.error('List sessions error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async revokeSession(req, res) {
        try {
            const { id } = req.params;
            const sessions = await sessionService.listForUser(req.user.id);
            const owned = sessions.find((s) => s.id === id);
            if (!owned) {
                return res.status(404).json({ error: 'Session not found' });
            }
            await sessionService.revoke(id, 'user_logout');
            res.json({ success: true });
        } catch (error) {
            console.error('Revoke session error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async joinTeacher(req, res) {
        try {
            const userId = req.user.id;
            const { referral_code } = req.body || {};

            const user = await userService.findById(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found. You might be logged in as a different type of account.' });
            }
            if (user.role === 'teacher') {
                return res.status(400).json({ error: 'You are already a teacher' });
            }
            if (user.role === 'teacher_staff') {
                return res.status(403).json({ error: 'Staff accounts cannot join as an independent teacher.' });
            }

            // Check if referral_code is valid
            let referredBy = null;
            if (referral_code) {
                const db = require('../../db');
                const marketerRes = await db.query('SELECT id FROM marketers WHERE referral_code = $1', [referral_code]);
                if (marketerRes.rows.length > 0) {
                    referredBy = marketerRes.rows[0].id;
                }
            }

            // Update role to teacher
            const updatedUser = await userService.updateRole(userId, 'teacher');

            // Create teacher profile with default avatar
            await teacherProfileService.createProfile(userId);

            // If referred, update the referred_by field
            if (referredBy) {
                const db = require('../../db');
                await db.query('UPDATE teacher_profiles SET referred_by = $1 WHERE user_id = $2', [referredBy, userId]);
            }

            // Reissue the JWT with the updated role, keeping the same device session
            // (a role switch must not consume a second device slot).
            const token = await reissueTokenForRoleChange(req, updatedUser);

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

            // Get current user to check their actual role in database
            const user = await userService.findById(userId);
            if (user?.role === 'teacher_staff') {
                return res.status(403).json({ error: 'Staff accounts cannot switch roles.' });
            }

            // Validate role
            if (role !== 'student' && role !== 'teacher') {
                return res.status(400).json({ error: 'Invalid role. Must be "student" or "teacher"' });
            }

            // Get current user to check their actual role in database
            // (already loaded above)
            
            // Check if user is trying to switch to teacher
            if (role === 'teacher') {
                const teacherProfile = await userService.getTeacherProfile(userId);
                if (!teacherProfile) {
                    return res.status(403).json({ error: 'You must join as a teacher first' });
                }
                // Update role to teacher in database
                const updatedUser = await userService.updateRole(userId, 'teacher');

                // Reissue token in-place with teacher role (same device session)
                const token = await reissueTokenForRoleChange(req, updatedUser);

                return res.json({
                    message: `Role switched to teacher`,
                    token,
                    user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role }
                });
            } else {
                // Switching to student - update database role to student
                const updatedUser = await userService.updateRole(userId, 'student');

                // Reissue token in-place with student role (same device session)
                const token = await reissueTokenForRoleChange(req, updatedUser);

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

            if (isStaffEmailAddress(email)) {
                return res.status(400).json({ error: staffEmailBlockedMessage() });
            }

            // 4. Find or create user and issue app JWT
            const user = await userService.findOrCreateByGoogle(googleId, email, name || null);

            // If user signed in with Google, mark teacher account email as verified (same email)
            await teacherProfileService.markAccountEmailVerifiedIfGoogle(user.id, user.email);

            const sessionResult = await issueSession(user, req);
            if (sessionResult.status !== 200) {
                return res.status(sessionResult.status).json(sessionResult.body);
            }

            const needsProfileCompletion = user.onboarding_completed === false;

            res.json({
                token: sessionResult.body.token,
                warning: sessionResult.body.warning || undefined,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role || 'student',
                    name: user.name || null,
                    coreMember: !!user.core_member,
                    onboardingCompleted: !!user.onboarding_completed,
                    onboardingRole: user.onboarding_role || null,
                    onboardingCategory: user.onboarding_category || null,
                },
                needsProfileCompletion,
            });
        } catch (err) {
            if (err.status === 400 && err.message) {
                return res.status(400).json({ error: err.message });
            }
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
            await teacherProfileService.markAccountEmailVerifiedIfGoogle(userId, currentUser.email);
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
                name: user.name || null,
                linkedGoogle: !!user.google_id,
                coreMember: !!user.core_member,
                onboardingCompleted: !!user.onboarding_completed,
                onboardingRole: user.onboarding_role || null,
                onboardingCategory: user.onboarding_category || null,
                mustChangePassword: !!user.must_change_password,
            };

            // Always check if teacher profile exists, regardless of current role
            // This allows users who joined as teacher to see their teacher data
            // even if they're currently in student mode (after switching)
            let profileUserId = userId;
            if (user.role === 'teacher_staff') {
                const teacherStaffService = require('../services/teacherStaffService');
                const membership = await teacherStaffService.getActiveMembershipByStaffUserId(userId);
                if (membership) {
                    profileUserId = membership.teacher_id;
                    userData.teacherStaff = {
                        teacherId: membership.teacher_id,
                        permissions: membership.permissions,
                        displayName: membership.display_name,
                        status: membership.status,
                    };
                }
            }

            const teacherProfile = await userService.getTeacherProfile(profileUserId);
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
            }

            res.json(userData);
        } catch (error) {
            console.error('Get current user error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AuthController();
