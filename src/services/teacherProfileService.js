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
        // Teacher rating/reviews: from teacher_reviews table (students review teacher directly)
        const teacherReviewsRatingQuery = `(SELECT COALESCE(AVG(tr.rating), 0)::float FROM teacher_reviews tr WHERE tr.teacher_id = u.id)`;
        const teacherReviewsCountQuery = `(SELECT COUNT(*)::int FROM teacher_reviews tr WHERE tr.teacher_id = u.id)`;

        const result = await db.query(
            `SELECT 
                tp.*,
                u.email as login_email,
                (SELECT COUNT(*) FROM courses WHERE teacher_id = u.id) as total_courses,
                (SELECT COUNT(*) FROM course_enrollments ce 
                 JOIN courses c ON ce.course_id = c.id 
                 WHERE c.teacher_id = u.id) as total_students,
                ${teacherReviewsRatingQuery} as rating,
                ${teacherReviewsCountQuery} as total_reviews
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
            rating: Math.round(parseFloat(profile.rating) * 10) / 10 || 0,
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
     * Get profile completion percentage.
     * Personal: count of filled fields matching frontend (14 fields).
     * Qualification: 4 areas (specialization, education, experience, certifications), 25% each if filled.
     * Payment: 100% if at least one payment method, else 0%.
     * Overall: average of personal, qualification, payment.
     */
    async getProfileCompletion(userId) {
        const profile = await this.getProfile(userId);

        // Personal section: same fields as frontend PersonalSection form (14 fields)
        const personalFields = [
            profile.name,
            profile.bio,
            profile.institute_name,
            profile.account_email,
            profile.support_email,
            profile.original_phone,
            profile.support_phone,
            profile.address,
            profile.location,
            profile.youtube_url,
            profile.linkedin_url,
            profile.facebook_url,
            profile.twitter_url,
            profile.profile_image_path,
        ];
        const filledPersonal = personalFields.filter((v) => v != null && String(v).trim() !== '').length;
        const personalTotal = personalFields.length;
        const personal = personalTotal > 0 ? Math.round((filledPersonal / personalTotal) * 100) : 0;

        // Qualification section: 4 areas (each 25%) – only count if at least one real entry with content (not empty placeholders)
        const hasRealSpecialization = Array.isArray(profile.specialization) && profile.specialization.some((s) => {
            const name = typeof s === 'string' ? s : (s && s.name);
            return name != null && String(name).trim() !== '';
        });
        const hasRealEducation = Array.isArray(profile.education) && profile.education.some((e) => {
            const inst = e && (e.institution || e.school);
            const degree = e && e.degree;
            const field = e && e.field;
            return (inst != null && String(inst).trim() !== '') || (degree != null && String(degree).trim() !== '') || (field != null && String(field).trim() !== '');
        });
        const hasRealExperience = Array.isArray(profile.experience) && profile.experience.some((e) => {
            const title = e && e.title;
            const company = e && (e.company || e.organization);
            return (title != null && String(title).trim() !== '') || (company != null && String(company).trim() !== '');
        });
        const hasRealCertifications = Array.isArray(profile.certifications) && profile.certifications.some((c) => {
            const name = c && c.name;
            const issuer = c && c.issuer;
            return (name != null && String(name).trim() !== '') || (issuer != null && String(issuer).trim() !== '');
        });
        let qualificationScore = 0;
        if (hasRealSpecialization) qualificationScore += 25;
        if (hasRealEducation) qualificationScore += 25;
        if (hasRealExperience) qualificationScore += 25;
        if (hasRealCertifications) qualificationScore += 25;
        const qualification = Math.min(100, qualificationScore);

        // Payment section: 100% only if teacher has at least one payment method (teacher_id = user id of teacher)
        const paymentCountResult = await db.query(
            'SELECT COUNT(*) AS cnt FROM teacher_payment_methods WHERE teacher_id = $1',
            [userId]
        );
        const paymentCount = parseInt(paymentCountResult.rows[0]?.cnt || '0', 10);
        const payment = paymentCount > 0 ? 100 : 0;

        // Overall: average of the three sections
        const percentage = Math.round((personal + qualification + payment) / 3);

        return {
            percentage: Math.min(100, Math.max(0, percentage)),
            breakdown: {
                personal: Math.min(100, Math.max(0, personal)),
                qualification: Math.min(100, Math.max(0, qualification)),
                payment: Math.min(100, Math.max(0, payment)),
            },
        };
    }
}

module.exports = new TeacherProfileService();
