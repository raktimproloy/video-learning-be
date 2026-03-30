-- Add Core Member flag to users (applies to both student + teacher accounts)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS core_member BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_core_member ON users(core_member);

