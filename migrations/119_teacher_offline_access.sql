-- 1. Teacher offline access purchases table
CREATE TABLE IF NOT EXISTS teacher_offline_access_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id),
  course_id UUID NOT NULL REFERENCES courses(id),
  student_count INTEGER NOT NULL,
  course_price_at_time NUMERIC(12,2) NOT NULL,
  fee_per_student NUMERIC(12,2) NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'BDT',
  payment_method VARCHAR(50),
  sender_phone VARCHAR(50),
  transaction_id VARCHAR(200),
  status VARCHAR(20) DEFAULT 'pending',
  is_active BOOLEAN DEFAULT true,
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Per-student access tracking
CREATE TABLE IF NOT EXISTS teacher_offline_student_accesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES teacher_offline_access_purchases(id),
  teacher_id UUID NOT NULL REFERENCES users(id),
  course_id UUID NOT NULL REFERENCES courses(id),
  student_email VARCHAR(255) NOT NULL,
  student_user_id UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- 3. courses table extra_data column
ALTER TABLE courses ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';

-- 4. course_enrollments table is_active column (for toggling access)
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
