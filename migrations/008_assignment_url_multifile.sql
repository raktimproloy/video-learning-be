-- Add url_link for URL submissions, files_json for multiple files
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS url_link TEXT;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS files_json JSONB;
