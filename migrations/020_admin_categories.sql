-- Hierarchical categories table for admin management
-- Structure: main category (parent_id NULL) > children > children
-- e.g. Skill-based > Web Development > Next.js

CREATE TABLE IF NOT EXISTS admin_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES admin_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique slug: per root (main categories) and per parent (children)
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_categories_slug_root 
    ON admin_categories (slug) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_categories_parent_slug 
    ON admin_categories (parent_id, slug) WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_categories_parent_id ON admin_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_admin_categories_status ON admin_categories(status);
CREATE INDEX IF NOT EXISTS idx_admin_categories_created_at ON admin_categories(created_at DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION admin_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_admin_categories_updated_at ON admin_categories;
CREATE TRIGGER trigger_admin_categories_updated_at
    BEFORE UPDATE ON admin_categories
    FOR EACH ROW EXECUTE FUNCTION admin_categories_updated_at();
