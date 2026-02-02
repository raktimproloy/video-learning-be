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
    description TEXT,
    teacher_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Lessons table
CREATE TABLE IF NOT EXISTS lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    "order" INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    storage_path TEXT NOT NULL, -- e.g., /var/www/videos/course_1/lesson_1/
    signing_secret TEXT NOT NULL, -- A unique random string for this video
    is_live BOOLEAN DEFAULT false,
    owner_id UUID REFERENCES users(id),
    lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
    "order" INTEGER DEFAULT 0,
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
