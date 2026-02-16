-- Update courses table to include all fields from course creation form

-- Add new columns if they don't exist
DO $$
BEGIN
    -- Basic fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='short_description') THEN
        ALTER TABLE courses ADD COLUMN short_description TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='full_description') THEN
        ALTER TABLE courses ADD COLUMN full_description TEXT;
    END IF;
    
    -- Category and classification
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='category') THEN
        ALTER TABLE courses ADD COLUMN category TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='subcategory') THEN
        ALTER TABLE courses ADD COLUMN subcategory TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='level') THEN
        ALTER TABLE courses ADD COLUMN level TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='course_type') THEN
        ALTER TABLE courses ADD COLUMN course_type TEXT CHECK (course_type IN ('lesson-based', 'video-based'));
    END IF;
    
    -- Tags
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='tags') THEN
        ALTER TABLE courses ADD COLUMN tags JSONB DEFAULT '[]'::jsonb;
    END IF;
    
    -- Language and localization
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='language') THEN
        ALTER TABLE courses ADD COLUMN language TEXT DEFAULT 'English';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='subtitle') THEN
        ALTER TABLE courses ADD COLUMN subtitle TEXT;
    END IF;
    
    -- Media
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='thumbnail_path') THEN
        ALTER TABLE courses ADD COLUMN thumbnail_path TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='intro_video_path') THEN
        ALTER TABLE courses ADD COLUMN intro_video_path TEXT;
    END IF;
    
    -- Pricing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='price') THEN
        ALTER TABLE courses ADD COLUMN price DECIMAL(10, 2);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='discount_price') THEN
        ALTER TABLE courses ADD COLUMN discount_price DECIMAL(10, 2);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='currency') THEN
        ALTER TABLE courses ADD COLUMN currency TEXT DEFAULT 'USD';
    END IF;
    
    -- Features
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='has_live_class') THEN
        ALTER TABLE courses ADD COLUMN has_live_class BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='has_assignments') THEN
        ALTER TABLE courses ADD COLUMN has_assignments BOOLEAN DEFAULT false;
    END IF;
    
    -- Timestamps
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='updated_at') THEN
        ALTER TABLE courses ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
    END IF;
END
$$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
CREATE INDEX IF NOT EXISTS idx_courses_level ON courses(level);
CREATE INDEX IF NOT EXISTS idx_courses_course_type ON courses(course_type);
CREATE INDEX IF NOT EXISTS idx_courses_teacher_id ON courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_courses_created_at ON courses(created_at DESC);
