const progressService = require('../services/progressService');
const videoService = require('../services/videoService');

/**
 * POST /progress/video
 * Body: { videoId, lessonId?, courseId?, currentTimeSeconds, watchDeltaSeconds? }
 * Saves watch position and optionally total watch delta. Sets completed when >= 95%.
 */
async function saveVideoProgress(req, res) {
  try {
    const userId = req.user.id;
    const { videoId, lessonId, courseId, currentTimeSeconds, watchDeltaSeconds } = req.body || {};
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }
    const currentTime = currentTimeSeconds != null ? Number(currentTimeSeconds) : 0;
    if (Number.isNaN(currentTime) || currentTime < 0) {
      return res.status(400).json({ error: 'currentTimeSeconds must be a non-negative number' });
    }
    const hasAccess = await videoService.checkPermission(userId, videoId);
    const video = await videoService.getVideoById(videoId);
    const isOwner = video && video.owner_id === userId;
    const isPreview = video && video.is_preview;
    if (!hasAccess && !isOwner && !isPreview) {
      return res.status(403).json({ error: 'Access denied to this video' });
    }
    const result = await progressService.upsertVideoProgress(userId, {
      videoId,
      lessonId: lessonId || null,
      courseId: courseId || null,
      currentTimeSeconds: currentTime,
      watchDeltaSeconds: watchDeltaSeconds != null ? Math.max(0, Number(watchDeltaSeconds)) : 0,
    });
    return res.json(result);
  } catch (error) {
    if (error.message === 'Video not found') {
      return res.status(404).json({ error: 'Video not found' });
    }
    console.error('Save video progress error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * GET /progress/video/:videoId
 * Returns resume position and completion for the video.
 */
async function getVideoProgress(req, res) {
  try {
    const userId = req.user.id;
    const { videoId } = req.params;
    const hasAccess = await videoService.checkPermission(userId, videoId);
    const video = await videoService.getVideoById(videoId);
    const isOwner = video && video.owner_id === userId;
    const isPreview = video && video.is_preview;
    if (!hasAccess && !isOwner && !isPreview) {
      return res.status(403).json({ error: 'Access denied to this video' });
    }
    const progress = await progressService.getVideoProgress(userId, videoId);
    return res.json(progress);
  } catch (error) {
    console.error('Get video progress error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /progress/course/:courseId
 * Returns course-level stats: videos completed 90%+, lessons completed, assignments submitted/total.
 */
async function getCourseProgress(req, res) {
  try {
    const userId = req.user.id;
    const { courseId } = req.params;
    const db = require('../../db');
    const enrolled = await db.query(
      'SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );
    if (!enrolled.rows.length) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }
    const stats = await progressService.getCourseProgress(userId, courseId);
    return res.json(stats);
  } catch (error) {
    console.error('Get course progress error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /progress/recent
 * Query: limit (optional, default 20)
 * Returns recently watched (video/lesson/course) and recently submitted assignments.
 */
async function getRecentActivity(req, res) {
  try {
    const userId = req.user.id;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const activity = await progressService.getRecentActivity(userId, limit);
    return res.json(activity);
  } catch (error) {
    console.error('Get recent activity error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /progress/dashboard
 * Returns dashboard stats: total courses, finished courses, total watch hours, overall %, progress rating.
 */
async function getDashboardStats(req, res) {
  try {
    const userId = req.user.id;
    const stats = await progressService.getDashboardStats(userId);
    return res.json(stats);
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  saveVideoProgress,
  getVideoProgress,
  getCourseProgress,
  getRecentActivity,
  getDashboardStats,
};
