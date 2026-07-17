-- Collapse granular staff permissions (area:action) into module-level keys.

-- Map any existing grant into its module key
INSERT INTO teacher_staff_permissions (teacher_id, staff_user_id, permission_key)
SELECT DISTINCT
  teacher_id,
  staff_user_id,
  CASE
    WHEN permission_key LIKE 'dashboard%' THEN 'dashboard'
    WHEN permission_key LIKE 'profile%' THEN 'profile'
    WHEN permission_key LIKE 'institute%' THEN 'institute'
    WHEN permission_key LIKE 'courses%' OR permission_key LIKE 'notes%' THEN 'courses'
    WHEN permission_key LIKE 'assignments%' THEN 'assignments'
    WHEN permission_key LIKE 'announcements%' THEN 'announcements'
    WHEN permission_key LIKE 'recordings%' THEN 'recordings'
    WHEN permission_key LIKE 'coupons%' THEN 'coupons'
    WHEN permission_key LIKE 'students%' THEN 'students'
    WHEN permission_key LIKE 'payments%' THEN 'payments'
    WHEN permission_key LIKE 'analytics%' THEN 'analytics'
    WHEN permission_key LIKE 'staff%' THEN 'staff'
    ELSE NULL
  END AS permission_key
FROM teacher_staff_permissions
WHERE permission_key LIKE '%:%'
ON CONFLICT DO NOTHING;

-- Remove old granular keys
DELETE FROM teacher_staff_permissions WHERE permission_key LIKE '%:%';

-- Drop any accidental NULL inserts (should not exist due to CASE ELSE NULL + conflict)
DELETE FROM teacher_staff_permissions WHERE permission_key IS NULL;
