-- Remap existing teacher_staff emails onto the platform-owned staff namespace:
--   {local}@{institute-slug}.staff.shikkhabhumi.com
--
-- Root domain is shikkhabhumi.com in SQL; override via app env for new creates.
-- Skips rows that already use *.staff.*

UPDATE users u
SET email = lower(
  split_part(u.email, '@', 1)
  || '@'
  || ti.slug
  || '.staff.shikkhabhumi.com'
)
FROM teacher_staff_members m
JOIN teacher_institutes ti ON ti.teacher_id = m.teacher_id
WHERE u.id = m.staff_user_id
  AND u.role = 'teacher_staff'
  AND ti.slug IS NOT NULL
  AND length(trim(ti.slug)) >= 2
  AND ti.slug !~* '^d-'
  AND lower(u.email) !~* '\.staff\.'
  AND NOT EXISTS (
    SELECT 1 FROM users u2
    WHERE lower(u2.email) = lower(
      split_part(u.email, '@', 1)
      || '@'
      || ti.slug
      || '.staff.shikkhabhumi.com'
    )
    AND u2.id <> u.id
  );
