const db = require('../../db');
const r2Storage = require('./r2StorageService');

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
        
        // Parse JSONB fields
        const parsedProfile = {
            ...profile,
            // Account email should always be the login email from users table
            account_email: profile.login_email || profile.account_email,
            specialization: typeof profile.specialization === 'string' 
                ? JSON.parse(profile.specialization) 
                : (profile.specialization || []),
            education: typeof profile.education === 'string'
                ? JSON.parse(profile.education)
                : (profile.education || []),
            experience: profile.experience_new || (typeof profile.experience === 'string'
                ? JSON.parse(profile.experience)
                : (profile.experience || [])),
            certifications: typeof profile.certifications === 'string'
                ? JSON.parse(profile.certifications)
                : (profile.certifications || []),
            bank_accounts: typeof profile.bank_accounts === 'string'
                ? JSON.parse(profile.bank_accounts)
                : (profile.bank_accounts || []),
            card_accounts: typeof profile.card_accounts === 'string'
                ? JSON.parse(profile.card_accounts)
                : (profile.card_accounts || []),
        };
        
        // Remove experience_new and login_email from response
        delete parsedProfile.experience_new;
        delete parsedProfile.login_email;
        return parsedProfile;
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
            account_email: loginEmail, // Ensure account_email is set to login email
            specialization: [],
            education: [],
            experience: [],
            certifications: [],
            bank_accounts: [],
            card_accounts: [],
        };
    }

    /**
     * Update teacher profile
     */
    async updateProfile(userId, profileData) {
        const {
            name,
            bio,
            profileImagePath,
            accountEmail,
            supportEmail,
            originalPhone,
            supportPhone,
            address,
            location,
            youtubeUrl,
            linkedinUrl,
            facebookUrl,
            twitterUrl,
            specialization,
            education,
            experience,
            certifications,
            bankAccounts,
            cardAccounts,
        } = profileData;

        // Build update query dynamically
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (bio !== undefined) {
            updates.push(`bio = $${paramIndex++}`);
            values.push(bio);
        }
        if (profileImagePath !== undefined) {
            updates.push(`profile_image_path = $${paramIndex++}`);
            values.push(profileImagePath);
        }
        // Account email is read-only - it comes from users table, don't allow updates
        // We skip accountEmail updates here since it should always match login email
        if (supportEmail !== undefined) {
            updates.push(`support_email = $${paramIndex++}`);
            values.push(supportEmail);
            if (supportEmail) {
                updates.push(`support_email_verified = false`);
            }
        }
        if (originalPhone !== undefined) {
            updates.push(`original_phone = $${paramIndex++}`);
            values.push(originalPhone);
            if (originalPhone) {
                updates.push(`original_phone_verified = false`);
            }
        }
        if (supportPhone !== undefined) {
            updates.push(`support_phone = $${paramIndex++}`);
            values.push(supportPhone);
            if (supportPhone) {
                updates.push(`support_phone_verified = false`);
            }
        }
        if (address !== undefined) {
            updates.push(`address = $${paramIndex++}`);
            values.push(address);
        }
        if (location !== undefined) {
            updates.push(`location = $${paramIndex++}`);
            values.push(location);
        }
        if (youtubeUrl !== undefined) {
            updates.push(`youtube_url = $${paramIndex++}`);
            values.push(youtubeUrl);
        }
        if (linkedinUrl !== undefined) {
            updates.push(`linkedin_url = $${paramIndex++}`);
            values.push(linkedinUrl);
        }
        if (facebookUrl !== undefined) {
            updates.push(`facebook_url = $${paramIndex++}`);
            values.push(facebookUrl);
        }
        if (twitterUrl !== undefined) {
            updates.push(`twitter_url = $${paramIndex++}`);
            values.push(twitterUrl);
        }
        if (specialization !== undefined) {
            updates.push(`specialization = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(specialization));
        }
        if (education !== undefined) {
            updates.push(`education = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(education));
        }
        if (experience !== undefined) {
            updates.push(`experience_new = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(experience));
        }
        if (certifications !== undefined) {
            updates.push(`certifications = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(certifications));
        }
        if (bankAccounts !== undefined) {
            updates.push(`bank_accounts = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(bankAccounts));
        }
        if (cardAccounts !== undefined) {
            updates.push(`card_accounts = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(cardAccounts));
        }

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

        const result = await db.query(query, values);
        
        if (result.rows.length === 0) {
            return await this.createProfile(userId);
        }

        return await this.getProfile(userId);
    }

    /**
     * Request OTP for email/phone verification
     * For now, uses fixed OTP: 123456
     */
    async requestOTP(userId, type) {
        const FIXED_OTP = '123456';
        const OTP_EXPIRY_MINUTES = 10;
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

        const otpField = `${type}_otp`;
        const expiresField = `${type}_otp_expires_at`;

        await db.query(
            `UPDATE teacher_profiles 
             SET ${otpField} = $1, ${expiresField} = $2
             WHERE user_id = $3`,
            [FIXED_OTP, expiresAt, userId]
        );

        return {
            success: true,
            message: `OTP sent to ${type}`,
            expiresAt: expiresAt.toISOString()
        };
    }

    /**
     * Verify OTP for email/phone
     */
    async verifyOTP(userId, type, otp) {
        const FIXED_OTP = '123456';
        
        // Check if OTP matches (for now, always accept 123456)
        if (otp !== FIXED_OTP) {
            const profile = await this.getProfile(userId);
            const otpField = `${type}_otp`;
            const expiresField = `${type}_otp_expires_at`;
            const currentOTP = profile[otpField];
            const expiresAt = profile[expiresField];

            if (!currentOTP) {
                return { success: false, error: 'No OTP requested' };
            }

            if (expiresAt && new Date(expiresAt) < new Date()) {
                return { success: false, error: 'OTP expired' };
            }

            if (currentOTP !== otp) {
                return { success: false, error: 'Invalid OTP' };
            }
        }

        // Mark as verified
        const verifiedField = `${type}_verified`;
        const otpField = `${type}_otp`;
        const expiresField = `${type}_otp_expires_at`;

        await db.query(
            `UPDATE teacher_profiles 
             SET ${verifiedField} = true, 
                 ${otpField} = NULL, 
                 ${expiresField} = NULL
             WHERE user_id = $1`,
            [userId]
        );

        return {
            success: true,
            message: `${type} verified successfully`
        };
    }

    /**
     * Calculate profile completion percentage
     */
    async getProfileCompletion(userId) {
        const profile = await this.getProfile(userId);
        
        const fields = {
            // Personal (40%)
            name: profile.name ? 1 : 0,
            bio: profile.bio ? 1 : 0,
            profileImage: profile.profile_image_path ? 1 : 0,
            accountEmail: profile.account_email ? 1 : 0,
            accountEmailVerified: profile.account_email_verified ? 1 : 0,
            supportEmail: profile.support_email ? 1 : 0,
            originalPhone: profile.original_phone ? 1 : 0,
            originalPhoneVerified: profile.original_phone_verified ? 1 : 0,
            address: profile.address ? 1 : 0,
            location: profile.location ? 1 : 0,
            
            // Qualification (40%)
            specialization: (profile.specialization && profile.specialization.length > 0) ? 1 : 0,
            education: (profile.education && profile.education.length > 0) ? 1 : 0,
            experience: (profile.experience && profile.experience.length > 0) ? 1 : 0,
            certifications: (profile.certifications && profile.certifications.length > 0) ? 1 : 0,
            
            // Payment (20%)
            bankAccounts: (profile.bank_accounts && profile.bank_accounts.length > 0) ? 1 : 0,
            cardAccounts: (profile.card_accounts && profile.card_accounts.length > 0) ? 1 : 0,
        };

        // Calculate weighted completion
        const personalScore = (
            fields.name * 0.05 +
            fields.bio * 0.05 +
            fields.profileImage * 0.05 +
            fields.accountEmail * 0.05 +
            fields.accountEmailVerified * 0.05 +
            fields.supportEmail * 0.03 +
            fields.originalPhone * 0.05 +
            fields.originalPhoneVerified * 0.05 +
            fields.address * 0.01 +
            fields.location * 0.01
        ) * 40;

        const qualificationScore = (
            fields.specialization * 0.10 +
            fields.education * 0.15 +
            fields.experience * 0.10 +
            fields.certifications * 0.05
        ) * 40;

        const paymentScore = (
            fields.bankAccounts * 0.10 +
            fields.cardAccounts * 0.10
        ) * 20;

        const totalPercentage = Math.round(personalScore + qualificationScore + paymentScore);
        
        return {
            percentage: Math.min(100, totalPercentage),
            breakdown: {
                personal: Math.round(personalScore),
                qualification: Math.round(qualificationScore),
                payment: Math.round(paymentScore),
            },
            fields
        };
    }
}

module.exports = new TeacherProfileService();
