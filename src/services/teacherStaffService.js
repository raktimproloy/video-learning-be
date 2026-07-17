/**
 * Teacher staff roles — create/manage internal institute staff accounts
 * scoped to an owner teacher with module-level permissions.
 *
 * Login email: {username}@{slug}.staff.{rootDomain}
 * (platform-owned identifier; not a real mailbox)
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const emailService = require('./emailService');
const {
  buildStaffEmailDomain,
  buildStaffEmail,
} = require('../utils/staffEmail');
const { invalidateUserBootstrap } = require('../utils/bootstrapCache');

const ALL_PERMISSIONS = [
  'dashboard',
  'settings',
  'courses',
  'assignments',
  'announcements',
  'recordings',
  'coupons',
  'students',
  'payments',
  'analytics',
  'staff',
];

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'support', 'help', 'api', 'www', 'mail', 'root',
  'teacher', 'teachers', 'student', 'students', 'principal', 'null', 'undefined',
  'system', 'noreply', 'no-reply', 'billing', 'security', 'info', 'contact',
]);

const USERNAME_REGEX = /^[a-z0-9]([a-z0-9._-]{1,30}[a-z0-9])?$/;

function normalizeUsername(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.+/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
}

/**
 * Build login domain from institute slug → e.g. excellence-academy.staff.shikkhabhumi.com
 */
function domainFromInstitute(row) {
  return buildStaffEmailDomain(row);
}

function validateUsernameFormat(raw) {
  const username = normalizeUsername(raw);
  if (!username || username.length < 3 || username.length > 32) {
    return { ok: false, error: 'Username must be 3–32 characters.' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { ok: false, error: 'Username may only use lowercase letters, numbers, dots, underscores, and hyphens.' };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, error: 'This username is reserved. Please choose another.' };
  }
  return { ok: true, username };
}

function normalizePermissions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const allowed = new Set(ALL_PERMISSIONS);
  const out = [];
  const seen = new Set();
  for (const key of list) {
    const k = String(key || '').trim();
    if (!allowed.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(14);
  let pwd = '';
  for (let i = 0; i < 14; i++) {
    pwd += alphabet[bytes[i] % alphabet.length];
  }
  return pwd;
}

function validatePassword(raw) {
  const password = String(raw || '');
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (password.length > 128) {
    return { ok: false, error: 'Password is too long.' };
  }
  return { ok: true, password };
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

class TeacherStaffService {
  getAllPermissions() {
    return [...ALL_PERMISSIONS];
  }

  async resolveEmailDomain(teacherId) {
    const result = await db.query(
      `SELECT slug, name, status FROM teacher_institutes WHERE teacher_id = $1 LIMIT 1`,
      [teacherId]
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active') {
      return {
        ok: false,
        domain: null,
        error: 'Set up and activate your institute (with a subdomain) before creating staff users.',
      };
    }
    const domain = domainFromInstitute(row);
    if (!domain) {
      return {
        ok: false,
        domain: null,
        error: 'Institute subdomain is required. Save your institute setup first.',
      };
    }
    return { ok: true, domain, instituteName: row.name, slug: row.slug };
  }

  async validateUsername(teacherId, raw) {
    const format = validateUsernameFormat(raw);
    if (!format.ok) return format;
    const domainRes = await this.resolveEmailDomain(teacherId);
    if (!domainRes.ok) {
      return { ok: false, error: domainRes.error };
    }
    return {
      ok: true,
      username: format.username,
      email: buildStaffEmail(format.username, domainRes.domain),
      domain: domainRes.domain,
    };
  }

  async getActiveMembershipByStaffUserId(staffUserId) {
    const result = await db.query(
      `SELECT m.*, u.email AS staff_email, u.must_change_password
       FROM teacher_staff_members m
       JOIN users u ON u.id = m.staff_user_id
       WHERE m.staff_user_id = $1 AND m.status = 'active' AND u.role = 'teacher_staff'
       LIMIT 1`,
      [staffUserId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const permissions = await this.getPermissions(row.teacher_id, row.staff_user_id);
    return {
      id: row.id,
      teacher_id: row.teacher_id,
      staff_user_id: row.staff_user_id,
      display_name: row.display_name,
      status: row.status,
      email: row.staff_email,
      must_change_password: !!row.must_change_password,
      permissions,
    };
  }

  async getPermissions(teacherId, staffUserId) {
    const result = await db.query(
      `SELECT permission_key FROM teacher_staff_permissions
       WHERE teacher_id = $1 AND staff_user_id = $2
       ORDER BY permission_key`,
      [teacherId, staffUserId]
    );
    return result.rows.map((r) => r.permission_key);
  }

  async hasPermission(staffUserId, permissionKey) {
    const membership = await this.getActiveMembershipByStaffUserId(staffUserId);
    if (!membership) return false;
    return membership.permissions.includes(permissionKey);
  }

  async listByTeacher(teacherId) {
    const result = await db.query(
      `SELECT m.id, m.teacher_id, m.staff_user_id, m.display_name, m.status,
              m.is_internal_email, m.temporary_password, m.created_at, m.updated_at,
              u.email, u.must_change_password, u.created_at AS user_created_at
       FROM teacher_staff_members m
       JOIN users u ON u.id = m.staff_user_id
       WHERE m.teacher_id = $1
       ORDER BY m.created_at DESC`,
      [teacherId]
    );

    const members = [];
    for (const row of result.rows) {
      const permissions = await this.getPermissions(teacherId, row.staff_user_id);
      const showPassword = !!row.temporary_password;
      members.push({
        id: row.id,
        teacher_id: row.teacher_id,
        staff_user_id: row.staff_user_id,
        display_name: row.display_name,
        status: row.status,
        email: row.email,
        must_change_password: !!row.must_change_password,
        temporary_password: showPassword ? row.temporary_password : null,
        is_internal_email: !!row.is_internal_email,
        permissions,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
    return members;
  }

  async createStaff(teacherId, { username, displayName, permissions, password }) {
    const validated = await this.validateUsername(teacherId, username);
    if (!validated.ok) {
      const err = new Error(validated.error);
      err.status = 400;
      throw err;
    }

    const name = String(displayName || '').trim();
    if (!name) {
      const err = new Error('Display name is required.');
      err.status = 400;
      throw err;
    }

    const perms = normalizePermissions(permissions);
    if (perms.length === 0) {
      const err = new Error('Select at least one permission.');
      err.status = 400;
      throw err;
    }

    let plainPassword;
    const provided = password !== undefined && password !== null && String(password).trim() !== '';
    if (provided) {
      const pwdCheck = validatePassword(password);
      if (!pwdCheck.ok) {
        const err = new Error(pwdCheck.error);
        err.status = 400;
        throw err;
      }
      plainPassword = pwdCheck.password;
    } else {
      plainPassword = generateTemporaryPassword();
    }

    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [validated.email]);
    if (existing.rows.length > 0) {
      const err = new Error('This email is already in use.');
      err.status = 409;
      throw err;
    }

    const passwordHash = await hashPassword(plainPassword);

    const client = await db.pool.connect();
    let staffUser;
    let member;
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, role, name, onboarding_completed, must_change_password)
         VALUES ($1, $2, 'teacher_staff', $3, TRUE, FALSE)
         RETURNING id, email, role, name, must_change_password, created_at`,
        [validated.email, passwordHash, name]
      );
      staffUser = userRes.rows[0];

      const memberRes = await client.query(
        `INSERT INTO teacher_staff_members (teacher_id, staff_user_id, display_name, status, is_internal_email, temporary_password)
         VALUES ($1, $2, $3, 'active', TRUE, $4)
         RETURNING *`,
        [teacherId, staffUser.id, name, plainPassword]
      );
      member = memberRes.rows[0];

      for (const key of perms) {
        await client.query(
          `INSERT INTO teacher_staff_permissions (teacher_id, staff_user_id, permission_key)
           VALUES ($1, $2, $3)`,
          [teacherId, staffUser.id, key]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e && e.code === '23505') {
        const err = new Error('This email is already in use.');
        err.status = 409;
        throw err;
      }
      throw e;
    } finally {
      client.release();
    }

    invalidateUserBootstrap(staffUser.id);

    let emailSent = false;
    try {
      if (emailService.isConfigured && typeof emailService.sendStaffCredentialsEmail === 'function') {
        await emailService.sendStaffCredentialsEmail(validated.email, {
          displayName: name,
          temporaryPassword: plainPassword,
          loginEmail: validated.email,
        });
        emailSent = true;
      }
    } catch (mailErr) {
      console.warn('[TeacherStaff] Failed to email credentials:', mailErr.message);
    }

    return {
      member: {
        id: member.id,
        teacher_id: teacherId,
        staff_user_id: staffUser.id,
        display_name: name,
        status: 'active',
        email: validated.email,
        must_change_password: false,
        temporary_password: plainPassword,
        is_internal_email: true,
        permissions: perms,
        created_at: member.created_at,
        updated_at: member.updated_at,
      },
      temporaryPassword: plainPassword,
      emailSent,
      emailDomain: validated.domain,
    };
  }

  async updateStaff(teacherId, memberId, { displayName, status, permissions }) {
    const existing = await db.query(
      `SELECT * FROM teacher_staff_members WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
      [memberId, teacherId]
    );
    if (existing.rows.length === 0) {
      const err = new Error('Staff user not found.');
      err.status = 404;
      throw err;
    }
    const row = existing.rows[0];

    const name = displayName !== undefined ? String(displayName || '').trim() : row.display_name;
    if (!name) {
      const err = new Error('Display name is required.');
      err.status = 400;
      throw err;
    }

    let nextStatus = row.status;
    if (status !== undefined) {
      if (!['active', 'disabled'].includes(status)) {
        const err = new Error('Invalid status.');
        err.status = 400;
        throw err;
      }
      nextStatus = status;
    }

    const perms = permissions !== undefined ? normalizePermissions(permissions) : null;
    if (perms && perms.length === 0) {
      const err = new Error('Select at least one permission.');
      err.status = 400;
      throw err;
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE teacher_staff_members SET display_name = $1, status = $2 WHERE id = $3`,
        [name, nextStatus, memberId]
      );
      await client.query(`UPDATE users SET name = $1 WHERE id = $2`, [name, row.staff_user_id]);

      if (perms) {
        await client.query(
          `DELETE FROM teacher_staff_permissions WHERE teacher_id = $1 AND staff_user_id = $2`,
          [teacherId, row.staff_user_id]
        );
        for (const key of perms) {
          await client.query(
            `INSERT INTO teacher_staff_permissions (teacher_id, staff_user_id, permission_key)
             VALUES ($1, $2, $3)`,
            [teacherId, row.staff_user_id, key]
          );
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    invalidateUserBootstrap(row.staff_user_id);

    const list = await this.listByTeacher(teacherId);
    return list.find((m) => m.id === memberId) || null;
  }

  async setPassword(teacherId, memberId, password) {
    const existing = await db.query(
      `SELECT m.*, u.email FROM teacher_staff_members m
       JOIN users u ON u.id = m.staff_user_id
       WHERE m.id = $1 AND m.teacher_id = $2 LIMIT 1`,
      [memberId, teacherId]
    );
    if (existing.rows.length === 0) {
      const err = new Error('Staff user not found.');
      err.status = 404;
      throw err;
    }
    const row = existing.rows[0];
    const pwdCheck = validatePassword(password);
    if (!pwdCheck.ok) {
      const err = new Error(pwdCheck.error);
      err.status = 400;
      throw err;
    }
    const plainPassword = pwdCheck.password;
    const passwordHash = await hashPassword(plainPassword);

    await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2`,
      [passwordHash, row.staff_user_id]
    );
    await db.query(
      `UPDATE teacher_staff_members SET temporary_password = $1 WHERE id = $2`,
      [plainPassword, memberId]
    );

    invalidateUserBootstrap(row.staff_user_id);

    const list = await this.listByTeacher(teacherId);
    const member = list.find((m) => m.id === memberId) || null;

    return { password: plainPassword, email: row.email, member };
  }

  async deleteStaff(teacherId, memberId) {
    const existing = await db.query(
      `SELECT m.*, u.id AS user_id FROM teacher_staff_members m
       JOIN users u ON u.id = m.staff_user_id
       WHERE m.id = $1 AND m.teacher_id = $2 LIMIT 1`,
      [memberId, teacherId]
    );
    if (existing.rows.length === 0) {
      const err = new Error('Staff user not found.');
      err.status = 404;
      throw err;
    }
    const row = existing.rows[0];

    invalidateUserBootstrap(row.user_id);

    // Hard delete user — cascades membership + permissions
    await db.query(`DELETE FROM users WHERE id = $1 AND role = 'teacher_staff'`, [row.user_id]);

    return { deleted: true, id: memberId, staff_user_id: row.user_id };
  }

  async clearMustChangePassword(userId) {
    await db.query(`UPDATE users SET must_change_password = FALSE WHERE id = $1`, [userId]);
    await db.query(
      `UPDATE teacher_staff_members SET temporary_password = NULL WHERE staff_user_id = $1`,
      [userId]
    );
  }
}

module.exports = new TeacherStaffService();
module.exports.ALL_PERMISSIONS = ALL_PERMISSIONS;
module.exports.validateUsernameFormat = validateUsernameFormat;
module.exports.normalizePermissions = normalizePermissions;
module.exports.domainFromInstitute = domainFromInstitute;
