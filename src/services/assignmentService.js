const db = require('../../db');
const r2Storage = require('./r2StorageService');
const videoService = require('./videoService');
const lessonService = require('./lessonService');
const { compressImage } = require('../utils/imageCompress');
const path = require('path');
const fs = require('fs');

const UPLOADS_SUBMISSIONS = path.resolve(__dirname, '../../uploads/submissions');

function getSubmissionR2Key(studentId, assignmentType, videoId, lessonId, assignmentId, filename) {
  const parts = ['submissions', studentId, assignmentType];
  if (videoId) parts.push('videos', videoId);
  if (lessonId) parts.push('lessons', lessonId);
  parts.push(assignmentId, filename);
  return parts.join('/');
}

/**
 * Store one file, return { path, name }.
 */
async function storeFile(userId, assignmentType, videoId, lessonId, assignmentId, fileBuffer, originalFilename) {
  const { isImage } = require('../utils/imageCompress');
  let buffer = fileBuffer;
  if (isImage(originalFilename)) {
    buffer = await compressImage(fileBuffer, originalFilename);
  }
  const vid = assignmentType === 'video' ? videoId : null;
  const lid = assignmentType === 'lesson' ? lessonId : null;
  const timestamp = Date.now();
  const ext = path.extname(originalFilename);
  const filename = `sub-${timestamp}-${path.basename(originalFilename, ext).slice(0, 20)}${ext}`;

  if (r2Storage.isConfigured) {
    const key = getSubmissionR2Key(userId, assignmentType, vid, lid, assignmentId, filename);
    const extLower = ext.toLowerCase();
    let contentType = 'application/octet-stream';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extLower)) {
      contentType = extLower === '.png' ? 'image/png' : extLower === '.gif' ? 'image/gif' : extLower === '.webp' ? 'image/webp' : 'image/jpeg';
    } else if (extLower === '.pdf') contentType = 'application/pdf';
    await r2Storage.uploadFile(key, buffer, contentType);
    return { path: key, name: originalFilename };
  }
  const dir = path.join(UPLOADS_SUBMISSIONS, userId, assignmentType, vid || lid || 'unknown', assignmentId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buffer);
  const filePath = `/uploads/submissions/${userId}/${assignmentType}/${vid || lid}/${assignmentId}/${filename}`;
  return { path: filePath, name: originalFilename };
}

/**
 * Submit assignment (video or lesson). Accepts multiple files and/or url link.
 */
async function submitAssignment(userId, { assignmentType, videoId, lessonId, assignmentId, urlLink }, files = []) {
  if (assignmentType === 'video' && !videoId) throw new Error('videoId required for video assignment');
  if (assignmentType === 'lesson' && !lessonId) throw new Error('lessonId required for lesson assignment');
  if (!assignmentId) throw new Error('assignmentId required');
  const hasFiles = Array.isArray(files) && files.length > 0;
  const hasUrl = urlLink && String(urlLink).trim().length > 0;
  if (!hasFiles && !hasUrl) throw new Error('Provide at least one file or a URL link');

  const videoIdVal = assignmentType === 'video' ? (videoId || null) : null;
  const lessonIdVal = assignmentType === 'lesson' ? (lessonId || null) : null;

  const stored = [];
  for (const f of files) {
    const buffer = f.buffer || (f.path && fs.readFileSync(f.path));
    const name = f.originalname || f.name || 'file';
    const item = await storeFile(userId, assignmentType, videoId, lessonId, assignmentId, buffer, name);
    stored.push(item);
  }

  const firstFile = stored[0] || null;
  const filePath = firstFile?.path || null;
  const fileNames = stored.length > 0 ? stored.map((s) => s.name).join(', ') : null;
  const filesJson = stored.length > 0 ? JSON.stringify(stored) : null;
  const urlLinkVal = hasUrl ? String(urlLink).trim() : null;

  const result = await db.query(
    `INSERT INTO assignment_submissions (user_id, assignment_type, video_id, lesson_id, assignment_id, file_path, file_name, status, url_link, files_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9::jsonb) RETURNING *`,
    [userId, assignmentType, videoIdVal, lessonIdVal, assignmentId, filePath, fileNames || null, urlLinkVal, filesJson]
  );
  return result.rows[0];
}

/**
 * Get submissions for a student for a video or lesson.
 */
async function getSubmissionsByUserAndVideo(userId, videoId) {
  const result = await db.query(
    'SELECT * FROM assignment_submissions WHERE user_id = $1 AND video_id = $2',
    [userId, videoId]
  );
  return result.rows;
}

async function getSubmissionsByUserAndLesson(userId, lessonId) {
  const result = await db.query(
    'SELECT * FROM assignment_submissions WHERE user_id = $1 AND lesson_id = $2',
    [userId, lessonId]
  );
  return result.rows;
}

/**
 * Check if student has submitted a specific assignment.
 */
async function hasSubmitted(userId, assignmentType, videoId, lessonId, assignmentId) {
  const col = assignmentType === 'video' ? 'video_id' : 'lesson_id';
  const val = assignmentType === 'video' ? videoId : lessonId;
  const result = await db.query(
    `SELECT 1 FROM assignment_submissions 
     WHERE user_id = $1 AND assignment_type = $2 AND ${col} = $3 AND assignment_id = $4`,
    [userId, assignmentType, val, assignmentId]
  );
  return result.rows.length > 0;
}

/**
 * Check if student has passed a specific assignment (status = 'passed').
 * Used for unlock logic.
 */
async function hasPassedAssignment(userId, assignmentType, videoId, lessonId, assignmentId) {
  const col = assignmentType === 'video' ? 'video_id' : 'lesson_id';
  const val = assignmentType === 'video' ? videoId : lessonId;
  const result = await db.query(
    `SELECT 1 FROM assignment_submissions 
     WHERE user_id = $1 AND assignment_type = $2 AND ${col} = $3 AND assignment_id = $4 AND status = 'passed'`,
    [userId, assignmentType, val, assignmentId]
  );
  return result.rows.length > 0;
}

/**
 * Check if student has submitted all required assignments for a video.
 * Requires status = 'passed' for unlocking.
 */
async function hasCompletedVideoAssignments(userId, videoId) {
  const video = await videoService.getVideoById(videoId);
  if (!video || !video.assignments) return true;
  const assignments = typeof video.assignments === 'string' ? JSON.parse(video.assignments) : video.assignments;
  const required = assignments.filter((a) => a.isRequired);
  for (const a of required) {
    const passed = await hasPassedAssignment(userId, 'video', videoId, null, a.id);
    if (!passed) return false;
  }
  return true;
}

/**
 * Check if student has submitted all required assignments for a lesson.
 * Requires status = 'passed' for unlocking.
 */
async function hasCompletedLessonAssignments(userId, lessonId) {
  const lesson = await lessonService.getLessonById(lessonId);
  if (!lesson || !lesson.assignments) return true;
  const assignments = typeof lesson.assignments === 'string' ? JSON.parse(lesson.assignments) : lesson.assignments;
  const required = assignments.filter((a) => a.isRequired);
  for (const a of required) {
    const passed = await hasPassedAssignment(userId, 'lesson', null, lessonId, a.id);
    if (!passed) return false;
  }
  return true;
}

/**
 * Check if next video should be locked (current video has required assignment not submitted).
 */
async function isNextVideoLocked(userId, currentVideoId, nextVideoId) {
  const completed = await hasCompletedVideoAssignments(userId, currentVideoId);
  return !completed;
}

/**
 * Check if next lesson should be locked.
 * Lock if: current lesson has required assignment (lesson-level) not submitted, OR
 *          current lesson's last video has required assignment not submitted.
 */
async function isNextLessonLocked(userId, courseId, currentLessonId, nextLessonId) {
  const lessonCompleted = await hasCompletedLessonAssignments(userId, currentLessonId);
  if (!lessonCompleted) return true;

  const videos = await db.query(
    'SELECT id FROM videos WHERE lesson_id = $1 ORDER BY "order" ASC',
    [currentLessonId]
  );
  if (videos.rows.length === 0) return false;
  const lastVideoId = videos.rows[videos.rows.length - 1].id;
  const videoCompleted = await hasCompletedVideoAssignments(userId, lastVideoId);
  return !videoCompleted;
}

/**
 * Get submission status for a video (which assignments submitted, with status).
 */
async function getVideoSubmissionStatus(userId, videoId) {
  const submissions = await getSubmissionsByUserAndVideo(userId, videoId);
  const map = {};
  submissions.forEach((s) => {
    map[s.assignment_id] = {
      submittedAt: s.submitted_at,
      fileName: s.file_name,
      urlLink: s.url_link || null,
      status: s.status || 'pending',
      marks: s.marks,
      gradedAt: s.graded_at,
    };
  });
  return map;
}

/**
 * Get submission status for a lesson.
 */
async function getLessonSubmissionStatus(userId, lessonId) {
  const submissions = await getSubmissionsByUserAndLesson(userId, lessonId);
  const map = {};
  submissions.forEach((s) => {
    map[s.assignment_id] = {
      submittedAt: s.submitted_at,
      fileName: s.file_name,
      urlLink: s.url_link || null,
      status: s.status || 'pending',
      marks: s.marks,
      gradedAt: s.graded_at,
    };
  });
  return map;
}

/**
 * List submissions for teacher (with course and status filters).
 */
async function listTeacherSubmissions(teacherId, { courseId, status: statusFilter } = {}) {
  const params = [teacherId];
  let p = 2;
  const courseClause = courseId ? ` AND c.id = $${p++}` : '';
  const statusClause = statusFilter ? ` AND s.status = $${p++}` : '';
  if (courseId) params.push(courseId);
  if (statusFilter) params.push(statusFilter);

  const videoSubs = await db.query(
    `SELECT s.id, s.user_id, s.assignment_type, s.video_id, s.lesson_id, s.assignment_id,
            s.file_path, s.file_name, s.files_json, s.url_link, s.submitted_at, s.status, s.marks, s.graded_at,
            u.email as student_name, u.email as student_email,
            v.title as video_title,
            l.title as lesson_title, l.course_id,
            c.title as course_title
     FROM assignment_submissions s
     JOIN users u ON u.id = s.user_id
     JOIN videos v ON v.id = s.video_id
     JOIN lessons l ON l.id = v.lesson_id
     JOIN courses c ON c.id = l.course_id AND c.teacher_id = $1
     WHERE s.assignment_type = 'video' AND s.video_id IS NOT NULL
     ${courseClause}${statusClause}`,
    params
  );

  const lessonSubs = await db.query(
    `SELECT s.id, s.user_id, s.assignment_type, s.video_id, s.lesson_id, s.assignment_id,
            s.file_path, s.file_name, s.files_json, s.url_link, s.submitted_at, s.status, s.marks, s.graded_at,
            u.email as student_name, u.email as student_email,
            NULL::text as video_title,
            l.title as lesson_title, l.course_id,
            c.title as course_title
     FROM assignment_submissions s
     JOIN users u ON u.id = s.user_id
     JOIN lessons l ON l.id = s.lesson_id
     JOIN courses c ON c.id = l.course_id AND c.teacher_id = $1
     WHERE s.assignment_type = 'lesson' AND s.lesson_id IS NOT NULL
     ${courseClause}${statusClause}`,
    params
  );

  const combined = [...videoSubs.rows, ...lessonSubs.rows]
    .map(row => {
      // Parse files_json if it's a string
      if (row.files_json && typeof row.files_json === 'string') {
        try {
          row.files_json = JSON.parse(row.files_json);
        } catch (e) {
          console.error('Error parsing files_json in listTeacherSubmissions:', e);
          row.files_json = null;
        }
      }
      return row;
    })
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
  return combined;
}

/**
 * Get single submission by id. Verifies teacher owns the course.
 */
async function getSubmissionById(submissionId, teacherId) {
  const result = await db.query(
    `SELECT s.*, u.email as student_name, u.email as student_email,
            v.title as video_title, v.lesson_id as v_lesson_id,
            l.title as lesson_title, l.course_id,
            c.title as course_title
     FROM assignment_submissions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN videos v ON v.id = s.video_id
     LEFT JOIN lessons l ON l.id = COALESCE(v.lesson_id, s.lesson_id)
     JOIN courses c ON c.id = l.course_id
     WHERE s.id = $1 AND c.teacher_id = $2`,
    [submissionId, teacherId]
  );
  const row = result.rows[0];
  if (row && row.files_json && typeof row.files_json === 'string') {
    try {
      row.files_json = JSON.parse(row.files_json);
    } catch (e) {
      console.error('Error parsing files_json in getSubmissionById:', e);
    }
  }
  return row || null;
}

/**
 * Grant submission (set status = passed, optional marks).
 */
async function grantSubmission(submissionId, teacherId, marks = null) {
  const sub = await getSubmissionById(submissionId, teacherId);
  if (!sub) return null;
  const result = await db.query(
    `UPDATE assignment_submissions SET status = 'passed', marks = $1, graded_by = $2, graded_at = NOW()
     WHERE id = $3 RETURNING *`,
    [marks || sub.marks, teacherId, submissionId]
  );
  return result.rows[0];
}

/**
 * Decline submission (set status = failed).
 */
async function declineSubmission(submissionId, teacherId) {
  const sub = await getSubmissionById(submissionId, teacherId);
  if (!sub) return null;
  const result = await db.query(
    `UPDATE assignment_submissions SET status = 'failed', graded_by = $1, graded_at = NOW()
     WHERE id = $2 RETURNING *`,
    [teacherId, submissionId]
  );
  return result.rows[0];
}

/**
 * Get file stream or local path for preview. Returns { stream, contentType } for R2 or { path } for local.
 * If fileIndex is provided, uses files_json array; otherwise uses file_path.
 */
async function getSubmissionFileForPreview(submissionId, teacherId, fileIndex = null) {
  const sub = await getSubmissionById(submissionId, teacherId);
  if (!sub) return null;

  let filePath = null;
  let fileName = null;

  // If fileIndex is provided, try to get file from files_json
  if (fileIndex !== null && sub.files_json) {
    try {
      const files = typeof sub.files_json === 'string' ? JSON.parse(sub.files_json) : sub.files_json;
      if (Array.isArray(files) && files[fileIndex]) {
        filePath = files[fileIndex].path;
        fileName = files[fileIndex].name;
      }
    } catch (e) {
      console.error('Error parsing files_json:', e);
    }
  }

  // Fallback to file_path if no fileIndex or files_json failed
  if (!filePath && sub.file_path) {
    filePath = sub.file_path;
    fileName = sub.file_name;
  }

  if (!filePath) return null;

  const ext = path.extname(fileName || filePath).toLowerCase().slice(1);
  let contentType = 'application/octet-stream';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
    contentType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  } else if (ext === 'pdf') contentType = 'application/pdf';
  else if (ext === 'txt') contentType = 'text/plain';

  // Check if it's an R2 path (starts with 'submissions/' and doesn't start with '/')
  const isR2Path = filePath.startsWith('submissions/') && !filePath.startsWith('/');
  
  if (r2Storage.isConfigured && isR2Path) {
    try {
      const stream = await r2Storage.getObjectStream(filePath);
      return { stream, contentType };
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
        console.error(`R2 file not found: ${filePath}`);
        return null;
      }
      throw e;
    }
  }
  
  // Try local path (starts with '/uploads/submissions/')
  if (filePath.startsWith('/uploads/submissions/')) {
    const localPath = path.join(__dirname, '../../', filePath.replace(/^\//, ''));
    if (fs.existsSync(localPath)) {
      return { path: localPath, contentType };
    }
  }
  
  // Try alternative local path format
  const altLocalPath = path.join(__dirname, '../../uploads/submissions', filePath.replace(/^\/uploads\/submissions\//, ''));
  if (fs.existsSync(altLocalPath)) {
    return { path: altLocalPath, contentType };
  }
  
  console.error(`File not found: ${filePath}`);
  return null;
}

module.exports = {
  submitAssignment,
  getSubmissionsByUserAndVideo,
  getSubmissionsByUserAndLesson,
  hasSubmitted,
  hasPassedAssignment,
  hasCompletedVideoAssignments,
  hasCompletedLessonAssignments,
  isNextVideoLocked,
  isNextLessonLocked,
  getVideoSubmissionStatus,
  getLessonSubmissionStatus,
  listTeacherSubmissions,
  getSubmissionById,
  grantSubmission,
  declineSubmission,
  getSubmissionFileForPreview,
};
