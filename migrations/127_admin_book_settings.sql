-- Admin book share settings + per-teacher book percent override

ALTER TABLE admin_share_settings
    ADD COLUMN IF NOT EXISTS book_platform_percent NUMERIC(5, 2) DEFAULT 0
        CHECK (book_platform_percent IS NULL OR (book_platform_percent >= 0 AND book_platform_percent <= 100));

ALTER TABLE admin_share_settings
    ADD COLUMN IF NOT EXISTS book_max_preview_pages INT DEFAULT 3
        CHECK (book_max_preview_pages IS NULL OR (book_max_preview_pages >= 0 AND book_max_preview_pages <= 10));

ALTER TABLE admin_share_settings
    ADD COLUMN IF NOT EXISTS book_max_upload_mb INT DEFAULT 500
        CHECK (book_max_upload_mb IS NULL OR book_max_upload_mb > 0);

UPDATE admin_share_settings
SET
    book_platform_percent = COALESCE(book_platform_percent, 0),
    book_max_preview_pages = COALESCE(book_max_preview_pages, 3),
    book_max_upload_mb = COALESCE(book_max_upload_mb, 500)
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;

-- Per-teacher book platform % override (NULL = use global)
ALTER TABLE custom_user_percentages
    ADD COLUMN IF NOT EXISTS custom_book_percent NUMERIC(5, 2)
        CHECK (custom_book_percent IS NULL OR (custom_book_percent >= 0 AND custom_book_percent <= 100));
