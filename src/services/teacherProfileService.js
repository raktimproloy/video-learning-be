const db = require('../../db');

class TeacherProfileService {
    /**
     * Get teacher profile by user ID
     */
    async getProfile(userId) {
        // Join with users table to get login email
        const result = await db.query(
            `SELECT tp.*, u.email as login_email 
             FROM teacher_profiles tp
             JOIN users u ON tp.user_id = u.id
             WHERE tp.user_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            // Create empty profile if doesn't exist
            return await this.createProfile(userId);
        }
        
        const profile = result.rows[0];
        
        // Parse JSONB fields - specialization: always return array of strings
        let specialization = typeof profile.specialization === 'string' 
            ? JSON.parse(profile.specialization) 
            : (profile.specialization || []);
        if (!Array.isArray(specialization)) specialization = [];
        specialization = specialization.map(s => typeof s === 'string' ? s : (s && s.name ? String(s.name) : '')).filter(Boolean);
        
        const education = typeof profile.education === 'string'
            ? JSON.parse(profile.education)
            : (profile.education || []);
        
        const experience = typeof profile.experience_new === 'string'
            ? JSON.parse(profile.experience_new)
            : (profile.experience_new || []);
        
        const certifications = typeof profile.certifications === 'string'
            ? JSON.parse(profile.certifications)
            : (profile.certifications || []);
        
        return {
            ...profile,
            account_email: profile.account_email || profile.login_email,
            specialization,
            education,
            experience,
            certifications,
            // Remove internal fields
            login_email: undefined,
            experience_new: undefined
        };
    }

    /**
     * Get public teacher profile (for public viewing)
     */
    async getPublicProfile(userId) {
        // Check if reviews table exists
        const reviewsTableCheck = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'reviews'
            )
        `);
        const hasReviewsTable = reviewsTableCheck.rows[0]?.exists || false;

        const reviewsRatingQuery = hasReviewsTable
            ? `(SELECT COALESCE(AVG(r.rating), 0) FROM reviews r 
               JOIN courses c ON r.course_id = c.id 
               WHERE c.teacher_id = u.id)`
            : `0`;
        
        const reviewsCountQuery = hasReviewsTable
            ? `(SELECT COUNT(*) FROM reviews r 
               JOIN courses c ON r.course_id = c.id 
               WHERE c.teacher_id = u.id)`
            : `0`;

        const result = await db.query(
            `SELECT 
                tp.*,
                u.email as login_email,
                (SELECT COUNT(*) FROM courses WHERE teacher_id = u.id) as total_courses,
                (SELECT COUNT(*) FROM course_enrollments ce 
                 JOIN courses c ON ce.course_id = c.id 
                 WHERE c.teacher_id = u.id) as total_students,
                ${reviewsRatingQuery} as rating,
                ${reviewsCountQuery} as total_reviews
             FROM teacher_profiles tp
             JOIN users u ON tp.user_id = u.id
             WHERE tp.user_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            return null;
        }
        
        const profile = result.rows[0];
        
        // Parse JSONB fields - specialization: always return array of strings
        let specialization = typeof profile.specialization === 'string' 
            ? JSON.parse(profile.specialization) 
            : (profile.specialization || []);
        if (!Array.isArray(specialization)) specialization = [];
        specialization = specialization.map(s => typeof s === 'string' ? s : (s && s.name ? String(s.name) : '')).filter(Boolean);
        
        const education = typeof profile.education === 'string'
            ? JSON.parse(profile.education)
            : (profile.education || []);
        
        const experience = typeof profile.experience_new === 'string'
            ? JSON.parse(profile.experience_new)
            : (profile.experience_new || []);
        
        const certifications = typeof profile.certifications === 'string'
            ? JSON.parse(profile.certifications)
            : (profile.certifications || []);
        
        return {
            user_id: profile.user_id,
            name: profile.name || profile.login_email,
            bio: profile.bio,
            location: profile.location,
            profile_image_path: profile.profile_image_path,
            institute_name: profile.institute_name || null,
            specialization,
            education,
            experience,
            certifications,
            account_email: profile.account_email || profile.login_email,
            original_phone: profile.original_phone,
            support_phone: profile.support_phone,
            youtube_url: profile.youtube_url,
            linkedin_url: profile.linkedin_url,
            facebook_url: profile.facebook_url,
            twitter_url: profile.twitter_url,
            total_courses: parseInt(profile.total_courses) || 0,
            total_students: parseInt(profile.total_students) || 0,
            rating: parseFloat(profile.rating) || 0,
            total_reviews: parseInt(profile.total_reviews) || 0
        };
    }

    /**
     * Create empty profile for teacher
     */
    async createProfile(userId) {
        // Get user email first
        const userResult = await db.query(
            `SELECT email FROM users WHERE id = $1`,
            [userId]
        );
        const loginEmail = userResult.rows[0]?.email || null;

        const result = await db.query(
            `INSERT INTO teacher_profiles (user_id, account_email) VALUES ($1, $2) RETURNING *`,
            [userId, loginEmail]
        );
        
        const profile = result.rows[0];
        return {
            ...profile,
            account_email: profile.account_email || loginEmail,
            specialization: [],
            education: [],
            experience: [],
            certifications: []
        };
    }

    /**
     * Update teacher profile
     */
    async updateProfile(userId, profileData) {
        const updates = [];
        const values = [];
        let paramIndex = 1;

        // Build dynamic update query
        Object.keys(profileData).forEach(key => {
            if (profileData[key] !== undefined) {
                if (['specialization', 'education', 'experience', 'certifications', 'bank_accounts', 'card_accounts'].includes(key)) {
                    updates.push(`${key === 'experience' ? 'experience_new' : key} = $${paramIndex++}`);
                    values.push(JSON.stringify(profileData[key]));
                } else if (key !== 'account_email') { // Don't update account_email as it's linked to login email
                    updates.push(`${key} = $${paramIndex++}`);
                    values.push(profileData[key]);
                }
            }
        });

        if (updates.length === 0) {
            return await this.getProfile(userId);
        }

        updates.push(`updated_at = NOW()`);
        values.push(userId);

        const query = `
            UPDATE teacher_profiles 
            SET ${updates.join(', ')}
            WHERE user_id = $${paramIndex}
            RETURNING *
        `;

        await db.query(query, values);
        return await this.getProfile(userId);
    }

    /**
     * Request OTP for verification
     */
    async requestOTP(userId, type) {
        const otp = '123456'; // Fixed OTP for now
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        const fieldMap = {
            account_email: 'account_email_otp',
            support_email: 'support_email_otp',
            original_phone: 'original_phone_otp',
            support_phone: 'support_phone_otp'
        };

        const expiryMap = {
            account_email: 'account_email_otp_expires_at',
            support_email: 'support_email_otp_expires_at',
            original_phone: 'original_phone_otp_expires_at',
            support_phone: 'support_phone_otp_expires_at'
        };

        await db.query(
            `UPDATE teacher_profiles 
             SET ${fieldMap[type]} = $1, ${expiryMap[type]} = $2
             WHERE user_id = $3`,
            [otp, expiresAt, userId]
        );

        return { otp };
    }

    /**
     * Verify OTP
     */
    async verifyOTP(userId, type, otp) {
        const fieldMap = {
            account_email: { otp: 'account_email_otp', expiry: 'account_email_otp_expires_at', verified: 'account_email_verified' },
            support_email: { otp: 'support_email_otp', expiry: 'support_email_otp_expires_at', verified: 'support_email_verified' },
            original_phone: { otp: 'original_phone_otp', expiry: 'original_phone_otp_expires_at', verified: 'original_phone_verified' },
            support_phone: { otp: 'support_phone_otp', expiry: 'support_phone_otp_expires_at', verified: 'support_phone_verified' }
        };

        const fields = fieldMap[type];
        const result = await db.query(
            `SELECT ${fields.otp}, ${fields.expiry} 
             FROM teacher_profiles 
             WHERE user_id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            throw new Error('Profile not found');
        }

        const storedOTP = result.rows[0][fields.otp];
        const expiresAt = result.rows[0][fields.expiry];

        if (!storedOTP || storedOTP !== otp) {
            throw new Error('Invalid OTP');
        }

        if (new Date(expiresAt) < new Date()) {
            throw new Error('OTP expired');
        }

        // Mark as verified and clear OTP
        await db.query(
            `UPDATE teacher_profiles 
             SET ${fields.verified} = true, 
                 ${fields.otp} = NULL, 
                 ${fields.expiry} = NULL
             WHERE user_id = $1`,
            [userId]
        );

        return await this.getProfile(userId);
    }

    /**
     * Get profile completion percentage
     */
    async getProfileCompletion(userId) {
        const profile = await this.getProfile(userId);
        
        let completedFields = 0;
        const totalFields = 20;

        // Personal section (7 fields)
        if (profile.name) completedFields++;
        if (profile.bio) completedFields++;
        if (profile.profile_image_path) completedFields++;
        if (profile.account_email) completedFields++;
        if (profile.original_phone) completedFields++;
        if (profile.address) completedFields++;
        if (profile.location) completedFields++;

        // Qualification section (8 fields)
        if (profile.specialization && profile.specialization.length > 0) completedFields++;
        if (profile.education && profile.education.length > 0) completedFields++;
        if (profile.experience && profile.experience.length > 0) completedFields++;
        if (profile.certifications && profile.certifications.length > 0) completedFields++;
        // Count additional fields
        if (profile.education && profile.education.length >= 2) completedFields++;
        if (profile.experience && profile.experience.length >= 2) completedFields++;
        if (profile.certifications && profile.certifications.length >= 2) completedFields++;
        if (profile.specialization && profile.specialization.length >= 3) completedFields++;

        // Payment section (5 fields - dummy for now)
        // completedFields += 5; // Skip payment section

        const percentage = Math.round((completedFields / totalFields) * 100);
        
        return {
            percentage,
            breakdown: {
                personal: Math.round((completedFields / 7) * 100),
                qualification: Math.round((completedFields / 8) * 100),
                payment: 0
            }
        };
    }
}

module.exports = new TeacherProfileService();
