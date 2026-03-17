const db = require('../../db');
const emailService = require('./emailService');
const smsService = require('./smsService');
const { hasColumn } = require('../utils/dbSchemaCache');
const userService = require('./userService');

class TeacherProfileService {
    /**
     * Sync teacher verified badge (is_verified) based on profile completion percentage.
     * Rule: verified if completion >= 60%, otherwise not verified.
     */
    async syncVerifiedBadge(userId) {
        if (!userId) return { is_verified: false, percentage: 0 };
        const completion = await this.getProfileCompletion(userId);
        const percentage = completion?.percentage ?? 0;
        const hasIsVerified = await hasColumn('teacher_profiles', 'is_verified');
        if (!hasIsVerified) {
            // Migration not applied yet; don't fail requests.
            return { is_verified: false, percentage };
        }
        const shouldBeVerified = Number(percentage) >= 60;
        const result = await db.query(
            `UPDATE teacher_profiles
             SET is_verified = $2, updated_at = NOW()
             WHERE user_id = $1
             RETURNING is_verified`,
            [userId, shouldBeVerified]
        );
        return { is_verified: !!result.rows[0]?.is_verified, percentage };
    }
    /**
     * Get teacher profile by user ID
     */
    async getProfile(userId) {
        // Join with users table to get login email
        const hasIsVerified = await hasColumn('teacher_profiles', 'is_verified');
        const isVerifiedSelect = hasIsVerified
            ? `COALESCE(tp.is_verified, false) as is_verified`
            : `false as is_verified`;
        const result = await db.query(
            `SELECT tp.*, ${isVerifiedSelect}, u.email as login_email 
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

        const hasIsVerified = await hasColumn('teacher_profiles', 'is_verified');
        const isVerifiedSelect = hasIsVerified
            ? `COALESCE(tp.is_verified, false) as is_verified`
            : `false as is_verified`;

        const result = await db.query(
            `SELECT 
                tp.user_id,
                tp.name,
                tp.bio,
                tp.location,
                tp.profile_image_path,
                tp.institute_name,
                ${isVerifiedSelect},
                tp.specialization,
                tp.education,
                tp.experience_new,
                tp.certifications,
                tp.account_email,
                tp.original_phone,
                tp.support_phone,
                tp.youtube_url,
                tp.linkedin_url,
                tp.facebook_url,
                tp.twitter_url,
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
            is_verified: !!profile.is_verified,
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

        const defaultImage =
            process.env.DEFAULT_TEACHER_AVATAR_PATH || '/images/default-teacher.png';

        const result = await db.query(
            `INSERT INTO teacher_profiles (user_id, account_email, profile_image_path) VALUES ($1, $2, $3) RETURNING *`,
            [userId, loginEmail, defaultImage]
        );
        
        const profile = result.rows[0];
        // Ensure badge starts correct (will be false for new profiles)
        await this.syncVerifiedBadge(userId);
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
     * Update teacher profile. Verified contact fields (support_email, original_phone, support_phone) cannot be changed.
     */
    async updateProfile(userId, profileData) {
        const profile = await this.getProfile(userId);
        const data = { ...profileData };
        if (profile.support_email_verified && data.support_email !== undefined) delete data.support_email;
        if (profile.original_phone_verified && data.original_phone !== undefined) delete data.original_phone;
        if (profile.support_phone_verified && data.support_phone !== undefined) delete data.support_phone;

        const updates = [];
        const values = [];
        let paramIndex = 1;

        // Build dynamic update query
        Object.keys(data).forEach(key => {
            if (data[key] !== undefined) {
                if (['specialization', 'education', 'experience', 'certifications', 'bank_accounts', 'card_accounts'].includes(key)) {
                    updates.push(`${key === 'experience' ? 'experience_new' : key} = $${paramIndex++}`);
                    values.push(JSON.stringify(data[key]));
                } else if (key !== 'account_email') { // Don't update account_email as it's linked to login email
                    updates.push(`${key} = $${paramIndex++}`);
                    values.push(data[key]);
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
        // Recompute verified badge after any update (can flip on/off)
        await this.syncVerifiedBadge(userId);
        return await this.getProfile(userId);
    }

    /**
     * Mark onboarding as completed in users table (idempotent).
     */
    async markOnboardingIfNeeded(userId, { role, category } = {}) {
        const user = await userService.findById(userId);
        if (!user || user.onboarding_completed) return user;
        return await userService.markOnboardingCompleted(userId, role || 'teacher', category || null);
    }

    /**
     * Mark account email as verified when user signed in with Google (email is already verified by Google).
     * Call after Google OAuth login. If teacher profile exists and account_email matches login email, set verified.
     */
    async markAccountEmailVerifiedIfGoogle(userId, loginEmail) {
        if (!loginEmail || !userId) return;
        const normalized = String(loginEmail).trim().toLowerCase();
        const result = await db.query(
            `UPDATE teacher_profiles 
             SET account_email_verified = true, 
                 account_email = COALESCE(NULLIF(TRIM(account_email), ''), $2),
                 account_email_otp = NULL,
                 account_email_otp_expires_at = NULL
             WHERE user_id = $1 
               AND (account_email IS NULL OR TRIM(account_email) = '' OR LOWER(TRIM(account_email)) = $3)
             RETURNING user_id`,
            [userId, loginEmail, normalized]
        );
        if (result.rowCount > 0) {
            console.log(`[Teacher] Auto-verified account email for user ${userId} (Google login)`);
        }
    }

    /**
     * Request OTP for verification. Generates random 6-digit OTP, stores in DB, sends via email or SMS.
     * @param {object} [payload] - Optional { original_phone, support_phone } from request body (used when profile not saved yet).
     */
    async requestOTP(userId, type, payload = {}) {
        const OTP_EXPIRY_MINUTES = 10;
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
        const otp = emailService.generateOtp();

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

        const profile = await this.getProfile(userId);
        const recipientByType = {
            account_email: profile.account_email || profile.login_email,
            support_email: payload.support_email || profile.support_email,
            original_phone: payload.original_phone || profile.original_phone,
            support_phone: payload.support_phone || profile.support_phone
        };
        const recipient = recipientByType[type];
        if (!recipient || String(recipient).trim() === '') {
            throw new Error(type.includes('email') ? 'Email address is required' : 'Phone number is required');
        }

        await db.query(
            `UPDATE teacher_profiles 
             SET ${fieldMap[type]} = $1, ${expiryMap[type]} = $2
             WHERE user_id = $3`,
            [otp, expiresAt, userId]
        );

        // Persist email/phone from request so it shows in profile after verify (user has not saved form yet)
        if (type === 'support_email' && payload.support_email) {
            await db.query(
                'UPDATE teacher_profiles SET support_email = $1 WHERE user_id = $2',
                [String(payload.support_email).trim().toLowerCase(), userId]
            );
        } else if (type === 'original_phone' && payload.original_phone) {
            await db.query(
                'UPDATE teacher_profiles SET original_phone = $1 WHERE user_id = $2',
                [String(payload.original_phone).trim(), userId]
            );
        } else if (type === 'support_phone' && payload.support_phone) {
            await db.query(
                'UPDATE teacher_profiles SET support_phone = $1 WHERE user_id = $2',
                [String(payload.support_phone).trim(), userId]
            );
        }

        if (type === 'account_email' || type === 'support_email') {
            await emailService.sendOtpEmail(
                recipient.trim().toLowerCase(),
                otp,
                type === 'account_email' ? 'account email' : 'support email'
            );
        } else {
            await smsService.sendOtpSms(String(recipient).trim(), otp);
        }

        return { message: 'OTP sent', expiresIn: OTP_EXPIRY_MINUTES * 60 };
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

        const submittedOtp = String(otp || '').trim();
        if (!storedOTP || storedOTP !== submittedOtp) {
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

        // OTP verification changes profile fields; sync verified badge too.
        await this.syncVerifiedBadge(userId);
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
