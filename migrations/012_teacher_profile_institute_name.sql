-- Add institute_name to teacher_profiles (personal institute/organization name)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_profiles' AND column_name = 'institute_name') THEN
        ALTER TABLE teacher_profiles ADD COLUMN institute_name TEXT;
    END IF;
END $$;
