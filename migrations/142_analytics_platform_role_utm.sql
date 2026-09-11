-- Extends page_views for cross-platform (web+app), role-segmented, campaign-aware
-- analytics with a normalized page template for dynamic routes. See
-- C:\Users\Malware\.claude\plans\mutable-brewing-crane.md for the full plan.

ALTER TABLE page_views ADD COLUMN IF NOT EXISTS platform VARCHAR(20) NOT NULL DEFAULT 'web';
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS visitor_id VARCHAR(100);
-- Role at the time of the visit (student/teacher/null=guest) — captured at insert
-- time so a later role change never rewrites the attribution of past visits.
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS role VARCHAR(20);
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_source VARCHAR(255);
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(255);
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(255);
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_term VARCHAR(255);
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255);
-- Dynamic-segment-normalized path (e.g. /watch/:id) so aggregate reports don't
-- drown in one-off UUIDs; page_path keeps the real path for drill-in.
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS page_template TEXT;

CREATE INDEX IF NOT EXISTS idx_page_views_platform ON page_views(platform);
CREATE INDEX IF NOT EXISTS idx_page_views_visitor_id ON page_views(visitor_id) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_page_views_role ON page_views(role) WHERE role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_page_views_utm_source ON page_views(utm_source) WHERE utm_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_page_views_page_template ON page_views(page_template);
