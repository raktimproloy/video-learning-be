-- page_path (VARCHAR 255) was overflowing on real URLs with long query strings,
-- causing "value too long for type character varying(255)" and dropping the
-- page-view log entirely. Widen to unbounded TEXT instead of truncating, since
-- these are analytics fields where losing the full path/domain isn't acceptable
-- but a length cap serves no real purpose.
ALTER TABLE page_views ALTER COLUMN page_path TYPE TEXT;
ALTER TABLE page_views ALTER COLUMN referrer_domain TYPE TEXT;
