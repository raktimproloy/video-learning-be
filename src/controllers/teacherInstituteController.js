const path = require('path');
const teacherInstituteService = require('../services/teacherInstituteService');
const r2Storage = require('../services/r2StorageService');
const { getAllowedOrigin } = require('../config/cors');

function teacherId(req) {
  return req.effectiveTeacherId || req.user.id;
}

class TeacherInstituteController {
  async getMine(req, res) {
    try {
      const institute = await teacherInstituteService.getDefaultsForTeacher(teacherId(req));
      return res.json(institute);
    } catch (error) {
      console.error('Get institute error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async checkSlug(req, res) {
    try {
      const slug = req.query.slug;
      if (!slug) {
        return res.status(400).json({ error: 'slug query parameter is required' });
      }
      const result = await teacherInstituteService.checkSlugAvailability(teacherId(req), slug);
      return res.json(result);
    } catch (error) {
      console.error('Check slug error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async upsert(req, res) {
    try {
      const payload = {
        slug: req.body.slug,
        name: req.body.name,
        tagline: req.body.tagline,
        address: req.body.address,
        city: req.body.city,
        email: req.body.email,
        phone: req.body.phone,
        helpline: req.body.helpline,
        whatsapp: req.body.whatsapp,
        fiscal_year: req.body.fiscal_year || req.body.fiscalYear,
        social_links: req.body.social_links || req.body.socialLinks,
        operating_hours: req.body.operating_hours || req.body.operatingHours,
        offered_subjects: req.body.offered_subjects || req.body.offeredSubjects,
        status: req.body.status || 'active',
      };

      const institute = await teacherInstituteService.upsertInstitute(
        teacherId(req),
        payload,
        req.files || {}
      );
      return res.json({ message: 'Institute saved', institute });
    } catch (error) {
      console.error('Upsert institute error:', error);
      const status = error.status || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async requestPhoneOtp(req, res) {
    try {
      const phone = req.body.phone;
      const result = await teacherInstituteService.requestPhoneOtp(teacherId(req), phone);
      return res.json(result);
    } catch (error) {
      console.error('Institute phone OTP request error:', error);
      const status = error.status || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async verifyPhoneOtp(req, res) {
    try {
      const institute = await teacherInstituteService.verifyPhoneOtp(teacherId(req), req.body.otp);
      return res.json({ message: 'Phone verified', institute });
    } catch (error) {
      console.error('Institute phone OTP verify error:', error);
      const status = error.status || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getPublic(req, res) {
    try {
      const institute = await teacherInstituteService.getPublicBySlug(req.params.slug);
      if (!institute) {
        return res.status(404).json({ error: 'Institute not found' });
      }
      return res.json(institute);
    } catch (error) {
      console.error('Get public institute error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async streamMedia(req, res) {
    try {
      const imagePath = req.params.key || '';
      if (!imagePath || !imagePath.startsWith('teachers/') || !imagePath.includes('/institutes/')) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const exists = await r2Storage.objectExists(imagePath);
      if (!exists) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const ext = path.extname(imagePath).toLowerCase();
      const contentTypeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const contentType = contentTypeMap[ext] || 'image/jpeg';

      const headers = {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      };
      const allowOrigin = getAllowedOrigin(req.get('Origin'));
      if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
      res.set(headers);

      const stream = await r2Storage.getObjectStream(imagePath);
      stream.pipe(res);
    } catch (error) {
      console.error('Stream institute media error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new TeacherInstituteController();
