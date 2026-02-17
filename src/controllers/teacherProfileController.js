const teacherProfileService = require('../services/teacherProfileService');
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

class TeacherProfileController {
    /**
     * Get teacher profile
     */
    async getProfile(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }

            const profile = await teacherProfileService.getProfile(req.user.id);
            const completion = await teacherProfileService.getProfileCompletion(req.user.id);

            // Enrich profile image URL if exists
            if (profile.profile_image_path) {
                const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(profile.profile_image_path) : null;
                if (publicUrl) {
                    profile.profile_image_url = publicUrl;
                } else if (profile.profile_image_path.startsWith('teachers/')) {
                    // Use the API endpoint to stream the image
                    const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                    const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                    profile.profile_image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(profile.profile_image_path)}`;
                }
            }

            // Enrich certificate image URLs if they exist
            if (profile.certifications && Array.isArray(profile.certifications)) {
                const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                
                profile.certifications = profile.certifications.map(cert => {
                    if (cert.image_path) {
                        const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(cert.image_path) : null;
                        if (publicUrl) {
                            cert.image_url = publicUrl;
                        } else if (cert.image_path.startsWith('teachers/')) {
                            cert.image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(cert.image_path)}`;
                        }
                    }
                    return cert;
                });
            }

            res.json({
                ...profile,
                completion
            });
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
                accountEmail: req.body.accountEmail,
                supportEmail: req.body.supportEmail,
                originalPhone: req.body.originalPhone,
                supportPhone: req.body.supportPhone,
                address: req.body.address,
                location: req.body.location,
                youtubeUrl: req.body.youtubeUrl,
                linkedinUrl: req.body.linkedinUrl,
                facebookUrl: req.body.facebookUrl,
                twitterUrl: req.body.twitterUrl,
                specialization: req.body.specialization ? JSON.parse(req.body.specialization) : undefined,
                education: req.body.education ? JSON.parse(req.body.education) : undefined,
                experience: req.body.experience ? JSON.parse(req.body.experience) : undefined,
                certifications: req.body.certifications ? JSON.parse(req.body.certifications) : undefined,
                bankAccounts: req.body.bankAccounts ? JSON.parse(req.body.bankAccounts) : undefined,
                cardAccounts: req.body.cardAccounts ? JSON.parse(req.body.cardAccounts) : undefined,
            };

            // Handle profile image upload if provided (support both single and fields)
            if (req.file) {
                // Single file upload (backward compatibility)
                try {
                    const fileExtension = path.extname(req.file.originalname);
                    const fileName = `profile-${Date.now()}${fileExtension}`;
                    const r2Key = `teachers/${req.user.id}/profile/${fileName}`;
                    
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
                    const r2Key = `teachers/${req.user.id}/profile/${fileName}`;
                    
                    // Upload to R2
                    await r2Storage.uploadFile(r2Key, file.buffer, file.mimetype);
                    profileData.profileImagePath = r2Key;
                } catch (uploadError) {
                    console.error('Profile image upload error:', uploadError);
                    return res.status(500).json({ error: 'Failed to upload profile image' });
                }
            }

            // Handle certificate images if provided
            if (req.files && req.files.certificate_images && Array.isArray(req.files.certificate_images)) {
                try {
                    // Parse certifications to update image paths
                    if (profileData.certifications && Array.isArray(profileData.certifications)) {
                        const certificateImages = req.files.certificate_images;
                        // Get certificate IDs from form data (certificate_id_0, certificate_id_1, etc.)
                        const certificateIds = [];
                        let index = 0;
                        while (req.body[`certificate_id_${index}`] !== undefined) {
                            certificateIds.push(req.body[`certificate_id_${index}`]);
                            index++;
                        }

                        for (let i = 0; i < certificateImages.length && i < certificateIds.length; i++) {
                            const certImage = certificateImages[i];
                            const certId = certificateIds[i];
                            
                            const fileExtension = path.extname(certImage.originalname);
                            const fileName = `certificate-${certId}-${Date.now()}${fileExtension}`;
                            const r2Key = `teachers/${req.user.id}/certificates/${fileName}`;
                            
                            // Upload to R2
                            await r2Storage.uploadFile(r2Key, certImage.buffer, certImage.mimetype);
                            
                            // Update the corresponding certificate with image path
                            // Match by ID (handle both string and number IDs)
                            const certIndex = profileData.certifications.findIndex((c) => {
                                const cId = String(c.id || '');
                                const searchId = String(certId || '');
                                return cId === searchId;
                            });
                            
                            if (certIndex !== -1) {
                                profileData.certifications[certIndex].image_path = r2Key;
                            } else {
                                console.warn(`Certificate with ID ${certId} not found in certifications array`);
                            }
                        }
                    }
                } catch (uploadError) {
                    console.error('Certificate image upload error:', uploadError);
                    // Don't fail the whole request if certificate images fail
                }
            }

            const updatedProfile = await teacherProfileService.updateProfile(req.user.id, profileData);
            const completion = await teacherProfileService.getProfileCompletion(req.user.id);

            // Enrich profile image URL
            if (updatedProfile.profile_image_path) {
                const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(updatedProfile.profile_image_path) : null;
                if (publicUrl) {
                    updatedProfile.profile_image_url = publicUrl;
                } else if (updatedProfile.profile_image_path.startsWith('teachers/')) {
                    // Use the API endpoint to stream the image
                    const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                    const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                    updatedProfile.profile_image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(updatedProfile.profile_image_path)}`;
                }
            }

            // Enrich certificate image URLs if they exist
            if (updatedProfile.certifications && Array.isArray(updatedProfile.certifications)) {
                const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
                const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
                
                updatedProfile.certifications = updatedProfile.certifications.map(cert => {
                    if (cert.image_path) {
                        const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(cert.image_path) : null;
                        if (publicUrl) {
                            cert.image_url = publicUrl;
                        } else if (cert.image_path.startsWith('teachers/')) {
                            cert.image_url = `${baseUrl}/v1/teacher/profile/image/${encodeURIComponent(cert.image_path)}`;
                        }
                    }
                    return cert;
                });
            }

            res.json({
                ...updatedProfile,
                completion
            });
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

            const { type } = req.body; // 'account_email', 'support_email', 'original_phone', 'support_phone'

            if (!['account_email', 'support_email', 'original_phone', 'support_phone'].includes(type)) {
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

            if (!['account_email', 'support_email', 'original_phone', 'support_phone'].includes(type)) {
                return res.status(400).json({ error: 'Invalid verification type' });
            }

            if (!otp) {
                return res.status(400).json({ error: 'OTP is required' });
            }

            const result = await teacherProfileService.verifyOTP(req.user.id, type, otp);
            
            if (!result.success) {
                return res.status(400).json(result);
            }

            // Return updated profile with completion
            const profile = await teacherProfileService.getProfile(req.user.id);
            const completion = await teacherProfileService.getProfileCompletion(req.user.id);

            res.json({
                ...result,
                profile: {
                    ...profile,
                    completion
                }
            });
        } catch (error) {
            console.error('Verify OTP error:', error);
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
     * Stream profile image
     */
    async streamProfileImage(req, res) {
        try {
            // Extract path from regex route (req.params.key set by route handler)
            const imagePath = req.params.key || '';
            
            // Security: Ensure path starts with teachers/
            if (!imagePath || !imagePath.startsWith('teachers/')) {
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

module.exports = new TeacherProfileController();
