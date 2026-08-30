const crypto = require('crypto');
const db = require('../../db');
const progressService = require('./progressService');
const studentProfileService = require('./studentProfileService');

function generateCertificateNumber() {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const year = new Date().getFullYear();
  return `CERT-${year}-${suffix}`;
}

async function buildEligibility(userId, courseId, progress, course) {
  const videosTotal = progress.totalVideos || 0;
  const videosCompleted = progress.videosCompleted90 || 0;
  let assignmentsTotal = progress.assignmentsTotal || 0;
  let assignmentsCompleted = progress.assignmentsSubmitted || 0;
  
  const videosComplete = videosTotal === 0 || videosCompleted >= videosTotal;
  
  // Custom Criteria
  const criteria = typeof course.certificate_criteria === 'string' 
    ? JSON.parse(course.certificate_criteria) 
    : (course.certificate_criteria || {});
    
  // Assignment Check
  const assignCrit = criteria.assignments || { type: 'submit_all' };
  let assignmentsComplete = false;
  if (assignmentsTotal === 0) {
    assignmentsComplete = true;
  } else if (assignCrit.type === 'min_marks' && assignCrit.min_marks_percent > 0) {
    // Check if they got the min marks. Since assignment marks are free text, we try parsing.
    // In a real system, we might need a structured total_marks in assignments.
    const subs = await db.query(
      `SELECT marks, status FROM assignment_submissions 
       WHERE user_id = $1 AND assignment_id IN (
         SELECT id::text FROM assignments WHERE course_id = $2
       )`,
      [userId, courseId]
    ).catch(() => ({ rows: [] })); // fallback if assignment relation is tricky
    
    // For now, if min_marks is required, we just require status='graded' and numeric parsing
    let passedCount = 0;
    for (const sub of subs.rows) {
       if (sub.status === 'graded' && sub.marks) {
         // simple check if marks text can be parsed as >= min_marks_percent
         // this assumes marks is a raw number like "80"
         const m = parseFloat(sub.marks);
         if (!isNaN(m) && m >= assignCrit.min_marks_percent) passedCount++;
       }
    }
    assignmentsComplete = passedCount >= assignmentsTotal;
    assignmentsCompleted = passedCount;
  } else {
    assignmentsComplete = assignmentsCompleted >= assignmentsTotal;
  }

  // Exams Check
  let examsTotal = 0;
  let examsCompleted = 0;
  let examsPassed = 0;
  let examsComplete = true;
  
  const examsRes = await db.query(
    'SELECT id FROM exams WHERE course_id = $1 AND status = $2',
    [courseId, 'published']
  );
  examsTotal = examsRes.rowCount;
  
  if (examsTotal > 0) {
    const subs = await db.query(
      `SELECT exam_id, score, total_marks FROM exam_submissions
       WHERE student_id = $1 AND exam_id = ANY($2::uuid[])`,
      [userId, examsRes.rows.map(r => r.id)]
    );
    examsCompleted = subs.rowCount;
    const examCrit = criteria.exams || { type: 'submit_all' };
    
    if (examCrit.type === 'min_marks' && examCrit.min_marks_percent > 0) {
      for (const row of subs.rows) {
        if (row.total_marks > 0) {
          const pct = (row.score / row.total_marks) * 100;
          if (pct >= examCrit.min_marks_percent) examsPassed++;
        } else {
          examsPassed++;
        }
      }
    } else {
      examsPassed = examsCompleted;
    }
    examsComplete = examsPassed >= examsTotal;
  }
  
  const isEligible = videosComplete && assignmentsComplete && examsComplete && (course.is_certificate_enabled !== false);

  const videosPercent = videosTotal > 0 ? Math.round((videosCompleted / videosTotal) * 100) : 100;
  const assignmentsPercent = assignmentsTotal > 0 ? Math.round((assignmentsCompleted / assignmentsTotal) * 100) : 100;
  const examsPercent = examsTotal > 0 ? Math.round((examsPassed / examsTotal) * 100) : 100;

  return {
    isEligible,
    criteria,
    videosComplete,
    assignmentsComplete,
    examsComplete,
    
    videosCompleted,
    videosTotal,
    videosRemaining: Math.max(0, videosTotal - videosCompleted),
    videosPercent: Math.min(100, videosPercent),
    
    assignmentsCompleted,
    assignmentsTotal,
    assignmentsRemaining: Math.max(0, assignmentsTotal - assignmentsCompleted),
    assignmentsPercent: Math.min(100, assignmentsPercent),
    
    examsCompleted: examsPassed,
    examsTotal,
    examsRemaining: Math.max(0, examsTotal - examsPassed),
    examsPercent: Math.min(100, examsPercent),
    
    completionPercentage: Math.round((videosPercent + assignmentsPercent + examsPercent) / 3),
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
            COALESCE(NULLIF(tp.name, ''), u.email, 'Instructor') AS instructor_name,
            c.is_certificate_enabled, c.certificate_design, c.certificate_criteria
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
  
  const course = result.rows[0];
  return course;
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
    userId: row.user_id,
    certificateNumber: row.certificate_number,
    studentName: row.student_name,
    courseTitle: row.course_title,
    instructorName: row.instructor_name || null,
    issuedAt: row.issued_at ? row.issued_at.toISOString() : null,
  };
}

async function getExistingCertificate(userId, courseId) {
  const result = await db.query(
    `SELECT cert.id, cert.certificate_number, cert.student_name, cert.course_title, 
            cert.issued_at, cert.course_id,
            COALESCE(NULLIF(tp.name, ''), u.email, cert.instructor_name) AS instructor_name
     FROM course_certificates cert
     LEFT JOIN courses c ON cert.course_id = c.id
     LEFT JOIN users u ON c.teacher_id = u.id
     LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
     WHERE cert.user_id = $1 AND cert.course_id = $2`,
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
  const eligibility = await buildEligibility(userId, courseId, progress, course);
  const certificate = await getExistingCertificate(userId, courseId);

  if (certificate) {
    eligibility.isEligible = true;
    eligibility.videosComplete = true;
    eligibility.assignmentsComplete = true;
    eligibility.examsComplete = true;
    
    eligibility.videosCompleted = eligibility.videosTotal;
    eligibility.videosRemaining = 0;
    eligibility.videosPercent = 100;

    eligibility.assignmentsCompleted = eligibility.assignmentsTotal;
    eligibility.assignmentsRemaining = 0;
    eligibility.assignmentsPercent = 100;

    eligibility.examsCompleted = eligibility.examsTotal;
    eligibility.examsRemaining = 0;
    eligibility.examsPercent = 100;

    eligibility.completionPercentage = 100;
  }

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
  const course = await getCourseMeta(courseId);
  const eligibility = await buildEligibility(userId, courseId, progress, course);
  if (!eligibility.isEligible) {
    const err = new Error('Course must be 100% complete to receive a certificate');
    err.statusCode = 400;
    err.details = eligibility;
    throw err;
  }

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
    `SELECT cert.id, cert.certificate_number, cert.student_name, cert.course_title, 
            cert.issued_at, cert.course_id,
            COALESCE(NULLIF(tp.name, ''), u.email, cert.instructor_name) AS instructor_name
     FROM course_certificates cert
     LEFT JOIN courses c ON cert.course_id = c.id
     LEFT JOIN users u ON c.teacher_id = u.id
     LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
     WHERE cert.id = $1 AND cert.user_id = $2`,
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
    `SELECT cert.id, cert.certificate_number, cert.student_name, cert.course_title, 
            cert.issued_at, cert.course_id, cert.user_id,
            COALESCE(NULLIF(tp.name, ''), u.email, cert.instructor_name) AS instructor_name
     FROM course_certificates cert
     LEFT JOIN courses c ON cert.course_id = c.id
     LEFT JOIN users u ON c.teacher_id = u.id
     LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
     WHERE UPPER(cert.certificate_number) = $1`,
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
