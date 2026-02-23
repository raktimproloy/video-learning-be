const db = require('../../db');
const videoService = require('./videoService');
const lessonService = require('./lessonService');
const assignmentService = require('./assignmentService');

const COMPLETION_THRESHOLD = 0.95; // 95% watched = completed
const NINETY_PERCENT = 0.9;       // 90% for "video completed" stats

/**
 * Upsert video watch progress.
 * - last_position_seconds = where user left off (for resume next time).
 * - max_watched_seconds = furthest point ever reached (for progress %).
 * - total_watch_seconds = actual time spent watching (anti-cheat: progress uses min(max, total)).
 * - completed_at set when max >= 95% of duration.
 */
async function upsertVideoProgress(userId, payload) {
  const { videoId, lessonId, courseId, currentTimeSeconds, watchDeltaSeconds = 0 } = payload;
  if (!userId || !videoId) {
    throw new Error('userId and videoId are required');
  }
  const currentTime = Math.max(0, Number(currentTimeSeconds) || 0);
  const delta = Math.max(0, Number(watchDeltaSeconds) || 0);

  const video = await videoService.getVideoById(videoId);
  if (!video) throw new Error('Video not found');
  const duration = video.duration_seconds != null ? parseFloat(video.duration_seconds) : null;
  const thresholdSeconds = duration != null ? duration * COMPLETION_THRESHOLD : null;

  const result = await db.query(
    `INSERT INTO video_watch_progress (
      user_id, video_id, lesson_id, course_id,
      max_watched_seconds, total_watch_seconds, last_position_seconds, completed_at, last_position_updated_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $5, 
      CASE WHEN $7::decimal IS NOT NULL AND $5 >= $7 THEN NOW() ELSE NULL END,
      NOW(), NOW())
    ON CONFLICT (user_id, video_id) DO UPDATE SET
      lesson_id = COALESCE(EXCLUDED.lesson_id, video_watch_progress.lesson_id),
      course_id = COALESCE(EXCLUDED.course_id, video_watch_progress.course_id),
      max_watched_seconds = GREATEST(video_watch_progress.max_watched_seconds, EXCLUDED.max_watched_seconds),
      total_watch_seconds = video_watch_progress.total_watch_seconds + EXCLUDED.total_watch_seconds,
      last_position_seconds = EXCLUDED.max_watched_seconds,
      completed_at = CASE
        WHEN video_watch_progress.completed_at IS NOT NULL THEN video_watch_progress.completed_at
        WHEN $7::decimal IS NOT NULL AND GREATEST(video_watch_progress.max_watched_seconds, EXCLUDED.max_watched_seconds) >= $7 THEN NOW()
        ELSE NULL
      END,
      last_position_updated_at = NOW(),
      updated_at = NOW()
    RETURNING last_position_seconds, max_watched_seconds, completed_at`,
    [userId, videoId, lessonId || null, courseId || null, currentTime, delta, thresholdSeconds]
  );

  const row = result.rows[0];
  const lastPos = row.last_position_seconds != null ? parseFloat(row.last_position_seconds) : currentTime;
  return {
    lastPositionSeconds: lastPos,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    maxWatchedSeconds: parseFloat(row.max_watched_seconds) || 0,
  };
}

/**
 * Get progress for a single video (for resume and UI).
 * Resume uses last_position_seconds (where they left off); progress % uses max_watched_seconds with anti-cheat elsewhere.
 */
async function getVideoProgress(userId, videoId) {
  const result = await db.query(
    `SELECT max_watched_seconds, total_watch_seconds, completed_at, last_position_updated_at,
            COALESCE(last_position_seconds, max_watched_seconds) as last_position_seconds
     FROM video_watch_progress WHERE user_id = $1 AND video_id = $2`,
    [userId, videoId]
  );
  const row = result.rows[0];
  if (!row) {
    return { lastPositionSeconds: 0, completedAt: null, maxWatchedSeconds: 0, totalWatchSeconds: 0 };
  }
  const lastPos = row.last_position_seconds != null ? parseFloat(row.last_position_seconds) : parseFloat(row.max_watched_seconds) || 0;
  return {
    lastPositionSeconds: lastPos,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    maxWatchedSeconds: parseFloat(row.max_watched_seconds) || 0,
    totalWatchSeconds: parseFloat(row.total_watch_seconds) || 0,
    lastPositionUpdatedAt: row.last_position_updated_at ? row.last_position_updated_at.toISOString() : null,
  };
}

/**
 * Get course-level progress.
 * - Each video contributes by effective_seconds = min(max_watched_seconds, total_watch_seconds) to prevent seek-cheating.
 * - Course completion % = sum(effective_seconds) / sum(video durations) so partial watch (e.g. 1 min of 2 min = 50%) counts.
 * - Resume uses last_position_seconds; progress uses this effective value.
 */
async function getCourseProgress(userId, courseId) {
  const videosResult = await db.query(
    `SELECT v.id, v.lesson_id, v.duration_seconds
     FROM videos v
     JOIN lessons l ON l.id = v.lesson_id
     WHERE l.course_id = $1 AND (v.status IS NULL OR v.status = 'active')`,
    [courseId]
  );
  const videos = videosResult.rows;
  const lessonIds = [...new Set(videos.map((v) => v.lesson_id).filter(Boolean))];

  const progressResult = await db.query(
    `SELECT video_id, max_watched_seconds, total_watch_seconds, completed_at
     FROM video_watch_progress WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId]
  );
  const progressByVideo = {};
  progressResult.rows.forEach((r) => {
    progressByVideo[r.video_id] = {
      maxWatchedSeconds: parseFloat(r.max_watched_seconds) || 0,
      totalWatchSeconds: parseFloat(r.total_watch_seconds) || 0,
      completedAt: r.completed_at,
    };
  });

  let totalDurationSeconds = 0;
  let totalEffectiveSeconds = 0;
  let videosCompleted90 = 0;
  const videoCompleted90 = {};
  for (const v of videos) {
    const dur = v.duration_seconds != null ? parseFloat(v.duration_seconds) : 0;
    if (dur <= 0) continue;
    totalDurationSeconds += dur;
    const prog = progressByVideo[v.id];
    const maxSec = prog ? prog.maxWatchedSeconds : 0;
    const totalSec = prog ? prog.totalWatchSeconds : 0;
    const effectiveSec = Math.min(maxSec, totalSec);
    totalEffectiveSeconds += effectiveSec;
    const pct = effectiveSec / dur;
    const completed = pct >= NINETY_PERCENT;
    videoCompleted90[v.id] = completed;
    if (completed) videosCompleted90++;
  }

  const completionPercentage = totalDurationSeconds > 0
    ? Math.round((totalEffectiveSeconds / totalDurationSeconds) * 100)
    : 0;

  const totalVideos = videos.length;
  const totalLessons = lessonIds.length;
  let lessonsCompleted = 0;
  for (const lid of lessonIds) {
    const lessonVideosList = videos.filter((v) => v.lesson_id === lid);
    const allComplete = lessonVideosList.length > 0 && lessonVideosList.every((v) => videoCompleted90[v.id]);
    if (allComplete) lessonsCompleted++;
  }

  let assignmentsSubmitted = 0;
  let assignmentsTotal = 0;
  let assignmentsUnsubmitted = 0;
  try {
    for (const v of videos) {
      const video = await videoService.getVideoById(v.id);
      const assignments = video?.assignments ? (typeof video.assignments === 'string' ? JSON.parse(video.assignments) : video.assignments) : [];
      if (Array.isArray(assignments)) {
        assignmentsTotal += assignments.length;
        for (const a of assignments) {
          const submitted = await assignmentService.hasSubmitted(userId, 'video', v.id, null, a.id);
          if (submitted) assignmentsSubmitted++;
        }
      }
    }
    for (const lid of lessonIds) {
      const lesson = await lessonService.getLessonById(lid);
      const assignments = lesson?.assignments ? (typeof lesson.assignments === 'string' ? JSON.parse(lesson.assignments) : lesson.assignments) : [];
      if (Array.isArray(assignments)) {
        assignmentsTotal += assignments.length;
        for (const a of assignments) {
          const submitted = await assignmentService.hasSubmitted(userId, 'lesson', null, lid, a.id);
          if (submitted) assignmentsSubmitted++;
        }
      }
    }
    assignmentsUnsubmitted = Math.max(0, assignmentsTotal - assignmentsSubmitted);
  } catch (e) {
    console.error('getCourseProgress assignment count error:', e);
  }

  // Calculate total time spent watching videos
  let totalTimeSpentSeconds = 0;
  progressResult.rows.forEach((r) => {
    const totalSec = parseFloat(r.total_watch_seconds) || 0;
    totalTimeSpentSeconds += totalSec;
  });

  const completedVideoIds = Object.keys(videoCompleted90 || {}).filter((vid) => videoCompleted90[vid]);

  return {
    courseId,
    totalVideos,
    totalLessons,
    videosCompleted90,
    completedVideoIds,
    lessonsCompleted,
    assignmentsSubmitted,
    assignmentsTotal,
    assignmentsUnsubmitted,
    percentVideosCompleted: totalVideos > 0 ? Math.round((videosCompleted90 / totalVideos) * 100) : 0,
    percentLessonsCompleted: totalLessons > 0 ? Math.round((lessonsCompleted / totalLessons) * 100) : 0,
    completionPercentage: Math.min(100, completionPercentage),
    totalTimeSpentSeconds,
    totalDurationSeconds,
  };
}

/**
 * Recently watched videos/lessons/courses and recently submitted assignments.
 */
async function getRecentActivity(userId, limit = 20) {
  const progressResult = await db.query(
    `SELECT p.video_id, p.lesson_id, p.course_id, p.last_position_updated_at, p.completed_at,
            v.title as video_title, v.duration_seconds,
            l.title as lesson_title,
            c.title as course_title
     FROM video_watch_progress p
     LEFT JOIN videos v ON v.id = p.video_id
     LEFT JOIN lessons l ON l.id = p.lesson_id
     LEFT JOIN courses c ON c.id = p.course_id
     WHERE p.user_id = $1
     ORDER BY p.last_position_updated_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  const recentlyWatched = progressResult.rows.map((r) => ({
    type: 'video',
    videoId: r.video_id,
    lessonId: r.lesson_id,
    courseId: r.course_id,
    videoTitle: r.video_title,
    lessonTitle: r.lesson_title,
    courseTitle: r.course_title,
    durationSeconds: r.duration_seconds != null ? parseFloat(r.duration_seconds) : null,
    lastWatchedAt: r.last_position_updated_at ? r.last_position_updated_at.toISOString() : null,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  }));

  const submissionsResult = await db.query(
    `SELECT s.id, s.assignment_type, s.video_id, s.lesson_id, s.assignment_id, s.submitted_at, s.status,
            v.title as video_title,
            l.title as lesson_title, l.course_id,
            c.title as course_title
     FROM assignment_submissions s
     LEFT JOIN videos v ON v.id = s.video_id
     LEFT JOIN lessons l ON l.id = COALESCE(v.lesson_id, s.lesson_id)
     LEFT JOIN courses c ON c.id = l.course_id
     WHERE s.user_id = $1
     ORDER BY s.submitted_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  const recentlySubmitted = submissionsResult.rows.map((r) => ({
    type: 'assignment',
    submissionId: r.id,
    assignmentType: r.assignment_type,
    videoId: r.video_id,
    lessonId: r.lesson_id,
    courseId: r.course_id,
    assignmentId: r.assignment_id,
    videoTitle: r.video_title,
    lessonTitle: r.lesson_title,
    courseTitle: r.course_title,
    submittedAt: r.submitted_at ? r.submitted_at.toISOString() : null,
    status: r.status,
  }));

  return {
    recentlyWatched,
    recentlySubmitted,
  };
}

/**
 * Get resume position for a video (last position in seconds). Used on watch page load.
 */
async function getResumePosition(userId, videoId) {
  const progress = await getVideoProgress(userId, videoId);
  return progress.lastPositionSeconds;
}

const FINISHED_COURSE_THRESHOLD = 95; // 95%+ completion = finished course

/**
 * Dashboard stats: total courses, finished courses, total watch hours, overall %, progress rating.
 * Progress rating = weighted score from video completion, lesson completion, assignment submission (0-100).
 */
async function getDashboardStats(userId) {
  const enrolled = await db.query(
    'SELECT course_id FROM course_enrollments WHERE user_id = $1',
    [userId]
  );
  const courseIds = enrolled.rows.map((r) => r.course_id);
  const totalCourses = courseIds.length;

  if (courseIds.length === 0) {
    return {
      totalCourses: 0,
      finishedCourses: 0,
      totalWatchHours: 0,
      totalWatchSeconds: 0,
      overallCompletionPercentage: 0,
      progressRating: 0,
      totalVideos: 0,
      totalLessons: 0,
      videosCompleted90: 0,
      lessonsCompleted: 0,
      assignmentsSubmitted: 0,
      assignmentsTotal: 0,
    };
  }

  const totalWatchResult = await db.query(
    `SELECT COALESCE(SUM(total_watch_seconds), 0)::float as total
     FROM video_watch_progress WHERE user_id = $1 AND course_id = ANY($2::uuid[])`,
    [userId, courseIds]
  );
  const totalWatchSeconds = parseFloat(totalWatchResult.rows[0]?.total) || 0;

  const totalDurationResult = await db.query(
    `SELECT COALESCE(SUM(v.duration_seconds), 0)::float as total
     FROM videos v
     JOIN lessons l ON l.id = v.lesson_id
     JOIN course_enrollments ce ON ce.course_id = l.course_id AND ce.user_id = $1
     WHERE (v.status IS NULL OR v.status = 'active')`,
    [userId]
  );
  const totalDurationSeconds = parseFloat(totalDurationResult.rows[0]?.total) || 0;

  const effectiveResult = await db.query(
    `SELECT p.video_id, p.max_watched_seconds, p.total_watch_seconds, v.duration_seconds
     FROM video_watch_progress p
     JOIN videos v ON v.id = p.video_id
     JOIN lessons l ON l.id = v.lesson_id
     JOIN course_enrollments ce ON ce.course_id = l.course_id AND ce.user_id = p.user_id
     WHERE p.user_id = $1 AND p.course_id = ANY($2::uuid[]) AND (v.status IS NULL OR v.status = 'active')`,
    [userId, courseIds]
  );
  let totalEffectiveSeconds = 0;
  effectiveResult.rows.forEach((r) => {
    const maxSec = parseFloat(r.max_watched_seconds) || 0;
    const totalSec = parseFloat(r.total_watch_seconds) || 0;
    totalEffectiveSeconds += Math.min(maxSec, totalSec);
  });

  const overallCompletionPercentage = totalDurationSeconds > 0
    ? Math.min(100, Math.round((totalEffectiveSeconds / totalDurationSeconds) * 100))
    : 0;

  const perCourseResult = await db.query(
    `SELECT p.course_id,
            SUM(LEAST(p.max_watched_seconds, p.total_watch_seconds))::float as effective
     FROM video_watch_progress p
     JOIN videos v ON v.id = p.video_id AND (v.status IS NULL OR v.status = 'active')
     WHERE p.user_id = $1 AND p.course_id = ANY($2::uuid[])
     GROUP BY p.course_id`,
    [userId, courseIds]
  );
  const courseDurations = await db.query(
    `SELECT l.course_id, COALESCE(SUM(v.duration_seconds), 0)::float as total
     FROM videos v
     JOIN lessons l ON l.id = v.lesson_id
     WHERE l.course_id = ANY($1::uuid[]) AND (v.status IS NULL OR v.status = 'active')
     GROUP BY l.course_id`,
    [courseIds]
  );
  const durationByCourse = {};
  courseDurations.rows.forEach((r) => {
    durationByCourse[r.course_id] = parseFloat(r.total) || 0;
  });
  let finishedCourses = 0;
  perCourseResult.rows.forEach((r) => {
    const dur = durationByCourse[r.course_id] || 0;
    if (dur > 0) {
      const pct = (parseFloat(r.effective) || 0) / dur * 100;
      if (pct >= FINISHED_COURSE_THRESHOLD) finishedCourses++;
    }
  });

  let totalVideos = 0;
  let totalLessons = 0;
  let videosCompleted90 = 0;
  let lessonsCompleted = 0;
  let assignmentsSubmitted = 0;
  let assignmentsTotal = 0;
  try {
    for (const cid of courseIds) {
      const prog = await getCourseProgress(userId, cid);
      totalVideos += prog.totalVideos;
      totalLessons += prog.totalLessons;
      videosCompleted90 += prog.videosCompleted90;
      lessonsCompleted += prog.lessonsCompleted;
      assignmentsSubmitted += prog.assignmentsSubmitted;
      assignmentsTotal += prog.assignmentsTotal;
    }
  } catch (e) {
    console.error('getDashboardStats per-course aggregation error:', e);
  }

  const videoScore = totalVideos > 0 ? (videosCompleted90 / totalVideos) * 100 : 0;
  const lessonScore = totalLessons > 0 ? (lessonsCompleted / totalLessons) * 100 : 0;
  const assignmentScore = assignmentsTotal > 0 ? (assignmentsSubmitted / assignmentsTotal) * 100 : 0;
  const progressRating = Math.round(
    0.4 * overallCompletionPercentage +
    0.3 * videoScore +
    0.2 * lessonScore +
    0.1 * assignmentScore
  );
  const progressRatingCapped = Math.min(100, Math.max(0, progressRating));

  return {
    totalCourses,
    finishedCourses,
    totalWatchHours: Math.round((totalWatchSeconds / 3600) * 100) / 100,
    totalWatchSeconds,
    overallCompletionPercentage,
    progressRating: progressRatingCapped,
    totalVideos,
    totalLessons,
    videosCompleted90,
    lessonsCompleted,
    assignmentsSubmitted,
    assignmentsTotal,
  };
}

module.exports = {
  upsertVideoProgress,
  getVideoProgress,
  getCourseProgress,
  getRecentActivity,
  getResumePosition,
  getDashboardStats,
};
