-- Add settings module permission; map profile/institute → settings

INSERT INTO teacher_staff_permissions (teacher_id, staff_user_id, permission_key)
SELECT DISTINCT teacher_id, staff_user_id, 'settings'
FROM teacher_staff_permissions
WHERE permission_key IN ('profile', 'institute', 'profile:view', 'profile:update', 'institute:view', 'institute:update')
ON CONFLICT DO NOTHING;

DELETE FROM teacher_staff_permissions
WHERE permission_key IN ('profile', 'institute', 'profile:view', 'profile:update', 'institute:view', 'institute:update');
