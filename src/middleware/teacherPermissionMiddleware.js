const userService = require('../services/userService');
const teacherStaffService = require('../services/teacherStaffService');

/**
 * Resolve effective teacher workspace for owner teachers and staff users.
 * Sets:
 *   req.effectiveTeacherId
 *   req.isTeacherOwner (boolean)
 *   req.teacherPermissions (string[] | null) — null means owner (all permissions)
 */
async function resolveTeacherContext(req) {
  if (!req.user?.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  const user = await userService.findById(req.user.id);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  req.user.role = user.role;
  req.user.must_change_password = !!user.must_change_password;

  if (user.role === 'teacher') {
    req.effectiveTeacherId = user.id;
    req.isTeacherOwner = true;
    req.teacherPermissions = null;
    return;
  }

  if (user.role === 'teacher_staff') {
    const membership = await teacherStaffService.getActiveMembershipByStaffUserId(user.id);
    if (!membership) {
      const err = new Error('Staff account is disabled or not linked to a teacher.');
      err.status = 403;
      throw err;
    }
    req.effectiveTeacherId = membership.teacher_id;
    req.isTeacherOwner = false;
    req.teacherPermissions = membership.permissions || [];
    req.staffMembership = membership;
    return;
  }

  const err = new Error('Access denied. Teachers only.');
  err.status = 403;
  throw err;
}

async function attachTeacherContext(req, res, next) {
  try {
    await resolveTeacherContext(req);
    return next();
  } catch (error) {
    const status = error.status || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: error.message });
    }
    console.error('attachTeacherContext error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Require teacher owner OR staff with the given permission key.
 */
function requireTeacherPermission(permissionKey) {
  return async (req, res, next) => {
    try {
      await resolveTeacherContext(req);

      if (req.isTeacherOwner) {
        return next();
      }

      if (!permissionKey) {
        return next();
      }

      const allowed = Array.isArray(req.teacherPermissions)
        && req.teacherPermissions.includes(permissionKey);

      if (!allowed) {
        return res.status(403).json({
          error: `Access denied. Missing permission: ${permissionKey}`,
        });
      }
      return next();
    } catch (error) {
      const status = error.status || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
      }
      console.error('requireTeacherPermission error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

async function requireTeacherOwner(req, res, next) {
  try {
    await resolveTeacherContext(req);
    if (!req.isTeacherOwner) {
      return res.status(403).json({ error: 'Only the teacher owner can perform this action.' });
    }
    return next();
  } catch (error) {
    const status = error.status || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: error.message });
    }
    console.error('requireTeacherOwner error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  resolveTeacherContext,
  attachTeacherContext,
  requireTeacherPermission,
  requireTeacherOwner,
};
