-- Single-use invite links layered on top of teacher offline-access purchases.
-- A teacher generates one link per remaining paid slot; each link can be claimed
-- by exactly one student, who then gets free (amount_paid = 0) enrollment.
-- Nothing here removes or rewrites existing data.

CREATE TABLE IF NOT EXISTS teacher_offline_access_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES teacher_offline_access_purchases(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id),
  course_id UUID NOT NULL REFERENCES courses(id),
  token VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | claimed | revoked
  claimed_by UUID REFERENCES users(id),
  claimed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_toa_invites_purchase ON teacher_offline_access_invites(purchase_id);
CREATE INDEX IF NOT EXISTS idx_toa_invites_token ON teacher_offline_access_invites(token);
CREATE INDEX IF NOT EXISTS idx_toa_invites_teacher ON teacher_offline_access_invites(teacher_id);
CREATE INDEX IF NOT EXISTS idx_toa_invites_status ON teacher_offline_access_invites(status);

-- Link a claimed invite back to the per-student access tracking row, and record
-- how a given access was granted ('email' = teacher typed an email, 'invite' = link claim).
ALTER TABLE teacher_offline_student_accesses
  ADD COLUMN IF NOT EXISTS invite_id UUID REFERENCES teacher_offline_access_invites(id);
ALTER TABLE teacher_offline_student_accesses
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'email';
