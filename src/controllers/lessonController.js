const db = require('../../db');
const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');
const liveChatService = require('../services/liveChatService');
const liveMaterialService = require('../services/liveMaterialService');
const liveWatchService = require('../services/liveWatchService');
const liveSessionService = require('../services/liveSessionService');
const { isImage, compressImage } = require('../utils/imageCompress');
const videoService = require('../services/videoService');
const agoraService = require('../services/agoraService');
const adminService = require('../services/adminService');
const r2Storage = require('../services/r2StorageService');
const fs = require('fs');
const path = require('path');

const STAGING_DIR = path.resolve(__dirname, '../../staging');
const UPLOADS_LESSONS = path.resolve(__dirname, '../../uploads/lessons');

function parseNotesAndAssignments(body) {
    let notes = [];
    let assignments = [];
    try {
        notes = body.notes ? (typeof body.notes === 'string' ? JSON.parse(body.notes) : body.notes) : [];
    } catch (e) {
        notes = [];
    }
    try {
        assignments = body.assignments ? (typeof body.assignments === 'string' ? JSON.parse(body.assignments) : body.assignments) : [];
    } catch (e) {
        assignments = [];
    }
    return { notes, assignments };
}

async function processLessonFiles(req, notes, assignments, lessonId, courseId, teacherId) {
    const files = req.files || (req.file ? [req.file] : []);
    const noteFiles = {};
    const assignmentFiles = {};
    files.forEach((f) => {
        const m = f.fieldname?.match(/^note_file_(\d+)$/);
        if (m) noteFiles[parseInt(m[1], 10)] = f;
        const m2 = f.fieldname?.match(/^assignment_file_(\d+)$/);
        if (m2) assignmentFiles[parseInt(m2[1], 10)] = f;
    });

    const outNotes = [...notes];
    for (let i = 0; i < outNotes.length; i++) {
        const note = outNotes[i];
        if (note.type === 'file' && noteFiles[i]) {
            const f = noteFiles[i];
            let buffer = f.buffer || (f.path ? fs.readFileSync(f.path) : null);
            if (buffer && isImage(f.originalname)) buffer = await compressImage(buffer, f.originalname);
            if (buffer) {
                if (r2Storage.isConfigured && r2Storage.uploadLessonMedia) {
                    const r2Key = await r2Storage.uploadLessonMedia(teacherId, courseId, lessonId, buffer, f.originalname, 'notes');
                    note.filePath = r2Key;
                    note.fileName = f.originalname;
                } else {
                    const dir = path.join(UPLOADS_LESSONS, lessonId, 'notes');
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    const ext = path.extname(f.originalname);
                    const fileName = `note-${Date.now()}-${i}${ext}`;
                    const filePath = path.join(dir, fileName);
                    fs.writeFileSync(filePath, buffer);
                    note.filePath = `/uploads/lessons/${lessonId}/notes/${fileName}`;
                    note.fileName = f.originalname;
                }
            }
        }
    }

    const outAssignments = [...assignments];
    for (let i = 0; i < outAssignments.length; i++) {
        const a = outAssignments[i];
        if (a.type === 'file' && assignmentFiles[i]) {
            const f = assignmentFiles[i];
            let buffer = f.buffer || (f.path ? fs.readFileSync(f.path) : null);
            if (buffer && isImage(f.originalname)) buffer = await compressImage(buffer, f.originalname);
            if (buffer) {
                if (r2Storage.isConfigured && r2Storage.uploadLessonMedia) {
                    const r2Key = await r2Storage.uploadLessonMedia(teacherId, courseId, lessonId, buffer, f.originalname, 'assignments');
                    a.filePath = r2Key;
                    a.fileName = f.originalname;
                } else {
                    const dir = path.join(UPLOADS_LESSONS, lessonId, 'assignments');
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    const ext = path.extname(f.originalname);
                    const fileName = `assignment-${Date.now()}-${i}${ext}`;
                    const filePath = path.join(dir, fileName);
                    fs.writeFileSync(filePath, buffer);
                    a.filePath = `/uploads/lessons/${lessonId}/assignments/${fileName}`;
                    a.fileName = f.originalname;
                }
            }
        }
    }

    return { notes: outNotes, assignments: outAssignments };
}

class LessonController {
    async createLesson(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { courseId, title, description, order, isPreview } = req.body;
            const { notes, assignments } = parseNotesAndAssignments(req.body);

            const course = await courseService.getCourseById(courseId);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

            const lessonData = {
                title: (title || '').trim(),
                description: (description || '').trim(),
                order: parseInt(order, 10) || 0,
                isPreview: isPreview === 'true' || isPreview === true,
                notes,
                assignments,
            };

            if (lessonData.isPreview) {
                const { allowed, reason } = await lessonService.canSetLessonPreview(courseId, lessonData.order, null);
                if (!allowed) {
                    return res.status(400).json({ error: reason });
                }
            }

            let lesson = await lessonService.createLesson(courseId, lessonData);
            const { notes: finalNotes, assignments: finalAssignments } = await processLessonFiles(
                req,
                notes,
                assignments,
                lesson.id,
                courseId,
                req.user.id
            );
            if (finalNotes.length > 0 || finalAssignments.length > 0) {
                lesson = await lessonService.updateLesson(lesson.id, { notes: finalNotes, assignments: finalAssignments });
            }
            res.status(201).json(lesson);
        } catch (error) {
            console.error('Create lesson error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async getLessonsByCourse(req, res) {
        try {
            const userId = req.user?.id || null;
            const course = await courseService.getCourseByIdSimple(req.params.courseId);
            const teacherId = course?.teacher_id ?? null;
            const lessons = await lessonService.getLessonsByCourse(req.params.courseId, userId, teacherId);
            res.json(lessons);
        } catch (error) {
            console.error('Get lessons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLessonVideos(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) {
                return res.status(404).json({ error: 'Lesson not found' });
            }
            const course = await courseService.getCourseByIdSimple(lesson.course_id);
            const isOwner = course && req.user?.id && course.teacher_id === req.user.id;
            const userId = req.user?.role === 'student' ? req.user.id : null;
            const videos = await videoService.getVideosByLesson(lessonId, userId, false, isOwner);
            res.json(videos);
        } catch (error) {
            console.error('Get lesson videos error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLessonById(req, res) {
        try {
            const lesson = await lessonService.getLessonById(req.params.id);
            if (!lesson) {
                return res.status(404).json({ error: 'Lesson not found' });
            }
            res.json(lesson);
        } catch (error) {
            console.error('Get lesson error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async updateLesson(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { title, description, order, isPreview, status } = req.body;
            const { notes, assignments } = parseNotesAndAssignments(req.body);

            const existingLesson = await lessonService.getLessonById(req.params.id);
            if (!existingLesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(existingLesson.course_id);
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

            let finalNotes = notes.length > 0 ? notes : existingLesson.notes || [];
            let finalAssignments = assignments.length > 0 ? assignments : existingLesson.assignments || [];
            const hasFiles = req.files?.length > 0 || req.file;
            if (hasFiles) {
                const processed = await processLessonFiles(
                    req,
                    finalNotes,
                    finalAssignments,
                    req.params.id,
                    existingLesson.course_id,
                    req.user.id
                );
                finalNotes = processed.notes;
                finalAssignments = processed.assignments;
            }

            const lessonData = {};
            if (title !== undefined) lessonData.title = title.trim();
            if (description !== undefined) lessonData.description = description.trim();
            if (order !== undefined) lessonData.order = parseInt(order, 10) || 0;
            if (isPreview !== undefined) lessonData.isPreview = isPreview === 'true' || isPreview === true;
            if (notes.length > 0 || hasFiles) lessonData.notes = finalNotes;
            if (assignments.length > 0 || hasFiles) lessonData.assignments = finalAssignments;
            if (status !== undefined) lessonData.status = status;

            const effectivePreview = lessonData.isPreview === true;
            const effectiveOrder = lessonData.order !== undefined ? lessonData.order : existingLesson.order;
            if (effectivePreview) {
                const { allowed, reason } = await lessonService.canSetLessonPreview(existingLesson.course_id, effectiveOrder, req.params.id);
                if (!allowed) {
                    return res.status(400).json({ error: reason });
                }
            }

            const lesson = await lessonService.updateLesson(req.params.id, lessonData);
            res.json(lesson);
        } catch (error) {
            console.error('Update lesson error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async getLiveLessons(req, res) {
        try {
            const lessons = req.user.role === 'student'
                ? await lessonService.getLiveLessonsForStudent(req.user.id)
                : await lessonService.getLiveLessons();
            res.json(lessons);
        } catch (error) {
            console.error('Get live lessons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getTeacherLiveLessons(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const lessons = await lessonService.getTeacherLiveLessons(req.user.id);
            res.json(lessons);
        } catch (error) {
            console.error('Get teacher live lessons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async setLiveAndGetToken(req, res) {
        try {
            const { id } = req.params;
            const { is_live } = req.body;
            const lesson = await lessonService.getLessonById(id);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });

            if (req.user.role === 'teacher') {
                if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
                if (is_live === true) {
                    const { live_name, live_order, live_description } = req.body || {};
                    const liveOrder = live_order != null ? parseInt(live_order, 10) : 0;
                    const liveName = (live_name && String(live_name).trim()) ? String(live_name).trim() : (lesson.title || 'Live');
                    const liveSession = await liveSessionService.create(id, lesson.course_id, req.user.id, {
                        liveName: liveName || lesson.title,
                        liveOrder,
                        liveDescription: (live_description && String(live_description).trim()) || null
                    });
                    const sessionData = {
                        live_session_name: liveName,
                        live_session_order: liveOrder,
                        live_session_description: (live_description && String(live_description).trim()) || null,
                        current_live_session_id: liveSession.id
                    };
                    const updatedLesson = await lessonService.updateLiveStatus(id, true, sessionData);
                    const uid = Math.abs(req.user.id.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)) % 2147483647;
                    const creds = agoraService.generateRtcToken(id, uid, 'publisher');
                    if (!creds) return res.status(503).json({ error: 'Agora not configured. Set AGORA_APP_ID.' });
                    return res.json({ ...creds, lesson: updatedLesson || lesson, is_live: true, live_session_id: liveSession.id });
                }
                if (is_live === false) {
                    await liveSessionService.endDiscarded(id);
                    await lessonService.updateLiveStatus(id, false, {});
                    return res.json({ is_live: false, lesson });
                }
            }
            return res.status(400).json({ error: 'Invalid request' });
        } catch (error) {
            console.error('Set live error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveToken(req, res) {
        try {
            const { id } = req.params;
            const lesson = await lessonService.getLessonById(id);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });

            if (req.user.role === 'teacher') {
                if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
                const uid = Math.abs(req.user.id.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)) % 2147483647;
                const creds = agoraService.generateRtcToken(id, uid, 'publisher');
                if (!creds) return res.status(503).json({ error: 'Agora not configured.' });
                return res.json(creds);
            }

            if (req.user.role === 'student') {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Purchase this course to watch the live stream.' });
                if (!lesson.is_live) return res.status(404).json({ error: 'This lesson is not live.' });
                const uid = Math.abs(req.user.id.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)) % 2147483647;
                const creds = agoraService.generateRtcToken(id, uid, 'subscriber');
                if (!creds) return res.status(503).json({ error: 'Agora not configured.' });
                return res.json(creds);
            }

            return res.status(403).json({ error: 'Access denied' });
        } catch (error) {
            console.error('Get live token error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveChat(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = req.user.role === 'teacher' && course.teacher_id === req.user.id;
            const isStudent = req.user.role === 'student';
            if (isStudent) {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) return res.status(403).json({ error: 'Access denied' });
            const liveSessionId = lesson.current_live_session_id || null;
            const messages = await liveChatService.getMessages(lessonId, liveSessionId);
            res.json({ messages });
        } catch (error) {
            console.error('Get live chat error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveMaterials(req, res) {
        try {
            const lessonId = req.params.id;
            const { liveSessionId: querySessionId } = req.query;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = req.user.role === 'teacher' && course.teacher_id === req.user.id;
            const isStudent = req.user.role === 'student';
            if (isStudent) {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) return res.status(403).json({ error: 'Access denied' });
            const liveSessionId = querySessionId && String(querySessionId).trim()
                ? String(querySessionId).trim()
                : (lesson.current_live_session_id || null);
            const materials = await liveMaterialService.list(lessonId, liveSessionId);
            res.json({ materials });
        } catch (error) {
            console.error('Get live materials error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveStartedAt(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = req.user.role === 'teacher' && course.teacher_id === req.user.id;
            const isStudent = req.user.role === 'student';
            if (isStudent) {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) return res.status(403).json({ error: 'Access denied' });
            const startedAt = await lessonService.getLiveStartedAt(lessonId);
            res.json({ live_started_at: startedAt });
        } catch (error) {
            console.error('Get live started-at error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveStats(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = req.user.role === 'teacher' && course.teacher_id === req.user.id;
            const isStudent = req.user.role === 'student';
            if (isStudent) {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) return res.status(403).json({ error: 'Access denied' });
            const live_started_at = await lessonService.getLiveStartedAt(lessonId);
            const viewerCount = await liveWatchService.getViewerCount(lessonId, course.teacher_id);
            const live_session_id = lesson.current_live_session_id || null;
            let broadcast_status = 'ended';
            let live_name = null;
            let live_description = null;
            if (live_session_id) {
                const session = await liveSessionService.getById(live_session_id);
                broadcast_status = session?.broadcast_status || 'starting';
                live_name = session?.live_name ?? null;
                live_description = session?.live_description ?? null;
            }
            res.json({ live_started_at, viewerCount, live_session_id, broadcast_status, live_name, live_description });
        } catch (error) {
            console.error('Get live stats error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async updateLiveSession(req, res) {
        try {
            if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
            const { live_name, live_description } = req.body || {};
            const session = await liveSessionService.updateSession(lessonId, {
                liveName: live_name,
                liveDescription: live_description,
            });
            if (!session) return res.status(400).json({ error: 'No active live session' });
            res.json({ live_name: session.live_name, live_description: session.live_description });
        } catch (error) {
            console.error('Update live session error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async setBroadcastStatus(req, res) {
        try {
            if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
            const { broadcast_status } = req.body || {};
            if (!['live', 'paused', 'ended'].includes(broadcast_status)) {
                return res.status(400).json({ error: 'broadcast_status must be live, paused, or ended' });
            }
            await liveSessionService.setBroadcastStatus(lessonId, broadcast_status);
            res.json({ broadcast_status });
        } catch (error) {
            console.error('Set broadcast status error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveViewers(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (req.user.role !== 'teacher' || course.teacher_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
            const watchers = await liveWatchService.getWatchers(lessonId);
            const viewerCount = await liveWatchService.getViewerCount(lessonId, course.teacher_id);
            res.json({ watchers, viewerCount });
        } catch (error) {
            console.error('Get live viewers error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async liveWatchJoin(req, res) {
        try {
            if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
            if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            if (!lesson.is_live) return res.status(400).json({ error: 'Lesson is not live' });
            const liveSessionId = lesson.current_live_session_id || null;
            await liveWatchService.join(lessonId, req.user.id, liveSessionId);
            const viewerCount = await liveWatchService.getViewerCount(lessonId, course.teacher_id);
            res.json({ ok: true, viewerCount });
        } catch (error) {
            console.error('Live watch join error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async liveWatchLeave(req, res) {
        try {
            if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
            const lessonId = req.params.id;
            await liveWatchService.leave(lessonId, req.user.id);
            res.json({ ok: true });
        } catch (error) {
            console.error('Live watch leave error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async liveWatchHeartbeat(req, res) {
        try {
            if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            await liveWatchService.heartbeat(lessonId, req.user.id);
            const course = await courseService.getCourseById(lesson.course_id);
            const viewerCount = await liveWatchService.getViewerCount(lessonId, course?.teacher_id);
            res.json({ ok: true, viewerCount });
        } catch (error) {
            console.error('Live watch heartbeat error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async addLiveNote(req, res) {
        try {
            if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
            const content = (req.body && req.body.content) || '';
            const file = req.files?.file?.[0];
            let filePath = null, fileName = null;
            if (file && (file.buffer || file.path)) {
                const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
                if (buffer && r2Storage.isConfigured && r2Storage.uploadLessonMedia) {
                    const r2Key = await r2Storage.uploadLessonMedia(req.user.id, lesson.course_id, lessonId, buffer, file.originalname || 'file', 'notes');
                    filePath = r2Key;
                    fileName = file.originalname || 'file';
                } else {
                    const dir = path.join(UPLOADS_LESSONS, lessonId, 'live_notes');
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    const ext = path.extname(file.originalname || '') || '.bin';
                    const fname = `note-${Date.now()}${ext}`;
                    const fullPath = path.join(dir, fname);
                    fs.writeFileSync(fullPath, buffer);
                    filePath = `/uploads/lessons/${lessonId}/live_notes/${fname}`;
                    fileName = file.originalname || 'file';
                }
            }
            const liveSessionId = lesson.current_live_session_id || null;
            const material = await liveMaterialService.addNote(lessonId, req.user.id, { content: content.trim() || null, filePath, fileName }, liveSessionId);
            const getIo = require('../socket').getIo;
            getIo().to(lessonId).emit('liveMaterialAdded', material);
            res.status(201).json(material);
        } catch (error) {
            console.error('Add live note error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async addLiveAssignment(req, res) {
        try {
            if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
            const content = (req.body && req.body.content) || '';
            const isRequired = req.body && (req.body.is_required === true || req.body.is_required === 'true');
            const file = req.files?.file?.[0];
            let filePath = null, fileName = null;
            if (file && (file.buffer || file.path)) {
                const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
                if (buffer && r2Storage.isConfigured && r2Storage.uploadLessonMedia) {
                    const r2Key = await r2Storage.uploadLessonMedia(req.user.id, lesson.course_id, lessonId, buffer, file.originalname || 'file', 'assignments');
                    filePath = r2Key;
                    fileName = file.originalname || 'file';
                } else {
                    const dir = path.join(UPLOADS_LESSONS, lessonId, 'live_assignments');
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    const ext = path.extname(file.originalname || '') || '.bin';
                    const fname = `assignment-${Date.now()}${ext}`;
                    const fullPath = path.join(dir, fname);
                    fs.writeFileSync(fullPath, buffer);
                    filePath = `/uploads/lessons/${lessonId}/live_assignments/${fname}`;
                    fileName = file.originalname || 'file';
                }
            }
            const liveSessionId = lesson.current_live_session_id || null;
            const material = await liveMaterialService.addAssignment(lessonId, req.user.id, { content: content.trim() || null, filePath, fileName, isRequired }, liveSessionId);
            const getIo = require('../socket').getIo;
            getIo().to(lessonId).emit('liveMaterialAdded', material);
            res.status(201).json(material);
        } catch (error) {
            console.error('Add live assignment error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async deleteLesson(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const existingLesson = await lessonService.getLessonById(req.params.id);
            if (!existingLesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(existingLesson.course_id);
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

            await lessonService.deleteLesson(req.params.id);
            res.json({ message: 'Lesson deleted successfully' });
        } catch (error) {
            console.error('Delete lesson error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Save live stream recording. Teacher only; creates an encrypted video using live_session_id as video_id.
     * All live info (chat, materials) is associated with that ID.
     */
    async saveLiveRecording(req, res) {
        try {
            if (req.user.role !== 'teacher') {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const lessonId = req.params.id;
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({ error: 'No recording file uploaded.' });
            }
            if (req.file.buffer.length < 1000) {
                return res.status(400).json({ error: 'Recording is too short or invalid. Record for at least a few seconds before saving.' });
            }

            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized to save recording for this lesson.' });

            const liveSession = await liveSessionService.getActiveByLesson(lessonId);
            if (!liveSession) {
                return res.status(400).json({ error: 'No active live session found. Start a live stream and record before saving.' });
            }

            const videoId = liveSession.id;
            const ownerId = req.user.id;
            const liveName = liveSession.live_name || lesson.title;
            const liveOrder = liveSession.live_order != null ? parseInt(liveSession.live_order, 10) : 0;
            const liveDesc = liveSession.live_description || null;
            const title = liveName ? (liveName.startsWith('Live:') ? liveName : `Live: ${liveName}`) : `Live: ${lesson.title}`;
            const useR2 = r2Storage.isConfigured;

            const sessionMaterials = await liveMaterialService.listBySession(liveSession.id);
            const notes = sessionMaterials.filter((m) => m.type === 'note').map((m) => ({
                type: m.file_path ? 'file' : 'text',
                content: m.content || '',
                ...(m.file_path && { filePath: m.file_path, fileName: m.file_name || 'file' })
            }));
            const assignments = sessionMaterials.filter((m) => m.type === 'assignment').map((m) => ({
                type: m.file_path ? 'file' : 'text',
                content: m.content || '',
                isRequired: !!m.is_required,
                ...(m.file_path && { filePath: m.file_path, fileName: m.file_name || 'file' })
            }));

            const video = await adminService.createVideoWithId(
                videoId,
                title,
                'staging_placeholder',
                ownerId,
                lessonId,
                liveOrder,
                { storageProvider: useR2 ? 'r2' : 'local', r2Key: null, description: liveDesc, notes, assignments }
            );

            const stagingVideoDir = path.join(STAGING_DIR, video.id);
            if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
            if (!fs.existsSync(stagingVideoDir)) fs.mkdirSync(stagingVideoDir, { recursive: true });

            const inputPath = path.join(stagingVideoDir, 'input.webm');
            fs.writeFileSync(inputPath, req.file.buffer);

            await adminService.updateVideoStoragePath(video.id, stagingVideoDir);
            if (useR2) {
                const r2Prefix = r2Storage.getVideoKeyPrefix(ownerId, course.id, lessonId, video.id);
                await adminService.updateVideoR2(video.id, r2Prefix);
            }

            await adminService.createProcessingTask(ownerId, video.id, 'h264', ['360p', '720p', '1080p'], 28, false);

            const attendeeCount = await liveWatchService.getAttendeeCountBySession(videoId);
            await db.query(
                'UPDATE videos SET view_count = COALESCE(view_count, 0) + $1 WHERE id = $2',
                [attendeeCount, videoId]
            );

            await liveSessionService.markSaved(liveSession.id);

            res.status(201).json({
                message: 'Recording saved. It will be encrypted and processed like other lesson videos.',
                video_id: video.id,
                lesson_id: lessonId,
            });
        } catch (error) {
            console.error('Save live recording error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async streamLessonMedia(req, res) {
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
            } else if (ext === 'pdf') contentType = 'application/pdf';
            else if (ext === 'txt') contentType = 'text/plain';

            const stream = await r2Storage.getObjectStream(key);
            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'public, max-age=31536000');
            stream.pipe(res);
        } catch (error) {
            console.error('Stream lesson media error:', error);
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Media not found');
            }
            res.status(500).send('Internal server error');
        }
    }
}

module.exports = new LessonController();
