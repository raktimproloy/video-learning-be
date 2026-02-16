-- Teacher Profiles table
CREATE TABLE IF NOT EXISTS teacher_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT,
    bio TEXT,
    location TEXT,
    avatar TEXT,
    specialization JSONB DEFAULT '[]'::jsonb,
    experience TEXT,
    certifications JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_user_id ON teacher_profiles(user_id);
