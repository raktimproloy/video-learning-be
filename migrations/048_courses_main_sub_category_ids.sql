-- Store main (level 0), sub (level 1), and specific (admin_category_id = leaf) category IDs on courses.
-- Ensures frontend can pass and backend can store all three separately from /v1/settings category tree.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS main_category_id UUID REFERENCES admin_categories(id) ON DELETE SET NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS sub_category_id UUID REFERENCES admin_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_main_category ON courses(main_category_id);
CREATE INDEX IF NOT EXISTS idx_courses_sub_category ON courses(sub_category_id);

COMMENT ON COLUMN courses.main_category_id IS 'Level 0 category from admin_categories (e.g. Academic, Skill-based).';
COMMENT ON COLUMN courses.sub_category_id IS 'Level 1 category from admin_categories; null if course is assigned only to main.';
COMMENT ON COLUMN courses.admin_category_id IS 'Leaf/specific category (level 0, 1, or 2) - the category the course is directly under.';
