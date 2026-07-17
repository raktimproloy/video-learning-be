/**
 * Teacher institute storefront service.
 * One institute per teacher; globally unique subdomain slug.
 */
const db = require('../../db');
const path = require('path');
const r2Storage = require('./r2StorageService');
const emailService = require('./emailService');
const smsService = require('./smsService');
const courseService = require('./courseService');
const announcementService = require('./announcementService');
const teacherReviewService = require('./teacherReviewService');

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SOCIAL_TYPES = new Set(['facebook', 'instagram', 'website']);
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

const RESERVED_SLUGS = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'ftp', 'cdn', 'static', 'assets', 'media',
  'auth', 'login', 'signup', 'register', 'teacher', 'teachers', 'student', 'students',
  'principal', 'support', 'help', 'status', 'blog', 'docs', 'dashboard', 'account',
  'accounts', 'billing', 'pay', 'payment', 'payments', 'webhook', 'webhooks', 'socket',
  'ws', 'wss', 'live', 'streaming', 'video', 'videos', 'course', 'courses', 'institute',
  'institutes', 'lms', 'platform', 'shikkhabhumi', 'www2', 'staging', 'dev', 'test',
  'preview', 'null', 'undefined',
]);

function getApiBase() {
  const apiUrl = process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000';
  return apiUrl.replace(/\/v1\/?$/, '');
}

function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateSlugFormat(slug) {
  if (!slug || slug.length < 3 || slug.length > 63) {
    return 'Subdomain must be 3–63 characters.';
  }
  if (!SLUG_REGEX.test(slug)) {
    return 'Subdomain must use lowercase letters, numbers, and dashes (cannot start/end with a dash).';
  }
  if (RESERVED_SLUGS.has(slug)) {
    return 'This subdomain is reserved. Please choose another.';
  }
  return null;
}

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeSocialLinks(raw) {
  const list = Array.isArray(raw) ? raw : parseJsonField(raw, []);
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const type = String(item.type || '').trim().toLowerCase();
    let url = String(item.url || '').trim();
    if (!SOCIAL_TYPES.has(type) || !url) continue;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      continue;
    }
    const key = `${type}:${url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, url });
  }
  return out.slice(0, 20);
}

function normalizeOperatingHours(raw) {
  const list = Array.isArray(raw) ? raw : parseJsonField(raw, []);
  const byDay = new Map();
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const day = String(item.day || '').trim();
      if (!DAYS_OF_WEEK.includes(day)) continue;
      const isOpen = !!item.isOpen;
      let openTime = String(item.openTime || '09:00').trim();
      let closeTime = String(item.closeTime || '17:00').trim();
      if (!/^\d{2}:\d{2}$/.test(openTime)) openTime = '09:00';
      if (!/^\d{2}:\d{2}$/.test(closeTime)) closeTime = '17:00';
      byDay.set(day, { day, isOpen, openTime, closeTime });
    }
  }
  return DAYS_OF_WEEK.map((day) => byDay.get(day) || {
    day,
    isOpen: day !== 'Friday' && day !== 'Saturday',
    openTime: '09:00',
    closeTime: '17:00',
  });
}

function normalizeOfferedSubjects(raw) {
  const list = Array.isArray(raw) ? raw : parseJsonField(raw, []);
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = String(item || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 50);
}

function enrichMediaUrls(row) {
  if (!row) return row;
  const base = getApiBase();
  const out = { ...row };
  if (out.logo_path) {
    out.logo_url = `${base}/v1/institutes/media/${encodeURIComponent(out.logo_path)}`;
  }
  if (out.cover_path) {
    out.cover_url = `${base}/v1/institutes/media/${encodeURIComponent(out.cover_path)}`;
  }
  return out;
}

function mapInstituteRow(row, { includeOtp = false } = {}) {
  if (!row) return null;
  const mapped = {
    id: row.id,
    teacher_id: row.teacher_id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline || '',
    logo_path: row.logo_path || null,
    cover_path: row.cover_path || null,
    address: row.address || '',
    city: row.city || '',
    email: row.email || '',
    phone: row.phone || '',
    phone_verified: !!row.phone_verified,
    helpline: row.helpline || '',
    whatsapp: row.whatsapp || '',
    social_links: normalizeSocialLinks(row.social_links),
    fiscal_year: row.fiscal_year || '',
    operating_hours: normalizeOperatingHours(row.operating_hours),
    offered_subjects: normalizeOfferedSubjects(row.offered_subjects),
    status: row.status || 'active',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeOtp) {
    mapped.phone_otp = row.phone_otp || null;
    mapped.phone_otp_expires_at = row.phone_otp_expires_at || null;
  }
  return enrichMediaUrls(mapped);
}

function defaultOperatingHours() {
  return DAYS_OF_WEEK.map((day) => ({
    day,
    isOpen: true,
    openTime: '09:00',
    closeTime: '17:00',
  }));
}

class TeacherInstituteService {
  async getByTeacherId(teacherId) {
    const result = await db.query(
      'SELECT * FROM teacher_institutes WHERE teacher_id = $1 LIMIT 1',
      [teacherId]
    );
    return mapInstituteRow(result.rows[0] || null);
  }

  async getDefaultsForTeacher(teacherId) {
    const existing = await this.getByTeacherId(teacherId);
    if (existing) {
      // Hide OTP-only draft placeholder from the settings form
      if (existing.status === 'draft' && (!existing.name || existing.name === 'Draft Institute')) {
        const profileResult = await db.query(
          `SELECT tp.institute_name, tp.address, tp.location, tp.account_email, tp.support_email,
                  tp.original_phone, tp.support_phone, tp.facebook_url, u.email AS login_email
           FROM users u
           LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
           WHERE u.id = $1`,
          [teacherId]
        );
        const p = profileResult.rows[0] || {};
        return {
          ...existing,
          slug: String(existing.slug || '').startsWith('d-') ? '' : existing.slug,
          name: p.institute_name || '',
          address: existing.address || p.address || '',
          city: existing.city || p.location || '',
          email: existing.email || p.support_email || p.account_email || p.login_email || '',
          phone: existing.phone || p.support_phone || p.original_phone || '',
        };
      }
      if (String(existing.slug || '').startsWith('d-') && existing.status === 'draft') {
        return { ...existing, slug: '' };
      }
      return existing;
    }

    const profileResult = await db.query(
      `SELECT tp.institute_name, tp.address, tp.location, tp.account_email, tp.support_email,
              tp.original_phone, tp.support_phone, tp.facebook_url, u.email AS login_email
       FROM users u
       LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
       WHERE u.id = $1`,
      [teacherId]
    );
    const p = profileResult.rows[0] || {};
    const social = [];
    if (p.facebook_url) social.push({ type: 'facebook', url: p.facebook_url });

    return {
      id: null,
      teacher_id: teacherId,
      slug: '',
      name: p.institute_name || '',
      tagline: '',
      logo_path: null,
      cover_path: null,
      logo_url: null,
      cover_url: null,
      address: p.address || '',
      city: p.location || '',
      email: p.support_email || p.account_email || p.login_email || '',
      phone: p.support_phone || p.original_phone || '',
      phone_verified: false,
      helpline: '',
      whatsapp: p.support_phone || p.original_phone || '',
      social_links: normalizeSocialLinks(social),
      fiscal_year: '',
      operating_hours: defaultOperatingHours(),
      offered_subjects: [],
      status: 'draft',
      created_at: null,
      updated_at: null,
    };
  }

  async checkSlugAvailability(teacherId, rawSlug) {
    const slug = normalizeSlug(rawSlug);
    const formatError = validateSlugFormat(slug);
    if (formatError) {
      return {
        slug,
        available: false,
        ownedByTeacher: false,
        message: formatError,
      };
    }

    const result = await db.query(
      'SELECT teacher_id FROM teacher_institutes WHERE slug = $1 LIMIT 1',
      [slug]
    );
    if (result.rows.length === 0) {
      return {
        slug,
        available: true,
        ownedByTeacher: false,
        message: 'Subdomain is available.',
      };
    }

    const ownedByTeacher = result.rows[0].teacher_id === teacherId;
    return {
      slug,
      available: ownedByTeacher,
      ownedByTeacher,
      message: ownedByTeacher
        ? 'This is your current subdomain.'
        : 'This subdomain is already taken.',
    };
  }

  async upsertInstitute(teacherId, payload, files = {}) {
    const slug = normalizeSlug(payload.slug);
    const formatError = validateSlugFormat(slug);
    if (formatError) {
      const err = new Error(formatError);
      err.status = 400;
      throw err;
    }

    const name = String(payload.name || '').trim();
    if (!name) {
      const err = new Error('Institute name is required.');
      err.status = 400;
      throw err;
    }

    const availability = await this.checkSlugAvailability(teacherId, slug);
    if (!availability.available) {
      const err = new Error(availability.message);
      err.status = 409;
      throw err;
    }

    const existing = await db.query(
      'SELECT * FROM teacher_institutes WHERE teacher_id = $1 LIMIT 1',
      [teacherId]
    );
    const current = existing.rows[0] || null;

    const tagline = String(payload.tagline || '').trim();
    const address = String(payload.address || '').trim();
    const city = String(payload.city || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const phone = String(payload.phone || '').trim();
    const helpline = String(payload.helpline || '').trim();
    const whatsapp = String(payload.whatsapp || '').trim();
    const fiscalYear = String(payload.fiscal_year || payload.fiscalYear || '').trim();
    const socialLinks = normalizeSocialLinks(payload.social_links || payload.socialLinks);
    const operatingHours = normalizeOperatingHours(payload.operating_hours || payload.operatingHours);
    const offeredSubjects = normalizeOfferedSubjects(payload.offered_subjects || payload.offeredSubjects);
    const status = ['active', 'inactive', 'draft'].includes(payload.status) ? payload.status : 'active';

    let phoneVerified = current ? !!current.phone_verified : false;
    let phoneOtp = current ? current.phone_otp : null;
    let phoneOtpExpires = current ? current.phone_otp_expires_at : null;
    if (!phone) {
      phoneVerified = false;
      phoneOtp = null;
      phoneOtpExpires = null;
    } else if (current && String(current.phone || '').trim() !== phone) {
      phoneVerified = false;
      phoneOtp = null;
      phoneOtpExpires = null;
    }

    let logoPath = current?.logo_path || null;
    let coverPath = current?.cover_path || null;
    const oldLogo = logoPath;
    const oldCover = coverPath;
    const uploaded = [];

    try {
      if (files.logo && files.logo[0]) {
        const file = files.logo[0];
        const ext = path.extname(file.originalname || '') || '.jpg';
        const key = `teachers/${teacherId}/institutes/logo-${Date.now()}${ext}`;
        await r2Storage.uploadFile(key, file.buffer, file.mimetype);
        logoPath = key;
        uploaded.push(key);
      }
      if (files.cover && files.cover[0]) {
        const file = files.cover[0];
        const ext = path.extname(file.originalname || '') || '.jpg';
        const key = `teachers/${teacherId}/institutes/cover-${Date.now()}${ext}`;
        await r2Storage.uploadFile(key, file.buffer, file.mimetype);
        coverPath = key;
        uploaded.push(key);
      }
    } catch (uploadErr) {
      for (const key of uploaded) {
        try { await r2Storage.deleteObject(key); } catch (_) { /* ignore */ }
      }
      const err = new Error('Failed to upload institute media.');
      err.status = 500;
      throw err;
    }

    const client = await db.pool.connect();
    let saved;
    try {
      await client.query('BEGIN');

      if (current) {
        const result = await client.query(
          `UPDATE teacher_institutes SET
              slug = $1,
              name = $2,
              tagline = $3,
              logo_path = $4,
              cover_path = $5,
              address = $6,
              city = $7,
              email = $8,
              phone = $9,
              phone_verified = $10,
              phone_otp = $11,
              phone_otp_expires_at = $12,
              helpline = $13,
              whatsapp = $14,
              social_links = $15::jsonb,
              fiscal_year = $16,
              operating_hours = $17::jsonb,
              offered_subjects = $18::jsonb,
              status = $19
           WHERE teacher_id = $20
           RETURNING *`,
          [
            slug, name, tagline || null, logoPath, coverPath,
            address || null, city || null, email || null, phone || null,
            phoneVerified, phoneOtp, phoneOtpExpires,
            helpline || null, whatsapp || null,
            JSON.stringify(socialLinks), fiscalYear || null,
            JSON.stringify(operatingHours), JSON.stringify(offeredSubjects),
            status, teacherId,
          ]
        );
        saved = result.rows[0];
      } else {
        const result = await client.query(
          `INSERT INTO teacher_institutes (
              teacher_id, slug, name, tagline, logo_path, cover_path,
              address, city, email, phone, phone_verified,
              helpline, whatsapp, social_links, fiscal_year,
              operating_hours, offered_subjects, status
           ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,$17::jsonb,$18
           ) RETURNING *`,
          [
            teacherId, slug, name, tagline || null, logoPath, coverPath,
            address || null, city || null, email || null, phone || null, phoneVerified,
            helpline || null, whatsapp || null,
            JSON.stringify(socialLinks), fiscalYear || null,
            JSON.stringify(operatingHours), JSON.stringify(offeredSubjects),
            status,
          ]
        );
        saved = result.rows[0];
      }

      // Keep personal profile label in sync
      await client.query(
        `INSERT INTO teacher_profiles (user_id, institute_name)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET institute_name = EXCLUDED.institute_name, updated_at = NOW()`,
        [teacherId, name]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      for (const key of uploaded) {
        try { await r2Storage.deleteObject(key); } catch (_) { /* ignore */ }
      }
      if (e && e.code === '23505') {
        const err = new Error('This subdomain is already taken.');
        err.status = 409;
        throw err;
      }
      throw e;
    } finally {
      client.release();
    }

    // Cleanup replaced media after successful commit
    if (oldLogo && logoPath && oldLogo !== logoPath && String(oldLogo).startsWith('teachers/')) {
      try { await r2Storage.deleteObject(oldLogo); } catch (_) { /* ignore */ }
    }
    if (oldCover && coverPath && oldCover !== coverPath && String(oldCover).startsWith('teachers/')) {
      try { await r2Storage.deleteObject(oldCover); } catch (_) { /* ignore */ }
    }

    return mapInstituteRow(saved);
  }

  async requestPhoneOtp(teacherId, phoneRaw) {
    const phone = String(phoneRaw || '').trim();
    if (!phone) {
      const err = new Error('Phone number is required');
      err.status = 400;
      throw err;
    }

    const OTP_EXPIRY_MINUTES = 5;
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const otp = emailService.generateOtp();

    const existing = await db.query(
      'SELECT id, phone, phone_verified, status FROM teacher_institutes WHERE teacher_id = $1 LIMIT 1',
      [teacherId]
    );

    if (existing.rows.length === 0) {
      // Draft shell so OTP can be stored before the teacher finishes setup.
      // Public lookup only returns status=active, so this slug is never exposed.
      const draftSlug = `d-${String(teacherId).replace(/-/g, '').slice(0, 30)}`;
      try {
        await db.query(
          `INSERT INTO teacher_institutes (
             teacher_id, slug, name, phone, phone_verified, phone_otp, phone_otp_expires_at, status
           ) VALUES ($1, $2, $3, $4, false, $5, $6, 'draft')`,
          [teacherId, draftSlug, 'Draft Institute', phone, otp, expiresAt]
        );
      } catch (e) {
        if (e && e.code !== '23505') throw e;
      }
    }

    const current = await db.query(
      'SELECT * FROM teacher_institutes WHERE teacher_id = $1 LIMIT 1',
      [teacherId]
    );
    if (current.rows.length === 0) {
      const err = new Error('Failed to prepare institute for verification');
      err.status = 500;
      throw err;
    }

    const row = current.rows[0];
    const phoneChanged = String(row.phone || '').trim() !== phone;

    await db.query(
      `UPDATE teacher_institutes
       SET phone = $1,
           phone_verified = CASE WHEN $2 THEN false ELSE phone_verified END,
           phone_otp = $3,
           phone_otp_expires_at = $4
       WHERE teacher_id = $5`,
      [phone, phoneChanged, otp, expiresAt, teacherId]
    );

    await smsService.sendOtpSms(phone, otp);
    return { message: 'OTP sent', expiresIn: OTP_EXPIRY_MINUTES * 60 };
  }

  async verifyPhoneOtp(teacherId, otpRaw) {
    const otp = String(otpRaw || '').trim();
    if (!otp) {
      const err = new Error('OTP is required');
      err.status = 400;
      throw err;
    }

    const result = await db.query(
      'SELECT phone_otp, phone_otp_expires_at FROM teacher_institutes WHERE teacher_id = $1 LIMIT 1',
      [teacherId]
    );
    if (result.rows.length === 0) {
      const err = new Error('Institute not found. Save or request OTP first.');
      err.status = 404;
      throw err;
    }

    const stored = result.rows[0];
    if (!stored.phone_otp || stored.phone_otp !== otp) {
      const err = new Error('Invalid OTP');
      err.status = 400;
      throw err;
    }
    if (new Date(stored.phone_otp_expires_at) < new Date()) {
      const err = new Error('OTP expired');
      err.status = 400;
      throw err;
    }

    await db.query(
      `UPDATE teacher_institutes
       SET phone_verified = true, phone_otp = NULL, phone_otp_expires_at = NULL
       WHERE teacher_id = $1`,
      [teacherId]
    );

    return this.getByTeacherId(teacherId);
  }

  async getPublicBySlug(slugRaw) {
    const slug = normalizeSlug(slugRaw);
    const formatError = validateSlugFormat(slug);
    if (formatError) return null;

    const result = await db.query(
      `SELECT ti.*,
              COALESCE(tp.name, u.email) AS teacher_name,
              tp.profile_image_path AS teacher_profile_image_path
       FROM teacher_institutes ti
       JOIN users u ON u.id = ti.teacher_id
       LEFT JOIN teacher_profiles tp ON tp.user_id = ti.teacher_id
       WHERE ti.slug = $1 AND ti.status = 'active'
       LIMIT 1`,
      [slug]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const institute = mapInstituteRow(row);
    institute.teacher_name = row.teacher_name || 'Teacher';
    institute.teacher_id = row.teacher_id;

    const apiBase = getApiBase();
    let teacherProfileImageUrl = null;
    if (row.teacher_profile_image_path) {
      const profilePath = String(row.teacher_profile_image_path);
      if (profilePath.startsWith('teachers/')) {
        teacherProfileImageUrl = `${apiBase}/v1/teacher/profile/image/${encodeURIComponent(profilePath)}`;
      } else if (profilePath.startsWith('/images/') || profilePath.startsWith('images/')) {
        teacherProfileImageUrl = `${apiBase}${profilePath.startsWith('/') ? '' : '/'}${profilePath}`;
      }
    }
    institute.teacher = {
      id: row.teacher_id,
      name: institute.teacher_name,
      profile_image_url: teacherProfileImageUrl,
    };

    const allCourses = await courseService.getCoursesByTeacher(row.teacher_id);
    const activeCourses = (allCourses || []).filter((c) => !c.status || c.status === 'active');

    institute.courses = activeCourses.map((c) => {
      let thumbnail_url = c.thumbnail_url || null;
      if (!thumbnail_url && c.thumbnail_path) {
        if (String(c.thumbnail_path).startsWith('teachers/')) {
          thumbnail_url = `${apiBase}/v1/courses/media/${encodeURIComponent(c.thumbnail_path)}`;
        } else if (String(c.thumbnail_path).startsWith('/')) {
          thumbnail_url = `${apiBase}${c.thumbnail_path}`;
        }
      }
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        thumbnail_path: c.thumbnail_path,
        thumbnail_url,
        external_thumbnail_url: c.external_thumbnail_url || null,
        price: c.price,
        discount_price: c.discount_price,
        currency: c.currency || 'BDT',
        tags: c.tags || [],
        category: c.category || c.category_name || null,
        teacher_id: c.teacher_id,
        teacher_name: c.teacher_name || institute.teacher_name,
        rating: c.rating || 0,
        review_count: c.review_count || 0,
        purchase_count: c.purchase_count || 0,
        total_videos: c.total_videos || 0,
        status: c.status || 'active',
        institution_name: institute.name,
      };
    });

    // Keep optional public sections resilient so a missing legacy table never
    // takes the entire institute storefront offline.
    const [announcements, reviewData, reviewSummary, studentCount] = await Promise.all([
      announcementService.getByTeacher(row.teacher_id, 4, 0).catch(() => []),
      teacherReviewService.getReviewsByTeacher(row.teacher_id, 6, 0)
        .catch(() => ({ reviews: [], total: 0 })),
      teacherReviewService.getSummaryByTeacher(row.teacher_id)
        .catch(() => ({ total: 0, averageRating: 0 })),
      db.query(
        `SELECT COUNT(DISTINCT ce.user_id)::int AS total
         FROM course_enrollments ce
         JOIN courses c ON c.id = ce.course_id
         WHERE c.teacher_id = $1`,
        [row.teacher_id]
      ).then((r) => r.rows[0]?.total || 0).catch(() => 0),
    ]);

    institute.announcements = announcements.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      course_title: item.course_title,
      created_at: item.created_at,
    }));

    institute.reviews = (reviewData.reviews || []).map((item) => ({
      id: item.id,
      rating: Number(item.rating) || 0,
      comment: item.comment || '',
      user_name: item.user_name || 'Student',
      created_at: item.created_at,
    }));

    const reviewCount = Number(reviewSummary.total || reviewData.total) || 0;
    institute.stats = {
      course_count: institute.courses.length,
      student_count: Number(studentCount) || 0,
      review_count: reviewCount,
      average_rating: Number(Number(reviewSummary.averageRating || 0).toFixed(1)),
      subject_count: Array.isArray(institute.offered_subjects)
        ? institute.offered_subjects.length
        : 0,
    };

    return institute;
  }
}

module.exports = new TeacherInstituteService();
module.exports.normalizeSlug = normalizeSlug;
module.exports.validateSlugFormat = validateSlugFormat;
module.exports.RESERVED_SLUGS = RESERVED_SLUGS;
