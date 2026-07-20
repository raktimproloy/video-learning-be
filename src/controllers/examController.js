const examService = require('../services/examService');
const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');
const videoService = require('../services/videoService');
const r2Storage = require('../services/r2StorageService');
const { isImage, compressImage } = require('../utils/imageCompress');
const { parseExamTemplateDocx } = require('../services/examTemplateService');

function workspaceTeacherId(req) {
    return req.effectiveTeacherId || req.user.id;
}

function isTeacherWorkspaceUser(req) {
    return req.user?.role === 'teacher' || req.user?.role === 'teacher_staff';
}

/** Resolves { course, ok, status, error } for a lesson-attached exam action. */
async function resolveLessonContext(req, lessonId) {
    const lesson = await lessonService.getLessonById(lessonId);
    if (!lesson) return { ok: false, status: 404, error: 'Lesson not found' };
    const course = await courseService.getCourseById(lesson.course_id, workspaceTeacherId(req));
    if (!course) return { ok: false, status: 404, error: 'Course not found' };
    if (course.teacher_id !== workspaceTeacherId(req)) return { ok: false, status: 403, error: 'Not authorized' };
    return { ok: true, lesson, course };
}

/** Resolves { course, video, ok, status, error } for a video-attached exam action. */
async function resolveVideoContext(req, videoId) {
    const video = await videoService.getVideoById(videoId);
    if (!video) return { ok: false, status: 404, error: 'Video not found' };
    if (video.owner_id !== workspaceTeacherId(req)) return { ok: false, status: 403, error: 'Not authorized' };
    let courseId = null;
    if (video.lesson_id) {
        const lesson = await lessonService.getLessonById(video.lesson_id);
        courseId = lesson?.course_id || null;
    }
    if (!courseId) return { ok: false, status: 400, error: 'Video is not attached to a course lesson' };
    return { ok: true, video, courseId };
}

class ExamController {
    async listForLesson(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user.id, req.user.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = isTeacherWorkspaceUser(req) && course.teacher_id === workspaceTeacherId(req);
            const isStudent = req.user.role === 'student';
            if (isStudent) {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) {
                return res.status(403).json({ error: 'Access denied' });
            }
            let exams = await examService.listByLesson(lessonId);
            if (isStudent) exams = exams.filter((e) => e.status === 'published');
            res.json({ exams });
        } catch (error) {
            console.error('List lesson exams error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async listForVideo(req, res) {
        try {
            const videoId = req.params.videoId;
            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).json({ error: 'Video not found' });
            const isTeacher = isTeacherWorkspaceUser(req) && video.owner_id === workspaceTeacherId(req);
            const isStudent = req.user.role === 'student';
            if (isStudent) {
                const hasAccess = (await videoService.isOwnerOrManager(req.user.id, videoId)) || (await videoService.checkPermission(req.user.id, videoId)) || video.is_preview;
                if (!hasAccess) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) {
                return res.status(403).json({ error: 'Access denied' });
            }
            let exams = await examService.listByVideo(videoId);
            if (isStudent) exams = exams.filter((e) => e.status === 'published');
            res.json({ exams });
        } catch (error) {
            console.error('List video exams error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async createForLesson(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const ctx = await resolveLessonContext(req, req.params.id);
            if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
            const { title, description, timeLimitMinutes, questions, gradingBands } = req.body || {};
            const exam = await examService.createExam(workspaceTeacherId(req), {
                courseId: ctx.course.id,
                lessonId: ctx.lesson.id,
                title, description, timeLimitMinutes, questions, gradingBands,
            });
            res.status(201).json({ exam });
        } catch (error) {
            console.error('Create lesson exam error:', error);
            res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async createForVideo(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const ctx = await resolveVideoContext(req, req.params.videoId);
            if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
            const { title, description, timeLimitMinutes, questions, gradingBands } = req.body || {};
            const exam = await examService.createExam(workspaceTeacherId(req), {
                courseId: ctx.courseId,
                videoId: ctx.video.id,
                title, description, timeLimitMinutes, questions, gradingBands,
            });
            res.status(201).json({ exam });
        } catch (error) {
            console.error('Create video exam error:', error);
            res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async update(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const exam = await examService.getById(req.params.examId);
            if (!exam) return res.status(404).json({ error: 'Exam not found' });
            if (exam.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const { title, description, timeLimitMinutes, questions, gradingBands } = req.body || {};
            const updated = await examService.updateExam(exam.id, workspaceTeacherId(req), {
                title, description, timeLimitMinutes, questions, gradingBands,
            });
            res.json({ exam: updated });
        } catch (error) {
            console.error('Update exam error:', error);
            res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async setStatus(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const exam = await examService.getById(req.params.examId);
            if (!exam) return res.status(404).json({ error: 'Exam not found' });
            if (exam.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const { status } = req.body || {};
            const updated = await examService.setStatus(exam.id, workspaceTeacherId(req), status);
            res.json({ exam: updated });
        } catch (error) {
            console.error('Set exam status error:', error);
            res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async deleteExam(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const exam = await examService.getById(req.params.examId);
            if (!exam) return res.status(404).json({ error: 'Exam not found' });
            if (exam.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            await examService.deleteExam(exam.id, workspaceTeacherId(req));
            res.json({ success: true });
        } catch (error) {
            console.error('Delete exam error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async uploadImage(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const exam = await examService.getById(req.params.examId);
            if (!exam) return res.status(404).json({ error: 'Exam not found' });
            if (exam.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            if (!req.file) return res.status(400).json({ error: 'No image file provided' });
            if (!r2Storage.isConfigured) return res.status(503).json({ error: 'File storage is not configured' });

            let buffer = req.file.buffer;
            if (isImage(req.file.originalname)) {
                buffer = await compressImage(buffer, req.file.originalname, true);
            }
            const key = await r2Storage.uploadExamMedia(
                workspaceTeacherId(req),
                exam.course_id,
                exam.id,
                buffer,
                req.file.originalname,
                'images'
            );
            res.json({ imagePath: key });
        } catch (error) {
            console.error('Upload exam image error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /** Public, unauthenticated media proxy for exam images (R2 keys are unguessable UUIDs). */
    async streamExamMedia(req, res) {
        try {
            const key = req.params.key;
            if (!key || !r2Storage.isConfigured) {
                return res.status(404).send('Media not found');
            }
            const exists = await r2Storage.objectExists(key);
            if (!exists) return res.status(404).send('Media not found');

            const ext = key.split('.').pop().toLowerCase();
            let contentType = 'application/octet-stream';
            if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                contentType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            }
            const stream = await r2Storage.getObjectStream(key);
            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'public, max-age=31536000');
            stream.pipe(res);
        } catch (error) {
            console.error('Stream exam media error:', error);
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Media not found');
            }
            res.status(500).send('Internal server error');
        }
    }

    async parseTemplate(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            if (!req.file) return res.status(400).json({ error: 'No template file provided' });
            const result = await parseExamTemplateDocx(req.file.buffer);
            res.json(result);
        } catch (error) {
            console.error('Parse exam template error:', error);
            res.status(500).json({ error: 'Failed to parse template. Make sure it is a .docx file following the provided format.' });
        }
    }
}

module.exports = new ExamController();
