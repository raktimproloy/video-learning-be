const studentProfileService = require('../services/studentProfileService');
const r2Storage = require('../services/r2StorageService');
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

class StudentProfileController {
    /**
     * Get student profile
     */
    async getProfile(req, res) {
        try {
            if (req.user.role !== 'student') {
                return res.status(403).json({ error: 'Access denied. Students only.' });
            }

            const profile = await studentProfileService.getProfile(req.user.id);

            // Enrich profile image URL if exists
            if (profile.profile_image_path) {
                const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(profile.profile_image_path) : null;
                if (publicUrl) {
                    profile.profile_image_url = publicUrl;
                } else if (profile.profile_image_path.startsWith('students/')) {
                    const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                    const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                    profile.profile_image_url = `${baseUrl}/v1/student/profile/image/${encodeURIComponent(profile.profile_image_path)}`;
                }
            }

            res.json(profile);
        } catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Update student profile
     */
    async updateProfile(req, res) {
        try {
            if (req.user.role !== 'student') {
                return res.status(403).json({ error: 'Access denied. Students only.' });
            }

            const profileData = {
                name: req.body.name,
                phone: req.body.phone,
            };

            // Handle profile image upload if provided
            if (req.file) {
                // Single file upload
                try {
                    const fileExtension = path.extname(req.file.originalname);
                    const fileName = `profile-${Date.now()}${fileExtension}`;
                    const r2Key = `students/${req.user.id}/profile/${fileName}`;
                    
                    // Upload to R2
                    await r2Storage.uploadFile(r2Key, req.file.buffer, req.file.mimetype);
                    profileData.profileImagePath = r2Key;
                } catch (uploadError) {
                    console.error('Profile image upload error:', uploadError);
                    return res.status(500).json({ error: 'Failed to upload profile image' });
                }
            } else if (req.files && req.files.profileImage && req.files.profileImage[0]) {
                // Multiple files upload (fields)
                try {
                    const file = req.files.profileImage[0];
                    const fileExtension = path.extname(file.originalname);
                    const fileName = `profile-${Date.now()}${fileExtension}`;
                    const r2Key = `students/${req.user.id}/profile/${fileName}`;
                    
                    // Upload to R2
                    await r2Storage.uploadFile(r2Key, file.buffer, file.mimetype);
                    profileData.profileImagePath = r2Key;
                } catch (uploadError) {
                    console.error('Profile image upload error:', uploadError);
                    return res.status(500).json({ error: 'Failed to upload profile image' });
                }
            }

            const updatedProfile = await studentProfileService.updateProfile(req.user.id, profileData);

            // Enrich profile image URL
            if (updatedProfile.profile_image_path) {
                const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(updatedProfile.profile_image_path) : null;
                if (publicUrl) {
                    updatedProfile.profile_image_url = publicUrl;
                } else if (updatedProfile.profile_image_path.startsWith('students/')) {
                    const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                    const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                    updatedProfile.profile_image_url = `${baseUrl}/v1/student/profile/image/${encodeURIComponent(updatedProfile.profile_image_path)}`;
                }
            }

            res.json(updatedProfile);
        } catch (error) {
            console.error('Update profile error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Change password
     */
    async changePassword(req, res) {
        try {
            if (req.user.role !== 'student') {
                return res.status(403).json({ error: 'Access denied. Students only.' });
            }

            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return res.status(400).json({ error: 'Current password and new password are required' });
            }

            if (newPassword.length < 6) {
                return res.status(400).json({ error: 'New password must be at least 6 characters long' });
            }

            const result = await studentProfileService.changePassword(
                req.user.id,
                currentPassword,
                newPassword
            );

            res.json(result);
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
            // Extract path from regex route (req.params.key set by route handler)
            const imagePath = req.params.key || '';
            
            // Security: Ensure path starts with students/
            if (!imagePath || !imagePath.startsWith('students/')) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Check if file exists
            const exists = await r2Storage.objectExists(imagePath);
            if (!exists) {
                return res.status(404).json({ error: 'Image not found' });
            }

            // Determine content type
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

            // Stream the file
            const stream = await r2Storage.getObjectStream(imagePath);
            stream.pipe(res);
        } catch (error) {
            console.error('Stream profile image error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new StudentProfileController();
