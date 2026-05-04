-- Remote image URL for external listings when no uploaded thumbnail_path is set.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_thumbnail_url TEXT;

.
