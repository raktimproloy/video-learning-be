const teacherProfileService = require('../services/teacherProfileService');
const courseService = require('../services/courseService');
const r2Storage = require('../services/r2StorageService');
const userPasswordService = require('../services/userPasswordService');
const multer = require('multer');
const path = require('path');

// Configure multer for profile image upload
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

class TeacherProfileController {
    /**
     * Get public teacher profile (no auth required)
     */
    async getPublicProfile(req, res) {
        try {
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({ error: 'User ID is required' });
            }

            const profile = await teacherProfileService.getPublicProfile(userId);
            
            if (!profile) {
                return res.status(404).json({ error: 'Teacher profile not found' });
            }

            // Enrich profile image URL if exists
            if (profile.profile_image_path) {
                const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(profile.profile_image_path) : null;
                if (publicUrl) {
                    profile.profile_image_url = publicUrl;
                } else if (profile.profile_image_path.startsWith('teachers/')) {
                    const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                    const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                    profile.profile_image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(profile.profile_image_path)}`;
                }
            }

            // Get teacher's courses
            const courses = await courseService.getCoursesByTeacher(userId);
            
            // Enrich courses with thumbnail URLs (route is /v1/courses/media/...)
            const apiBase = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
            const baseUrl = apiBase.replace(/\/v1\/?$/, '');
            const v1Url = baseUrl + (baseUrl.endsWith('/') ? 'v1' : '/v1');
            const enrichedCourses = courses.map(course => {
                let thumbnailUrl = course.thumbnail_url;
                if (!thumbnailUrl && course.thumbnail_path) {
                    if (course.thumbnail_path.startsWith('teachers/')) {
                        thumbnailUrl = `${v1Url}/courses/media/${encodeURIComponent(course.thumbnail_path)}`;
                    } else if (course.thumbnail_path.startsWith('/uploads/')) {
                        thumbnailUrl = `${baseUrl}${course.thumbnail_path}`;
                    }
                }
                return {
                    ...course,
                    thumbnail_url: thumbnailUrl
                };
            });

            // Enrich certificate images
            if (profile.certifications && Array.isArray(profile.certifications)) {
                profile.certifications = profile.certifications.map(cert => {
                    if (cert.image_path) {
                        const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                        const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                        cert.image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(cert.image_path)}`;
                    }
                    return cert;
                });
            }

            res.json({
                ...profile,
                courses: enrichedCourses
            });
        } catch (error) {
            console.error('Get public profile error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get teacher profile (authenticated)
     */
    async getProfile(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            const profile = await teacherProfileService.getProfile(req.user.id);

            // Enrich profile image URL if exists
            if (profile.profile_image_path) {
                const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(profile.profile_image_path) : null;
                if (publicUrl) {
                    profile.profile_image_url = publicUrl;
                } else if (profile.profile_image_path.startsWith('teachers/')) {
                    const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                    const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                    profile.profile_image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(profile.profile_image_path)}`;
                }
            }

            // Enrich certificate images
            if (profile.certifications && Array.isArray(profile.certifications)) {
                profile.certifications = profile.certifications.map(cert => {
                    if (cert.image_path) {
                        const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                        const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                        cert.image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(cert.image_path)}`;
                    }
                    return cert;
                });
            }

            // Get completion percentage
            const completion = await teacherProfileService.getProfileCompletion(req.user.id);
            profile.completion = completion;

            res.json(profile);
        } catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Update teacher profile
     */
    async updateProfile(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            const profileData = {
                name: req.body.name,
                bio: req.body.bio,
                location: req.body.location,
                address: req.body.address,
                institute_name: req.body.institute_name,
                account_email: req.body.account_email,
                support_email: req.body.support_email,
                original_phone: req.body.original_phone,
                support_phone: req.body.support_phone,
                youtube_url: req.body.youtube_url,
                linkedin_url: req.body.linkedin_url,
                facebook_url: req.body.facebook_url,
                twitter_url: req.body.twitter_url,
            };

            // Handle JSON fields - specialization: store as array of strings
            if (req.body.specialization !== undefined) {
                const raw = typeof req.body.specialization === 'string' 
                    ? JSON.parse(req.body.specialization) 
                    : req.body.specialization;
                const arr = Array.isArray(raw) ? raw : [];
                profileData.specialization = arr.map(s => typeof s === 'string' ? s : (s && s.name ? String(s.name) : '')).filter(Boolean);
            }
            if (req.body.education) {
                profileData.education = typeof req.body.education === 'string'
                    ? JSON.parse(req.body.education)
                    : req.body.education;
            }
            if (req.body.experience) {
                profileData.experience = typeof req.body.experience === 'string'
                    ? JSON.parse(req.body.experience)
                    : req.body.experience;
            }
            if (req.body.certifications) {
                profileData.certifications = typeof req.body.certifications === 'string'
                    ? JSON.parse(req.body.certifications)
                    : req.body.certifications;
            }

            // Handle profile image upload
            if (req.files && req.files.profileImage && req.files.profileImage[0]) {
                try {
                    const file = req.files.profileImage[0];
                    const fileExtension = path.extname(file.originalname);
                    const fileName = `profile-${Date.now()}${fileExtension}`;
                    const r2Key = `teachers/${req.user.id}/profile/${fileName}`;
                    
                    await r2Storage.uploadFile(r2Key, file.buffer, file.mimetype);
                    profileData.profile_image_path = r2Key;
                } catch (uploadError) {
                    console.error('Profile image upload error:', uploadError);
                    return res.status(500).json({ error: 'Failed to upload profile image' });
                }
            }

            const updatedProfile = await teacherProfileService.updateProfile(req.user.id, profileData);

            // Enrich profile image URL
            if (updatedProfile.profile_image_path) {
                const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(updatedProfile.profile_image_path) : null;
                if (publicUrl) {
                    updatedProfile.profile_image_url = publicUrl;
                } else if (updatedProfile.profile_image_path.startsWith('teachers/')) {
                    const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                    const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                    updatedProfile.profile_image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(updatedProfile.profile_image_path)}`;
                }
            }

            // Enrich certificate images
            if (updatedProfile.certifications && Array.isArray(updatedProfile.certifications)) {
                updatedProfile.certifications = updatedProfile.certifications.map(cert => {
                    if (cert.image_path) {
                        const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                        const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                        cert.image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(cert.image_path)}`;
                    }
                    return cert;
                });
            }

            res.json(updatedProfile);
        } catch (error) {
            console.error('Update profile error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Request OTP for verification
     */
    async requestOTP(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            const { type } = req.body;
            const validTypes = ['account_email', 'support_email', 'original_phone', 'support_phone'];
            
            if (!validTypes.includes(type)) {
                return res.status(400).json({ error: 'Invalid verification type' });
            }

            const result = await teacherProfileService.requestOTP(req.user.id, type);
            res.json(result);
        } catch (error) {
            console.error('Request OTP error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Verify OTP
     */
    async verifyOTP(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            const { type, otp } = req.body;
            const validTypes = ['account_email', 'support_email', 'original_phone', 'support_phone'];
            
            if (!validTypes.includes(type)) {
                return res.status(400).json({ error: 'Invalid verification type' });
            }

            const profile = await teacherProfileService.verifyOTP(req.user.id, type, otp);
            
            // Enrich profile image URL
            if (profile.profile_image_path) {
                const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                profile.profile_image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(profile.profile_image_path)}`;
            }

            res.json(profile);
        } catch (error) {
            console.error('Verify OTP error:', error);
            if (error.message === 'Invalid OTP' || error.message === 'OTP expired') {
                return res.status(400).json({ error: error.message });
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get profile completion percentage
     */
    async getProfileCompletion(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            const completion = await teacherProfileService.getProfileCompletion(req.user.id);
            res.json(completion);
        } catch (error) {
            console.error('Get profile completion error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Change password
     */
    async changePassword(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return res.status(400).json({ error: 'Current password and new password are required' });
            }

            if (newPassword.length < 6) {
                return res.status(400).json({ error: 'New password must be at least 6 characters long' });
            }

            await userPasswordService.changePassword(req.user.id, currentPassword, newPassword);
            res.json({ message: 'Password changed successfully' });
        } catch (error) {
            console.error('Change password error:', error);
            if (error.message === 'Current password is incorrect') {
                return res.status(400).json({ error: error.message });
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Stream profile image
     */
    async streamProfileImage(req, res) {
        try {
            const imagePath = req.params.key || '';
            
            if (!imagePath || !imagePath.startsWith('teachers/')) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const exists = await r2Storage.objectExists(imagePath);
            if (!exists) {
                return res.status(404).json({ error: 'Image not found' });
            }

            const ext = path.extname(imagePath).toLowerCase();
            const contentTypeMap = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp'
            };
            const contentType = contentTypeMap[ext] || 'image/jpeg';

            res.set({
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000',
                'Access-Control-Allow-Origin': '*',
                'Cross-Origin-Resource-Policy': 'cross-origin'
            });

            const stream = await r2Storage.getObjectStream(imagePath);
            stream.pipe(res);
        } catch (error) {
            console.error('Stream profile image error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new TeacherProfileController();
