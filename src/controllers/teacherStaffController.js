const teacherStaffService = require('../services/teacherStaffService');

class TeacherStaffController {
  async list(req, res) {
    try {
      const teacherId = req.effectiveTeacherId;
      const members = await teacherStaffService.listByTeacher(teacherId);
      const domainRes = await teacherStaffService.resolveEmailDomain(teacherId);
      return res.json({
        members,
        permissionsCatalog: teacherStaffService.getAllPermissions(),
        emailDomain: domainRes.ok ? domainRes.domain : null,
        emailDomainError: domainRes.ok ? null : domainRes.error,
      });
    } catch (error) {
      console.error('List teacher staff error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async create(req, res) {
    try {
      const teacherId = req.effectiveTeacherId;
      const { username, displayName, display_name, permissions, password } = req.body || {};
      const result = await teacherStaffService.createStaff(teacherId, {
        username,
        displayName: displayName || display_name,
        permissions,
        password,
      });
      return res.status(201).json({
        message: 'Staff user created',
        member: result.member,
        temporaryPassword: result.temporaryPassword,
        emailSent: result.emailSent,
        emailDomain: result.emailDomain,
      });
    } catch (error) {
      console.error('Create teacher staff error:', error);
      const status = error.status || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async update(req, res) {
    try {
      const teacherId = req.effectiveTeacherId;
      const member = await teacherStaffService.updateStaff(teacherId, req.params.id, {
        displayName: req.body.displayName || req.body.display_name,
        status: req.body.status,
        permissions: req.body.permissions,
      });
      return res.json({ message: 'Staff user updated', member });
    } catch (error) {
      console.error('Update teacher staff error:', error);
      const status = error.status || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async setPassword(req, res) {
    try {
      const teacherId = req.effectiveTeacherId;
      const password = req.body?.password;
      const result = await teacherStaffService.setPassword(teacherId, req.params.id, password);
      return res.json({
        message: 'Password updated',
        password: result.password,
        email: result.email,
        member: result.member,
      });
    } catch (error) {
      console.error('Set teacher staff password error:', error);
      const status = error.status || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async remove(req, res) {
    try {
      const teacherId = req.effectiveTeacherId;
      const result = await teacherStaffService.deleteStaff(teacherId, req.params.id);
      return res.json({ message: 'Staff user deleted', ...result });
    } catch (error) {
      console.error('Delete teacher staff error:', error);
      const status = error.status || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async checkUsername(req, res) {
    try {
      const teacherId = req.effectiveTeacherId;
      const result = await teacherStaffService.validateUsername(teacherId, req.query.username);
      if (!result.ok) {
        return res.json({
          available: false,
          message: result.error,
          username: null,
          email: null,
          domain: null,
        });
      }
      const db = require('../../db');
      const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [result.email]);
      if (existing.rows.length > 0) {
        return res.json({
          available: false,
          message: 'This email is already in use.',
          username: result.username,
          email: result.email,
          domain: result.domain,
        });
      }
      return res.json({
        available: true,
        message: 'Username is available.',
        username: result.username,
        email: result.email,
        domain: result.domain,
      });
    } catch (error) {
      console.error('Check staff username error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new TeacherStaffController();
