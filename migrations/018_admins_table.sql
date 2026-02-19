-- Admins are stored in users table with role='admin'
-- Add name column to users for admin display (optional, can use email)
-- Ensure we have index for admin lookup
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email_role ON users(email, role);
