-- Add Bangla (Bengali) title support for admin categories.
-- name = English title (required, used for slug); name_bn = Bangla title (optional).

ALTER TABLE admin_categories
    ADD COLUMN IF NOT EXISTS name_bn TEXT;

COMMENT ON COLUMN admin_categories.name IS 'Category title in English (used for URL slug)';
COMMENT ON COLUMN admin_categories.name_bn IS 'Category title in Bangla/Bengali (optional)';

-- Backfill: existing rows keep name as-is; name_bn remains NULL until edited in admin.
