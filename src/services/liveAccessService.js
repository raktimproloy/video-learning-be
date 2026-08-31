/**
 * Lightweight auth for live endpoints — avoids heavy getCourseById on hot paths.
 */
const db = require('../../db');
const liveStreamCache = require('./liveStreamCacheService');
const lessonService = require('./lessonService');
const liveSessionService = require('./liveSessionService');
const courseService = require('./courseService');

function workspaceTeacherId(req) {
  return req.effectiveTeacherId || req.user?.id;
}

function isTeacherWorkspaceUser(req) {
  return req.user?.role === 'teacher' || req.user?.role === 'admin';
}

async function getCourseMeta(courseId) {
  return liveStreamCache.cached(
    `courseMeta:${courseId}`,
    liveStreamCache.TTL_MS.courseMeta,
    async () => {
      const r = await db.query(
        'SELECT id, teacher_id, has_live_class FROM courses WHERE id = $1',
        [courseId]
      );
      return r.rows[0] || null;
    }
  );
}

/**
 * Resolve lesson + course meta + active session + access flags for live routes.
 * @returns {Promise<{ ok: true, lesson, courseMeta, activeSession, isTeacher, teacherId } | { ok: false, status: number, error: string }>}
 */
async function resolveLiveAccess(req, lessonId, { requireActiveSession = false, provider = 'r2_live' } = {}) {
  const lesson = await liveStreamCache.cached(
    `lesson:${lessonId}`,
    liveStreamCache.TTL_MS.lessonRow,
    () => lessonService.getLessonById(lessonId)
  );
  if (!lesson) return { ok: false, status: 404, error: 'Lesson not found' };

  const courseMeta = await getCourseMeta(lesson.course_id);
  if (!courseMeta) return { ok: false, status: 404, error: 'Course not found' };

  const teacherId = courseMeta.teacher_id;
  const isTeacher = isTeacherWorkspaceUser(req) && teacherId === workspaceTeacherId(req);

  if (req.user?.role === 'student') {
    const enrolled = await liveStreamCache.cached(
      `enrolled:${req.user.id}:${lesson.course_id}`,
      liveStreamCache.TTL_MS.enrolled,
      () => courseService.isEnrolled(req.user.id, lesson.course_id)
    );
    if (!enrolled) return { ok: false, status: 403, error: 'Purchase this course to watch the live stream.' };
  } else if (!isTeacher) {
    return { ok: false, status: 403, error: 'Access denied' };
  }

  const activeSession = await liveStreamCache.cached(
    `activeSession:${lessonId}`,
    liveStreamCache.TTL_MS.activeSession,
    () => liveSessionService.getActiveByLesson(lessonId)
  );

  if (requireActiveSession) {
    if (!activeSession || activeSession.provider !== provider) {
      return { ok: false, status: 404, error: 'No active R2 live session.' };
    }
    if (req.user?.role === 'student' && !lesson.is_live && activeSession.status !== 'active') {
      return { ok: false, status: 404, error: 'This lesson is not live.' };
    }
  }

  return {
    ok: true,
    lesson,
    courseMeta,
    activeSession,
    isTeacher,
    teacherId,
  };
}

module.exports = {
  getCourseMeta,
  resolveLiveAccess,
  workspaceTeacherId,
  isTeacherWorkspaceUser,
};
