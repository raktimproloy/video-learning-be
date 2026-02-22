-- Add display_order for ordering child categories (siblings)
ALTER TABLE admin_categories ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_admin_categories_parent_order ON admin_categories(parent_id, display_order);
