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
            const { email, password } = req.body;

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

    async joinTeacher(req, res) {
        try {
            const userId = req.user.id;
            
            // Check if user is already a teacher
            const user = await userService.findById(userId);
            if (user.role === 'teacher') {
                return res.status(400).json({ error: 'You are already a teacher' });
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
                // Check if user has teacher profile (they joined as teacher)
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
                role: user.role || 'student'
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
