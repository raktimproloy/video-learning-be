-- Extended Teacher Profiles Migration
-- Adds comprehensive profile fields including verification, contact info, qualifications, and payment

DO $$
BEGIN
    -- Add profile image field (stored in R2)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='profile_image_path') THEN
        ALTER TABLE teacher_profiles ADD COLUMN profile_image_path TEXT;
    END IF;

    -- Add contact information fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='account_email') THEN
        ALTER TABLE teacher_profiles ADD COLUMN account_email TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='account_email_verified') THEN
        ALTER TABLE teacher_profiles ADD COLUMN account_email_verified BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='account_email_otp') THEN
        ALTER TABLE teacher_profiles ADD COLUMN account_email_otp TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='account_email_otp_expires_at') THEN
        ALTER TABLE teacher_profiles ADD COLUMN account_email_otp_expires_at TIMESTAMP;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='support_email') THEN
        ALTER TABLE teacher_profiles ADD COLUMN support_email TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='support_email_verified') THEN
        ALTER TABLE teacher_profiles ADD COLUMN support_email_verified BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='support_email_otp') THEN
        ALTER TABLE teacher_profiles ADD COLUMN support_email_otp TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='support_email_otp_expires_at') THEN
        ALTER TABLE teacher_profiles ADD COLUMN support_email_otp_expires_at TIMESTAMP;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='original_phone') THEN
        ALTER TABLE teacher_profiles ADD COLUMN original_phone TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='original_phone_verified') THEN
        ALTER TABLE teacher_profiles ADD COLUMN original_phone_verified BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='original_phone_otp') THEN
        ALTER TABLE teacher_profiles ADD COLUMN original_phone_otp TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='original_phone_otp_expires_at') THEN
        ALTER TABLE teacher_profiles ADD COLUMN original_phone_otp_expires_at TIMESTAMP;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='support_phone') THEN
        ALTER TABLE teacher_profiles ADD COLUMN support_phone TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='support_phone_verified') THEN
        ALTER TABLE teacher_profiles ADD COLUMN support_phone_verified BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='support_phone_otp') THEN
        ALTER TABLE teacher_profiles ADD COLUMN support_phone_otp TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='support_phone_otp_expires_at') THEN
        ALTER TABLE teacher_profiles ADD COLUMN support_phone_otp_expires_at TIMESTAMP;
    END IF;

    -- Add address and location
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='address') THEN
        ALTER TABLE teacher_profiles ADD COLUMN address TEXT;
    END IF;

    -- Add social links
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='youtube_url') THEN
        ALTER TABLE teacher_profiles ADD COLUMN youtube_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='linkedin_url') THEN
        ALTER TABLE teacher_profiles ADD COLUMN linkedin_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='facebook_url') THEN
        ALTER TABLE teacher_profiles ADD COLUMN facebook_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='twitter_url') THEN
        ALTER TABLE teacher_profiles ADD COLUMN twitter_url TEXT;
    END IF;

    -- Update specialization to be JSONB array (already exists but ensure it's correct)
    -- Update experience to be JSONB array for structured data
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='education') THEN
        ALTER TABLE teacher_profiles ADD COLUMN education JSONB DEFAULT '[]'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='experience_new') THEN
        -- Convert existing experience TEXT to JSONB if it exists
        ALTER TABLE teacher_profiles ADD COLUMN experience_new JSONB DEFAULT '[]'::jsonb;
        -- We'll handle migration of existing data separately if needed
    END IF;
    -- Drop old experience TEXT column if new one exists (after migration)
    -- For now, keep both and migrate in application code

    -- Update certifications to be JSONB array (already exists but ensure structure)
    -- Add certificate images support in the JSONB structure

    -- Add payment information (dummy for now)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='bank_accounts') THEN
        ALTER TABLE teacher_profiles ADD COLUMN bank_accounts JSONB DEFAULT '[]'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teacher_profiles' AND column_name='card_accounts') THEN
        ALTER TABLE teacher_profiles ADD COLUMN card_accounts JSONB DEFAULT '[]'::jsonb;
    END IF;

END $$;

-- Create indexes for verification queries
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_account_email ON teacher_profiles(account_email) WHERE account_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_support_email ON teacher_profiles(support_email) WHERE support_email IS NOT NULL;
