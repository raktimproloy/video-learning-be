-- Store temporary staff passwords so owners can reveal them in the staff list
-- until the staff user changes password (must_change_password becomes false).

ALTER TABLE teacher_staff_members
  ADD COLUMN IF NOT EXISTS temporary_password TEXT;

COMMENT ON COLUMN teacher_staff_members.temporary_password IS
  'Plain temporary password for owner display while must_change_password is true; cleared after staff changes password.';
