-- Category system: 3 levels max, course_count, admin_category_id on courses

-- Add level to admin_categories (0=root, 1=child, 2=grandchild)
ALTER TABLE admin_categories ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 0;
UPDATE admin_categories SET level = 0 WHERE parent_id IS NULL;
UPDATE admin_categories c SET level = 1 FROM admin_categories p WHERE c.parent_id = p.id AND p.level = 0;
UPDATE admin_categories c SET level = 2 FROM admin_categories p WHERE c.parent_id = p.id AND p.level = 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_admin_categories_level') THEN
    ALTER TABLE admin_categories ADD CONSTRAINT chk_admin_categories_level CHECK (level >= 0 AND level <= 2);
  END IF;
END $$;

-- Add course_count (incremented when course uses category, decremented when course removed)
ALTER TABLE admin_categories ADD COLUMN IF NOT EXISTS course_count INTEGER NOT NULL DEFAULT 0;

-- Add admin_category_id to courses (links to leaf category)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS admin_category_id UUID REFERENCES admin_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_courses_admin_category ON courses(admin_category_id);

-- Initialize course_count from existing courses (if we migrate from category/subcategory later)
-- For now leave at 0; courseCount will be updated when teachers use admin_category_id
