-- Basic Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'student',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT, -- For backward compatibility
    short_description TEXT,
    full_description TEXT,
    teacher_id UUID REFERENCES users(id),
    category TEXT,
    subcategory TEXT,
    tags JSONB DEFAULT '[]'::jsonb,
    language TEXT DEFAULT 'English',
    subtitle TEXT,
    level TEXT,
    course_type TEXT CHECK (course_type IN ('lesson-based', 'video-based')),
    thumbnail_path TEXT,
    intro_video_path TEXT,
    price DECIMAL(10, 2),
    discount_price DECIMAL(10, 2),
    currency TEXT DEFAULT 'USD',
    has_live_class BOOLEAN DEFAULT false,
    has_assignments BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
CREATE INDEX IF NOT EXISTS idx_courses_level ON courses(level);
CREATE INDEX IF NOT EXISTS idx_courses_course_type ON courses(course_type);
CREATE INDEX IF NOT EXISTS idx_courses_teacher_id ON courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_courses_created_at ON courses(created_at DESC);

-- Lessons table
CREATE TABLE IF NOT EXISTS lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    "order" INTEGER DEFAULT 0,
    is_live BOOLEAN DEFAULT false,
    is_preview BOOLEAN DEFAULT false,
    video_url TEXT,
    notes JSONB DEFAULT '[]'::jsonb,
    assignments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    storage_path TEXT NOT NULL,
    signing_secret TEXT NOT NULL,
    is_live BOOLEAN DEFAULT false,
    is_preview BOOLEAN DEFAULT false,
    duration_seconds DECIMAL(10, 2),
    owner_id UUID REFERENCES users(id),
    lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
    "order" INTEGER DEFAULT 0,
    notes JSONB DEFAULT '[]'::jsonb,
    assignments JSONB DEFAULT '[]'::jsonb,
    storage_provider TEXT NOT NULL DEFAULT 'local' CHECK (storage_provider IN ('local', 'r2')),
    r2_key TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'processing')),
    created_at TIMESTAMP DEFAULT NOW(),
    size_bytes BIGINT DEFAULT 0
);

-- User Permissions table
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id UUID REFERENCES users(id),
    video_id UUID REFERENCES videos(id),
    expires_at TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, video_id)
);

-- Video Processing Tasks table
CREATE TABLE IF NOT EXISTS video_processing_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    codec_preference TEXT NOT NULL CHECK (codec_preference IN ('h264', 'h265')),
    resolutions TEXT[] NOT NULL,
    crf INTEGER,
    compress BOOLEAN DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Course Enrollments table (Purchases)
CREATE TABLE IF NOT EXISTS course_enrollments (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, course_id)
);

-- Teacher Profiles table
CREATE TABLE IF NOT EXISTS teacher_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT,
    bio TEXT,
    location TEXT,
    avatar TEXT,
    specialization JSONB DEFAULT '[]'::jsonb,
    experience TEXT,
    experience_new JSONB DEFAULT '[]'::jsonb,
    certifications JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    -- Profile image
    profile_image_path TEXT,
    -- Contact information with verification
    account_email TEXT,
    account_email_verified BOOLEAN DEFAULT false,
    account_email_otp TEXT,
    account_email_otp_expires_at TIMESTAMP,
    support_email TEXT,
    support_email_verified BOOLEAN DEFAULT false,
    support_email_otp TEXT,
    support_email_otp_expires_at TIMESTAMP,
    original_phone TEXT,
    original_phone_verified BOOLEAN DEFAULT false,
    original_phone_otp TEXT,
    original_phone_otp_expires_at TIMESTAMP,
    support_phone TEXT,
    support_phone_verified BOOLEAN DEFAULT false,
    support_phone_otp TEXT,
    support_phone_otp_expires_at TIMESTAMP,
    -- Address
    address TEXT,
    -- Personal institute/organization name
    institute_name TEXT,
    -- Social links
    youtube_url TEXT,
    linkedin_url TEXT,
    facebook_url TEXT,
    twitter_url TEXT,
    -- Education
    education JSONB DEFAULT '[]'::jsonb,
    -- Payment information
    bank_accounts JSONB DEFAULT '[]'::jsonb,
    card_accounts JSONB DEFAULT '[]'::jsonb
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_user_id ON teacher_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_account_email ON teacher_profiles(account_email) WHERE account_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_support_email ON teacher_profiles(support_email) WHERE support_email IS NOT NULL;

-- Student Profiles table
CREATE TABLE IF NOT EXISTS student_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT,
    phone TEXT,
    profile_image_path TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON student_profiles(user_id);

-- Assignment submissions (student submissions for video/lesson assignments)
CREATE TABLE IF NOT EXISTS assignment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignment_type TEXT NOT NULL CHECK (assignment_type IN ('video', 'lesson')),
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
    assignment_id TEXT NOT NULL,
    file_path TEXT,
    file_name TEXT,
    submitted_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT chk_video_or_lesson CHECK (
        (assignment_type = 'video' AND video_id IS NOT NULL AND lesson_id IS NULL) OR
        (assignment_type = 'lesson' AND lesson_id IS NOT NULL AND video_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_user ON assignment_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_video ON assignment_submissions(video_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_lesson ON assignment_submissions(lesson_id);
