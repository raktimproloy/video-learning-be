const crypto = require('crypto');
const db = require('../../db');
const progressService = require('./progressService');
const studentProfileService = require('./studentProfileService');

function generateCertificateNumber() {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const year = new Date().getFullYear();
  return `CERT-${year}-${suffix}`;
}

function buildEligibility(progress) {
  const videosTotal = progress.totalVideos || 0;
  const videosCompleted = progress.videosCompleted90 || 0;
  const assignmentsTotal = progress.assignmentsTotal || 0;
  const assignmentsCompleted = progress.assignmentsSubmitted || 0;

  const videosComplete = videosTotal === 0 || videosCompleted >= videosTotal;
  const assignmentsComplete = assignmentsTotal === 0 || assignmentsCompleted >= assignmentsTotal;

  const videosPercent = videosTotal > 0
    ? Math.round((videosCompleted / videosTotal) * 100)
    : 100;
  const assignmentsPercent = assignmentsTotal > 0
    ? Math.round((assignmentsCompleted / assignmentsTotal) * 100)
    : 100;

  return {
    isEligible: videosComplete && assignmentsComplete,
    videosComplete,
    assignmentsComplete,
    videosCompleted,
    videosTotal,
    videosRemaining: Math.max(0, videosTotal - videosCompleted),
    videosPercent: Math.min(100, videosPercent),
    assignmentsCompleted,
    assignmentsTotal,
    assignmentsRemaining: Math.max(0, assignmentsTotal - assignmentsCompleted),
    assignmentsPercent: Math.min(100, assignmentsPercent),
    completionPercentage: progress.completionPercentage ?? 0,
  };
}

async function assertEnrolled(userId, courseId) {
  const enrolled = await db.query(
    'SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2',
    [userId, courseId]
  );
  if (!enrolled.rows.length) {
    const err = new Error('Not enrolled in this course');
    err.statusCode = 403;
    throw err;
  }
}

async function getCourseMeta(courseId) {
  const result = await db.query(
    `SELECT c.id, c.title,
            COALESCE(tp.name, u.email, 'Instructor') AS instructor_name
     FROM courses c
     LEFT JOIN users u ON c.teacher_id = u.id
     LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
     WHERE c.id = $1`,
    [courseId]
  );
  if (!result.rows.length) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }
  return result.rows[0];
}

async function getStudentDisplayName(userId) {
  const profile = await studentProfileService.getProfile(userId).catch(() => null);
  if (profile?.name?.trim()) return profile.name.trim();

  const userResult = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
  const email = userResult.rows[0]?.email;
  if (email) {
    const local = email.split('@')[0];
    return local.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'Student';
}

function formatCertificateRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    certificateNumber: row.certificate_number,
    studentName: row.student_name,
    courseTitle: row.course_title,
    instructorName: row.instructor_name || null,
    issuedAt: row.issued_at ? row.issued_at.toISOString() : null,
  };
}

async function getExistingCertificate(userId, courseId) {
  const result = await db.query(
    `SELECT id, certificate_number, student_name, course_title, instructor_name, issued_at
     FROM course_certificates
     WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId]
  );
  return formatCertificateRow(result.rows[0]);
}

/**
 * Certificate eligibility + existing issued certificate (if any).
 */
async function getCertificateStatus(userId, courseId) {
  await assertEnrolled(userId, courseId);
  const course = await getCourseMeta(courseId);
  const progress = await progressService.getCourseProgress(userId, courseId);
  const eligibility = buildEligibility(progress);
  const certificate = await getExistingCertificate(userId, courseId);

  return {
    courseId,
    courseTitle: course.title,
    instructorName: course.instructor_name,
    ...eligibility,
    certificate,
  };
}

/**
 * Issue certificate when eligible. Idempotent — returns existing certificate if already issued.
 */
async function issueCertificate(userId, courseId) {
  await assertEnrolled(userId, courseId);

  const existing = await getExistingCertificate(userId, courseId);
  if (existing) {
    const status = await getCertificateStatus(userId, courseId);
    return { ...status, certificate: existing, alreadyIssued: true };
  }

  const progress = await progressService.getCourseProgress(userId, courseId);
  const eligibility = buildEligibility(progress);
  if (!eligibility.isEligible) {
    const err = new Error('Course must be 100% complete to receive a certificate');
    err.statusCode = 400;
    err.details = eligibility;
    throw err;
  }

  const course = await getCourseMeta(courseId);
  const studentName = await getStudentDisplayName(userId);
  let certificateNumber = generateCertificateNumber();
  let attempts = 0;

  while (attempts < 5) {
    try {
      const insert = await db.query(
        `INSERT INTO course_certificates (
          user_id, course_id, certificate_number, student_name, course_title, instructor_name
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, certificate_number, student_name, course_title, instructor_name, issued_at`,
        [userId, courseId, certificateNumber, studentName, course.title, course.instructor_name]
      );
      const certificate = formatCertificateRow(insert.rows[0]);
      const status = await getCertificateStatus(userId, courseId);
      return { ...status, certificate, alreadyIssued: false };
    } catch (e) {
      if (e.code === '23505') {
        const dup = await getExistingCertificate(userId, courseId);
        if (dup) {
          const status = await getCertificateStatus(userId, courseId);
          return { ...status, certificate: dup, alreadyIssued: true };
        }
        certificateNumber = generateCertificateNumber();
        attempts += 1;
        continue;
      }
      throw e;
    }
  }

  throw new Error('Failed to generate certificate');
}

/**
 * Get certificate by id (must belong to user).
 */
async function getCertificateById(userId, certificateId) {
  const result = await db.query(
    `SELECT id, certificate_number, student_name, course_title, instructor_name, issued_at, course_id
     FROM course_certificates
     WHERE id = $1 AND user_id = $2`,
    [certificateId, userId]
  );
  if (!result.rows.length) {
    const err = new Error('Certificate not found');
    err.statusCode = 404;
    throw err;
  }
  return {
    ...formatCertificateRow(result.rows[0]),
    courseId: result.rows[0].course_id,
  };
}

/**
 * Public lookup by certificate number (shareable, no auth).
 */
async function getPublicCertificateByNumber(certificateNumber) {
  const normalized = String(certificateNumber || '').trim().toUpperCase();
  if (!normalized) {
    const err = new Error('Certificate not found');
    err.statusCode = 404;
    throw err;
  }

  const result = await db.query(
    `SELECT id, certificate_number, student_name, course_title, instructor_name, issued_at, course_id
     FROM course_certificates
     WHERE UPPER(certificate_number) = $1`,
    [normalized]
  );

  if (!result.rows.length) {
    const err = new Error('Certificate not found');
    err.statusCode = 404;
    throw err;
  }

  const row = result.rows[0];
  return {
    ...formatCertificateRow(row),
    courseId: row.course_id,
    verifyUrl: `/certificate/${row.certificate_number}`,
  };
}

module.exports = {
  getCertificateStatus,
  issueCertificate,
  getCertificateById,
  getPublicCertificateByNumber,
  buildEligibility,
};
