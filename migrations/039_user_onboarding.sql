-- Add basic profile & onboarding fields to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_role TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_category TEXT;

