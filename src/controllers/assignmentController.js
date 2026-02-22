const assignmentService = require('../services/assignmentService');
const videoService = require('../services/videoService');
const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');
const db = require('../../db');

/**
 * POST /assignments/submit
 * FormData: assignmentType, videoId?, lessonId, assignmentId, urlLink?
 * FormData: files (array, optional) - at least one of files or urlLink required
 */
async function submitAssignment(req, res) {
  try {
    const userId = req.user.id;
    const { assignmentType, videoId, lessonId, assignmentId, urlLink } = req.body;
    const files = req.files || [];

    if (!assignmentType || !assignmentId) {
      return res.status(400).json({ error: 'assignmentType and assignmentId are required' });
    }
    if (assignmentType === 'video' && !videoId) {
      return res.status(400).json({ error: 'videoId required for video assignment' });
    }
    if (assignmentType === 'lesson' && !lessonId) {
      return res.status(400).json({ error: 'lessonId required for lesson assignment' });
    }
    const hasFiles = Array.isArray(files) && files.length > 0;
    const hasUrl = urlLink && String(urlLink).trim().length > 0;
    if (!hasFiles && !hasUrl) {
      return res.status(400).json({ error: 'Provide at least one file or a URL link' });
    }

    const submission = await assignmentService.submitAssignment(
      userId,
      { assignmentType, videoId: videoId || null, lessonId: lessonId || null, assignmentId, urlLink: urlLink || null },
      files
    );
    res.status(201).json(submission);
  } catch (error) {
    console.error('Submit assignment error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * GET /assignments/status/video/:videoId
 */
async function getVideoStatus(req, res) {
  try {
    const userId = req.user.id;
    const { videoId } = req.params;

    const hasAccess = await videoService.checkPermission(userId, videoId) || (await videoService.getVideoById(videoId))?.owner_id === userId;
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const status = await assignmentService.getVideoSubmissionStatus(userId, videoId);
    res.json(status);
  } catch (error) {
    console.error('Get video status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /assignments/status/lesson/:lessonId
 */
async function getLessonStatus(req, res) {
  try {
    const userId = req.user.id;
    const { lessonId } = req.params;

    const lesson = await lessonService.getLessonById(lessonId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    const course = await courseService.getCourseById(lesson.course_id);
    const enrolled = await db.query(
      'SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2',
      [userId, lesson.course_id]
    );
    const isTeacher = course?.teacher_id === userId;
    if (!enrolled.rows.length && !isTeacher) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const status = await assignmentService.getLessonSubmissionStatus(userId, lessonId);
    res.json(status);
  } catch (error) {
    console.error('Get lesson status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /assignments/lock-check
 */
async function getLockStatus(req, res) {
  try {
    const userId = req.user.id;
    const { videoId, lessonId, courseId, nextVideoId, nextLessonId } = req.query;
    const result = { nextVideoLocked: false, nextLessonLocked: false };
    if (videoId && nextVideoId) {
      result.nextVideoLocked = await assignmentService.isNextVideoLocked(userId, videoId, nextVideoId);
    }
    if (lessonId && nextLessonId) {
      result.nextLessonLocked = await assignmentService.isNextLessonLocked(userId, courseId, lessonId, nextLessonId);
    }
    res.json(result);
  } catch (error) {
    console.error('Get lock status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /assignments/watch-context?videoId=...
 * Returns submission status + lock status for next video/lesson.
 * For preview videos, allows access without enrollment and returns isPreviewOnly + requiresPurchase flags.
 */
async function getWatchContext(req, res) {
  try {
    const userId = req.user.id;
    const { videoId } = req.query;
    if (!videoId) return res.status(400).json({ error: 'videoId required' });

    const video = await videoService.getVideoById(videoId);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    const isOwner = video.owner_id === userId;
    const enrolled = await videoService.checkPermission(userId, videoId);
    const hasAccess = isOwner || enrolled || (video.is_preview === true);
    if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

    const isPreviewOnly = hasAccess && !isOwner && !enrolled;

    const submissionStatus = isPreviewOnly ? {} : await assignmentService.getVideoSubmissionStatus(userId, videoId);

    const lessonId = video.lesson_id;
    let nextVideoLocked = false;
    let nextLessonLocked = false;
    let nextVideoId = null;
    let nextLessonId = null;
    let nextLessonTitle = null;
    let nextVideoIsPreview = false;
    let nextVideoRequiresPurchase = false;
    let nextLessonFullyPreview = false;
    let nextLessonRequiresPurchase = false;
    let nextLessonFirstVideoId = null;

    if (lessonId) {
      const lesson = await lessonService.getLessonById(lessonId);
      const videosResult = await db.query(
        'SELECT id, is_preview FROM videos WHERE lesson_id = $1 ORDER BY "order" ASC',
        [lessonId]
      );
      const videosRows = videosResult.rows;
      const idx = videosRows.findIndex((v) => v.id === videoId);
      const nextVideoRow = idx >= 0 && idx < videosRows.length - 1 ? videosRows[idx + 1] : null;

      if (nextVideoRow) {
        nextVideoId = nextVideoRow.id;
        nextVideoIsPreview = nextVideoRow.is_preview === true;
        if (isPreviewOnly) {
          nextVideoLocked = !nextVideoIsPreview;
          nextVideoRequiresPurchase = !nextVideoIsPreview;
        } else {
          nextVideoLocked = await assignmentService.isNextVideoLocked(userId, videoId, nextVideoRow.id);
        }
      } else {
        const lessonsResult = await db.query(
          'SELECT id, title FROM lessons WHERE course_id = $1 ORDER BY "order" ASC',
          [lesson.course_id]
        );
        const lessonsRows = lessonsResult.rows;
        const lIdx = lessonsRows.findIndex((l) => l.id === lessonId);
        const nextL = lIdx >= 0 && lIdx < lessonsRows.length - 1 ? lessonsRows[lIdx + 1] : null;
        if (nextL) {
          nextLessonId = nextL.id;
          nextLessonTitle = nextL.title;
          const nextLessonVideos = await db.query(
            'SELECT id, is_preview FROM videos WHERE lesson_id = $1 ORDER BY "order" ASC',
            [nextL.id]
          );
          const nvRows = nextLessonVideos.rows;
          nextLessonFullyPreview = nvRows.length > 0 && nvRows.every((v) => v.is_preview === true);
          if (nvRows.length > 0) nextLessonFirstVideoId = nvRows[0].id;
          if (isPreviewOnly) {
            nextLessonLocked = !nextLessonFullyPreview;
            nextLessonRequiresPurchase = !nextLessonFullyPreview;
          } else {
            nextLessonLocked = await assignmentService.isNextLessonLocked(userId, lesson.course_id, lessonId, nextL.id);
          }
        }
      }
    }

    res.json({
      isPreviewOnly,
      submissionStatus,
      nextVideoLocked,
      nextLessonLocked,
      nextVideoId,
      nextLessonId,
      nextLessonTitle,
      nextLessonFirstVideoId,
      nextVideoIsPreview,
      nextVideoRequiresPurchase,
      nextLessonFullyPreview,
      nextLessonRequiresPurchase,
    });
  } catch (error) {
    console.error('Get watch context error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /assignments/teacher/list
 * Query: courseId?, status?
 * Teacher only. List submissions for teacher's courses.
 */
async function listTeacherSubmissions(req, res) {
  try {
    const teacherId = req.user.id;
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher access required' });
    }
    const { courseId, status } = req.query;
    const list = await assignmentService.listTeacherSubmissions(teacherId, { courseId: courseId || undefined, status: status || undefined });
    res.json(list);
  } catch (error) {
    console.error('List teacher submissions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /assignments/teacher/:id
 * Teacher only. Get single submission detail.
 */
async function getTeacherSubmissionById(req, res) {
  try {
    const teacherId = req.user.id;
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher access required' });
    }
    const { id } = req.params;
    const sub = await assignmentService.getSubmissionById(id, teacherId);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    res.json(sub);
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /assignments/teacher/:id/grant
 * Body: { marks?: "10/30" }
 * Teacher only. Grant submission (status = passed).
 */
async function grantSubmission(req, res) {
  try {
    const teacherId = req.user.id;
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher access required' });
    }
    const { id } = req.params;
    const { marks } = req.body || {};
    const sub = await assignmentService.grantSubmission(id, teacherId, marks || null);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    res.json(sub);
  } catch (error) {
    console.error('Grant submission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /assignments/teacher/:id/decline
 * Teacher only. Decline submission (status = failed).
 */
async function declineSubmission(req, res) {
  try {
    const teacherId = req.user.id;
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher access required' });
    }
    const { id } = req.params;
    const sub = await assignmentService.declineSubmission(id, teacherId);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    res.json(sub);
  } catch (error) {
    console.error('Decline submission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /assignments/cancel
 * Body: { assignmentType, videoId?, lessonId, assignmentId }
 * Student only. Cancel pending submission.
 */
async function cancelSubmission(req, res) {
  try {
    const userId = req.user.id;
    const { assignmentType, videoId, lessonId, assignmentId } = req.body;
    
    if (!assignmentType || !assignmentId) {
      return res.status(400).json({ error: 'assignmentType and assignmentId are required' });
    }
    if (assignmentType === 'video' && !videoId) {
      return res.status(400).json({ error: 'videoId required for video assignment' });
    }
    if (assignmentType === 'lesson' && !lessonId) {
      return res.status(400).json({ error: 'lessonId required for lesson assignment' });
    }

    const submission = await assignmentService.getSubmissionByAssignmentAndUser(
      userId,
      assignmentType,
      videoId || null,
      lessonId || null,
      assignmentId
    );

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submission.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending submissions can be canceled' });
    }

    await assignmentService.cancelSubmission(submission.id, userId);
    res.json({ message: 'Submission canceled successfully' });
  } catch (error) {
    console.error('Cancel submission error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * GET /assignments/teacher/:id/preview?fileIndex=0
 * Teacher only. Stream submission file for inline preview (image, PDF, txt).
 * If fileIndex is provided, previews that file from files_json array.
 */
async function streamSubmissionPreview(req, res) {
  try {
    const teacherId = req.user.id;
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher access required' });
    }
    const { id } = req.params;
    const fileIndex = req.query.fileIndex !== undefined ? parseInt(req.query.fileIndex, 10) : null;
    const result = await assignmentService.getSubmissionFileForPreview(id, teacherId, fileIndex);
    if (!result) return res.status(404).send('File not found');

    res.set('Content-Type', result.contentType);
    if (result.stream) {
      result.stream.pipe(res);
    } else if (result.path) {
      const fs = require('fs');
      const readStream = fs.createReadStream(result.path);
      readStream.pipe(res);
    } else {
      res.status(404).send('File not found');
    }
  } catch (error) {
    console.error('Stream submission preview error:', error);
    res.status(500).send('Internal server error');
  }
}

module.exports = {
  submitAssignment,
  getVideoStatus,
  getLessonStatus,
  getLockStatus,
  getWatchContext,
  listTeacherSubmissions,
  getTeacherSubmissionById,
  grantSubmission,
  declineSubmission,
  cancelSubmission,
  streamSubmissionPreview,
};
