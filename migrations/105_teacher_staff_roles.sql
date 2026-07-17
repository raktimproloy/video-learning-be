-- Teacher staff roles: owner teachers can create scoped @shikkhabhumi.com staff accounts

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS teacher_staff_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    is_internal_email BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT teacher_staff_members_staff_unique UNIQUE (staff_user_id),
    CONSTRAINT teacher_staff_members_teacher_staff_unique UNIQUE (teacher_id, staff_user_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_staff_members_teacher_id ON teacher_staff_members(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_staff_members_staff_user_id ON teacher_staff_members(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_staff_members_status ON teacher_staff_members(status);

CREATE TABLE IF NOT EXISTS teacher_staff_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT teacher_staff_permissions_unique UNIQUE (teacher_id, staff_user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_teacher_staff_permissions_staff ON teacher_staff_permissions(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_staff_permissions_teacher ON teacher_staff_permissions(teacher_id);

COMMENT ON TABLE teacher_staff_members IS 'Staff users created by a teacher owner; scoped to that teacher workspace';
COMMENT ON TABLE teacher_staff_permissions IS 'Permission keys granted to teacher staff users';
COMMENT ON COLUMN users.must_change_password IS 'When true, user must change temporary password after login';

CREATE OR REPLACE FUNCTION update_teacher_staff_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_teacher_staff_members_updated_at ON teacher_staff_members;
CREATE TRIGGER trigger_teacher_staff_members_updated_at
    BEFORE UPDATE ON teacher_staff_members
    FOR EACH ROW EXECUTE FUNCTION update_teacher_staff_members_updated_at();
