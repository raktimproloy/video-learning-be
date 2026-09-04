const db = require('../../db');
const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');
const liveChatService = require('../services/liveChatService');
const liveMaterialService = require('../services/liveMaterialService');
const liveExamService = require('../services/liveExamService');
const liveWatchService = require('../services/liveWatchService');
const liveExamSubmissionService = require('../services/liveExamSubmissionService');
const liveSessionService = require('../services/liveSessionService');
const { isImage, compressImage } = require('../utils/imageCompress');
const videoService = require('../services/videoService');
const agoraService = require('../services/agoraService');
const adminService = require('../services/adminService');
const adminSettingsService = require('../services/adminSettingsService');
const liveUsageService = require('../services/liveUsageService');
const userService = require('../services/userService');
const awsIvsService = require('../services/awsIvsService');
const hundredMsService = require('../services/hundredMsService');
const streamVideoService = require('../services/streamVideoService');
const liveIngestService = require('../services/liveIngestService');
const r2LiveStorage = require('../services/r2LiveStorageService');
const liveMediamtxProxyService = require('../services/liveMediamtxProxyService');
const hlsDeliveryService = require('../services/hlsDeliveryService');
const liveStreamCache = require('../services/liveStreamCacheService');
const liveAccessService = require('../services/liveAccessService');
const liveCdnDeliveryService = require('../services/liveCdnDeliveryService');
const liveDiagnosticsService = require('../services/liveDiagnosticsService');
const liveStatsBroadcast = require('../services/liveStatsBroadcastService');
const liveDelivery = require('../config/liveDelivery');
const ttlCache = require('../utils/ttlCache');
const r2Storage = require('../services/r2StorageService');
const { getAllowedOrigin } = require('../config/cors');
const fs = require('fs');
const path = require('path');

function workspaceTeacherId(req) {
    return req.effectiveTeacherId || req.user.id;
}

/** HLS playlist + segment URLs rewritten for browser (same-origin proxy avoids CORS). */
function getLivePlaylistApiBase(req, lessonId) {
    let origin = getAllowedOrigin(req.headers.origin);
    if (!origin) {
        const ref = String(req.headers.referer || req.headers.referrer || '');
        const match = ref.match(/^(https?:\/\/[^/]+)/i);
        if (match) origin = getAllowedOrigin(match[1]);
    }
    if (!origin) {
        const fwdHost = req.headers['x-forwarded-host'];
        const fwdProto = req.headers['x-forwarded-proto'] || 'http';
        if (fwdHost) {
            const candidate = getAllowedOrigin(`${fwdProto}://${String(fwdHost).split(',')[0].trim()}`);
            if (candidate) origin = candidate;
        }
    }
    if (origin) {
        return `${origin}/api-backend/lessons/${lessonId}/live/playlist`;
    }
    const frontend = process.env.FRONTEND_URL ? String(process.env.FRONTEND_URL).replace(/\/$/, '') : null;
    if (frontend && process.env.NODE_ENV === 'production') {
        return `${frontend}/api-backend/lessons/${lessonId}/live/playlist`;
    }
    const base = String(process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
    return `${base}/v1/lessons/${lessonId}/live/playlist`;
}

function isTeacherWorkspaceUser(req) {
    return req.user?.role === 'teacher' || req.user?.role === 'teacher_staff';
}

const STAGING_DIR = path.resolve(__dirname, '../../staging');
const UPLOADS_LESSONS = path.resolve(__dirname, '../../uploads/lessons');

/** Return live credentials for the given provider (agora | stream | 100ms | aws_ivs | youtube | r2_live). */
async function getLiveCredsForProvider(provider, channelName, uid, role, opts = {}) {
    if (provider === 'agora') {
        return agoraService.generateRtcToken(channelName, uid, role);
    }
    if (provider === 'stream') {
        return streamVideoService.getCredentials(channelName, uid, role);
    }
    if (provider === '100ms') {
        return hundredMsService.getCredentials(channelName, uid, role);
    }
    if (provider === 'aws_ivs') {
        return awsIvsService.getCredentials(channelName, uid, role);
    }
    if (provider === 'r2_live') {
        if (!opts.liveSessionId) return null;
        const baseUrl = process.env.BASE_URL || '';
        return liveIngestService.getCredentials(channelName, opts.liveSessionId, uid, role, baseUrl);
    }
    if (provider === 'youtube') {
        return null; // YouTube: not implemented; configure and add YouTube Live API if needed
    }
    return null;
}

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
    notes = (Array.isArray(notes) ? notes : []).map((n) => ({
        ...n,
        title: n.title != null ? String(n.title) : '',
        isPublic: n.isPublic === true || n.is_public === true,
    }));
    assignments = (Array.isArray(assignments) ? assignments : []).map((a) => ({
        ...a,
        isPublic: a.isPublic === true || a.is_public === true,
        isRequired: a.isRequired === true || a.is_required === true,
    }));
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
        if (noteFiles[i]) {
            const f = noteFiles[i];
            let buffer = f.buffer || (f.path ? fs.readFileSync(f.path) : null);
            if (buffer && isImage(f.originalname)) buffer = await compressImage(buffer, f.originalname, true);
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
        if (assignmentFiles[i]) {
            const f = assignmentFiles[i];
            let buffer = f.buffer || (f.path ? fs.readFileSync(f.path) : null);
            if (buffer && isImage(f.originalname)) buffer = await compressImage(buffer, f.originalname, true);
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
            if (!isTeacherWorkspaceUser(req)) {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { courseId, title, description, order, isPreview, status: reqStatus } = req.body;
            const { notes, assignments } = parseNotesAndAssignments(req.body);

            const ownerId = workspaceTeacherId(req);
            const course = await courseService.getCourseById(courseId, ownerId);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== ownerId) return res.status(403).json({ error: 'Not authorized' });

            const lessonData = {
                title: (title || '').trim(),
                description: (description || '').trim(),
                order: parseInt(order, 10) || 0,
                isPreview: isPreview === 'true' || isPreview === true,
                notes,
                assignments,
                status: reqStatus === 'active' ? 'active' : undefined,
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
                ownerId
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
            const isOwner = course && req.user?.id && course.teacher_id === workspaceTeacherId(req);
            const userId = req.user?.role === 'student' ? req.user.id : null;
            const videos = await videoService.getVideosByLesson(lessonId, userId, false, isOwner, { enrichPlayback: true });
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
            const { sanitizeNotes, sanitizeAssignments } = require('../utils/contentVisibility');
            let fullAccess = true;
            if (req.user?.role === 'student') {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                const isOwner = false;
                fullAccess = enrolled || isOwner;
            } else if (req.user?.role === 'teacher' || req.user?.role === 'teacher_staff') {
                fullAccess = true;
            } else if (!req.user) {
                fullAccess = false;
            }
            const out = { ...lesson };
            out.notes = sanitizeNotes(Array.isArray(lesson.notes) ? lesson.notes : [], fullAccess);
            out.assignments = sanitizeAssignments(Array.isArray(lesson.assignments) ? lesson.assignments : [], fullAccess);
            res.json(out);
        } catch (error) {
            console.error('Get lesson error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async updateLesson(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { title, description, order, isPreview, status } = req.body;
            const { notes, assignments } = parseNotesAndAssignments(req.body);

            const existingLesson = await lessonService.getLessonById(req.params.id);
            if (!existingLesson) return res.status(404).json({ error: 'Lesson not found' });

            const ownerId = workspaceTeacherId(req);
            const course = await courseService.getCourseById(existingLesson.course_id, ownerId);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== ownerId) return res.status(403).json({ error: 'Not authorized' });

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
                    ownerId
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
            if (status !== undefined) {
                const allowed = ['draft', 'active', 'inactive'];
                if (!allowed.includes(String(status))) {
                    return res.status(400).json({ error: 'Invalid status. Use: draft, active, or inactive.' });
                }
                lessonData.status = status;
            }

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
            if (!isTeacherWorkspaceUser(req)) {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const lessons = await lessonService.getTeacherLiveLessons(workspaceTeacherId(req));
            res.json(lessons);
        } catch (error) {
            console.error('Get teacher live lessons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async setLiveAndGetToken(req, res) {
        try {
            const { id } = req.params;
            const rawLive = req.body.is_live;
            const is_live = rawLive === true || rawLive === 'true' ? true : rawLive === false || rawLive === 'false' ? false : undefined;
            if (is_live === undefined) {
                return res.status(400).json({ error: 'is_live (boolean) is required' });
            }
            const lesson = await lessonService.getLessonById(id);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });

            if (req.user.role === 'teacher') {
                const currentUser = await userService.findById(req.user.id);
                if (!currentUser) return res.status(404).json({ error: 'User not found' });

                const liveSettings = await adminSettingsService.getLiveSettings() || {
                    liveClassEnabled: true,
                    agoraEnabled: true,
                    streamEnabled: false,
                    hundredMsEnabled: true,
                    awsIvsEnabled: false,
                    youtubeEnabled: false,
                    r2LiveEnabled: false,
                };

                if (!liveSettings.liveClassEnabled && !currentUser.core_member) {
                    return res.status(403).json({ error: 'Live is available for Core Members only.' });
                }

                if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
                if (is_live === true) {
                    if (!course.has_live_class) {
                        return res.status(403).json({
                            error: 'This course does not have live class enabled. Request to enable it from the course page or course settings.',
                            code: 'LIVE_NOT_ENABLED_FOR_COURSE',
                        });
                    }
                    // Auto-select provider: use first enabled service with free minutes; else AWS IVS (fallback).
                    let { provider } = await liveUsageService.getProviderWithFreeMinutes(liveSettings);
                    if (provider === 'agora' && !liveSettings.agoraEnabled) provider = null;
                    else if (provider === 'stream' && !liveSettings.streamEnabled) provider = null;
                    else if (provider === '100ms' && !liveSettings.hundredMsEnabled) provider = null;
                    else if (provider === 'aws_ivs' && !liveSettings.awsIvsEnabled) provider = null;
                    else if (provider === 'youtube' && !liveSettings.youtubeEnabled) provider = null;
                    else if (provider === 'r2_live' && !liveSettings.r2LiveEnabled) provider = null;
                    if (!provider) {
                        if (liveSettings.r2LiveEnabled) provider = 'r2_live';
                        else if (liveSettings.agoraEnabled) provider = 'agora';
                        else if (liveSettings.streamEnabled) provider = 'stream';
                        else if (liveSettings.hundredMsEnabled) provider = '100ms';
                        else if (liveSettings.youtubeEnabled) provider = 'youtube';
                        else if (liveSettings.awsIvsEnabled) provider = 'aws_ivs';
                    }
                    if (!provider) {
                        return res.status(503).json({ error: 'No live provider is enabled. Enable at least one (Agora, 100ms, etc.) in admin settings.' });
                    }
                    const { live_name, live_order, live_description } = req.body || {};
                    const liveOrder = live_order != null ? parseInt(live_order, 10) : 0;
                    const liveName = (live_name && String(live_name).trim()) ? String(live_name).trim() : (lesson.title || 'Live');
                    // End any existing active session for this lesson so each "Go Live" creates a fresh session
                    await liveSessionService.endDiscarded(id);
                    const liveSession = await liveSessionService.create(id, lesson.course_id, req.user.id, {
                        liveName: liveName || lesson.title,
                        liveOrder,
                        liveDescription: (live_description && String(live_description).trim()) || null,
                        provider,
                    });
                    const sessionData = {
                        live_session_name: liveName,
                        live_session_order: liveOrder,
                        live_session_description: (live_description && String(live_description).trim()) || null,
                        current_live_session_id: liveSession.id
                    };
                    const updatedLesson = await lessonService.updateLiveStatus(id, true, sessionData);
                    const uid = Math.abs(req.user.id.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)) % 2147483647;
                    const role = req.user.role === 'teacher' ? 'publisher' : 'subscriber';
                    let creds = await getLiveCredsForProvider(provider, id, uid, role, { liveSessionId: liveSession.id });
                    let effectiveProvider = provider;
                    if (!creds) {
                        const tryOrder = ['r2_live', 'agora', 'stream', '100ms', 'youtube', 'aws_ivs'].filter(p =>
                            (p === 'r2_live' && liveSettings.r2LiveEnabled) ||
                            (p === 'agora' && liveSettings.agoraEnabled) ||
                            (p === 'stream' && liveSettings.streamEnabled) ||
                            (p === '100ms' && liveSettings.hundredMsEnabled) ||
                            (p === 'youtube' && liveSettings.youtubeEnabled) ||
                            (p === 'aws_ivs' && liveSettings.awsIvsEnabled)
                        );
                        for (const p of tryOrder) {
                            creds = await getLiveCredsForProvider(p, id, uid, role, { liveSessionId: liveSession.id });
                            if (creds) { effectiveProvider = p; break; }
                        }
                    }
                    if (!creds) {
                        return res.status(503).json({ error: 'No live provider is configured. Set credentials (e.g. AGORA_APP_ID and AGORA_APP_CERTIFICATE) in backend .env for at least one provider.' });
                    }
                    if (effectiveProvider !== provider) {
                        await liveSessionService.updateProvider(liveSession.id, effectiveProvider);
                    }
                    return res.json({ ...creds, provider: effectiveProvider, lesson: updatedLesson || lesson, is_live: true, live_session_id: liveSession.id });
                }
                if (is_live === false) {
                    await liveSessionService.endDiscarded(id);
                    await lessonService.updateLiveStatus(id, false, {});
                    return res.json({ is_live: false, lesson });
                }
            }
            return res.status(403).json({ error: 'Only teachers can start or stop live sessions' });
        } catch (error) {
            console.error('Set live error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveToken(req, res) {
        try {
            const { id } = req.params;
            const currentUser = await userService.findById(req.user.id);
            if (!currentUser) return res.status(404).json({ error: 'User not found' });
            const userRole = currentUser.role || req.user.role;

            const lesson = await lessonService.getLessonById(id);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });

            const liveSettings = await adminSettingsService.getLiveSettings() || {
                liveClassEnabled: true,
                agoraEnabled: true,
                streamEnabled: false,
                hundredMsEnabled: true,
                awsIvsEnabled: false,
                youtubeEnabled: false,
                r2LiveEnabled: false,
            };

            if (!liveSettings.liveClassEnabled && !currentUser.core_member) {
                return res.status(403).json({ error: 'Live is available for Core Members only.' });
            }
            const activeSession = await liveSessionService.getActiveByLesson(id);
            const provider = (activeSession?.provider && liveUsageService.PROVIDERS.includes(activeSession.provider))
                ? activeSession.provider : 'agora';
            const providerEnabled = (p) =>
                (p === 'agora' && liveSettings.agoraEnabled) ||
                (p === 'stream' && liveSettings.streamEnabled) ||
                (p === '100ms' && liveSettings.hundredMsEnabled) ||
                (p === 'aws_ivs' && liveSettings.awsIvsEnabled) ||
                (p === 'youtube' && liveSettings.youtubeEnabled) ||
                (p === 'r2_live' && liveSettings.r2LiveEnabled);
            if (!providerEnabled(provider)) {
                return res.status(503).json({ error: `${provider} live service is currently disabled.` });
            }

            const uid = Math.abs(req.user.id.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)) % 2147483647;
            const role = userRole === 'teacher' ? 'publisher' : 'subscriber';
            if (userRole === 'teacher' && course.teacher_id !== workspaceTeacherId(req)) {
                return res.status(403).json({ error: 'Not authorized' });
            }
            if (userRole === 'student') {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Purchase this course to watch the live stream.' });
                if (!lesson.is_live) return res.status(404).json({ error: 'This lesson is not live.' });
            }
            const creds = await getLiveCredsForProvider(provider, id, uid, role, {
                liveSessionId: activeSession?.id || lesson.current_live_session_id,
            });
            if (!creds) return res.status(503).json({ error: `${provider} is not configured.` });
            return res.json({ ...creds, provider });
        } catch (error) {
            console.error('Get live token error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveChat(req, res) {
        try {
            const lessonId = req.params.id;
            const { liveSessionId: querySessionId } = req.query;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = isTeacherWorkspaceUser(req) && course.teacher_id === workspaceTeacherId(req);
            const isStudent = req.user.role === 'student';
            if (isStudent) {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) return res.status(403).json({ error: 'Access denied' });
            const liveSessionId = querySessionId && String(querySessionId).trim()
                ? String(querySessionId).trim()
                : (lesson.current_live_session_id || null);
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
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = isTeacherWorkspaceUser(req) && course.teacher_id === workspaceTeacherId(req);
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

    async getLiveExams(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = isTeacherWorkspaceUser(req) && course.teacher_id === workspaceTeacherId(req);
            const isStudent = req.user.role === 'student';
            const onlyPublished = isStudent;
            const { liveSessionId: querySessionId } = req.query;
            const liveSessionId = (querySessionId && String(querySessionId).trim()) || lesson.current_live_session_id || null;
            const includeUnbound = false;
            if (isStudent) {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) return res.status(403).json({ error: 'Access denied' });
            const exams = await liveExamService.listByLesson(lessonId, { onlyPublished, liveSessionId, includeUnbound });
            // For students, never send correct answers (correctOptionId); include published_at, visibility_countdown_seconds, my_submission
            if (isStudent) {
                const sanitized = await Promise.all(exams.map(async (ex) => {
                    const mySubmission = await liveExamSubmissionService.getMySubmission(ex.id, req.user.id);
                    return {
                        ...ex,
                        published_at: ex.published_at || null,
                        visibility_countdown_seconds: ex.visibility_countdown_seconds != null ? ex.visibility_countdown_seconds : 10,
                        my_submission: mySubmission || null,
                        questions: Array.isArray(ex.questions)
                            ? ex.questions.map((q) => ({
                                id: q.id,
                                text: q.text,
                                options: Array.isArray(q.options)
                                    ? q.options.map((o) => ({
                                        id: o.id,
                                        label: o.label,
                                        value: o.value,
                                    }))
                                    : [],
                              }))
                            : [],
                    };
                }));
                return res.json({ exams: sanitized });
            }
            res.json({ exams });
        } catch (error) {
            console.error('Get live exams error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async saveLiveExam(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const { examId, title, timeLimitMinutes, questions } = req.body || {};
            let exam;
            if (examId) {
                exam = await liveExamService.update(
                    lessonId,
                    examId,
                    req.user.id,
                    { title, timeLimitMinutes, questions: questions || [] },
                );
            } else {
                exam = await liveExamService.create(
                    lessonId,
                    req.user.id,
                    {
                        title,
                        timeLimitMinutes,
                        questions: questions || [],
                        liveSessionId: lesson.current_live_session_id || null,
                    },
                );
            }
            res.json({ exam });
            try {
                const getIo = require('../socket').getIo;
                getIo().to(lessonId).emit('liveExamsUpdated');
            } catch (_) {}
        } catch (error) {
            console.error('Save live exam error:', error);
            const msg = error.message || 'Internal server error';
            if (msg === 'Cannot edit published exam') {
                return res.status(403).json({ error: msg });
            }
            res.status(500).json({ error: msg });
        }
    }

    async setLiveExamStatus(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const { examId } = req.params;
            const { status } = req.body || {};
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const exam = await liveExamService.setStatus(lessonId, examId, req.user.id, status);
            res.json({ exam });
            try {
                const getIo = require('../socket').getIo;
                getIo().to(lessonId).emit('liveExamsUpdated');
            } catch (_) {}
        } catch (error) {
            console.error('Set live exam status error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async submitLiveExam(req, res) {
        try {
            if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
            const lessonId = req.params.id;
            const { examId } = req.params;
            const { answers, timeTakenMs } = req.body || {};

            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
            if (!enrolled) return res.status(403).json({ error: 'Access denied' });

            const result = await liveExamSubmissionService.createSubmission(
                lessonId,
                examId,
                req.user.id,
                { answers, timeTakenMs },
            );
            res.status(201).json(result);
            try {
                const getIo = require('../socket').getIo;
                getIo().to(lessonId).emit('liveExamLeaderboardUpdated', { examId });
            } catch (_) {}
        } catch (error) {
            console.error('Submit live exam error:', error);
            const msg = error.message || 'Internal server error';
            if (msg === 'Already submitted' || msg === 'Exam has ended') {
                return res.status(400).json({ error: msg });
            }
            res.status(500).json({ error: msg });
        }
    }

    async getLiveExamLeaderboard(req, res) {
        try {
            const lessonId = req.params.id;
            const { examId } = req.params;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = isTeacherWorkspaceUser(req) && course.teacher_id === workspaceTeacherId(req);
            const isStudent = req.user.role === 'student';
            if (isStudent) {
                const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
                if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            } else if (!isTeacher) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const leaderboard = await liveExamSubmissionService.getLeaderboard(lessonId, examId);
            res.json({ leaderboard });
        } catch (error) {
            console.error('Get live exam leaderboard error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async getLiveStartedAt(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const isTeacher = isTeacherWorkspaceUser(req) && course.teacher_id === workspaceTeacherId(req);
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
            const access = await liveAccessService.resolveLiveAccess(req, lessonId);
            if (!access.ok) return res.status(access.status).json({ error: access.error });

            const sessionId = access.lesson.current_live_session_id || 'none';
            const payload = await ttlCache.getOrSet(
                `liveStats:${lessonId}:${sessionId}`,
                liveDelivery.liveStatsCacheMs,
                async () => {
                    const { lesson, teacherId } = access;
                    const live_session_id = lesson.current_live_session_id || null;
                    const live_started_at = await lessonService.getLiveStartedAt(lessonId);
                    const viewerCount = await ttlCache.getOrSet(
                        `liveViewers:${lessonId}:${live_session_id || 'none'}`,
                        liveDelivery.viewerCountCacheMs,
                        () => liveWatchService.getViewerCount(lessonId, teacherId, live_session_id)
                    );
                    let broadcast_status = 'ended';
                    let live_name = null;
                    let live_description = null;
                    let hls_ready_at = null;
                    let cdn_ready = false;
                    let playback_ready = false;
                    if (live_session_id) {
                        const session = await liveSessionService.getById(live_session_id);
                        broadcast_status = session?.broadcast_status || 'starting';
                        live_name = session?.live_name ?? null;
                        live_description = session?.live_description ?? null;
                        if (session?.provider === 'r2_live') {
                            hls_ready_at = session.hls_ready_at || null;
                            const readiness = await liveCdnDeliveryService.getPlaybackReadiness(session);
                            cdn_ready = readiness.cdn_ready;
                            playback_ready = readiness.playback_ready;
                        }
                    }
                    let hold_back_seconds = liveDelivery.holdBackTargetSeconds;
                    if (live_session_id) {
                        const timing = await liveCdnDeliveryService.getSessionTiming(live_session_id);
                        if (timing?.holdBackSeconds) hold_back_seconds = timing.holdBackSeconds;
                    }
                    return {
                        live_started_at,
                        viewerCount,
                        live_session_id,
                        broadcast_status,
                        live_name,
                        live_description,
                        hls_ready_at,
                        cdn_ready,
                        playback_ready,
                        hold_back_seconds,
                        client_start_buffer_seconds: liveDelivery.clientStartBufferSeconds,
                    };
                }
            );
            // Never cache live stats in browser/CDN while waiting for playback (304 kept playback_ready stale).
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.set('Pragma', 'no-cache');
            res.json(payload);
        } catch (error) {
            console.error('Get live stats error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async updateLiveSession(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
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
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const { broadcast_status } = req.body || {};
            if (!['live', 'paused', 'ended'].includes(broadcast_status)) {
                return res.status(400).json({ error: 'broadcast_status must be live, paused, or ended' });
            }
            const updated = await liveSessionService.setBroadcastStatus(lessonId, broadcast_status);
            if (!updated) {
                return res.status(400).json({ error: 'No active live session for this lesson.' });
            }
            if (broadcast_status === 'live') {
                await lessonService.setLiveBroadcastStartedAt(lessonId);
                // Push notification is sent when session is created (setLiveAndGetToken / quick-action "Start Live Stream"), not here.
            }
            const live_session_id = updated.id;
            const live_started_at = await lessonService.getLiveStartedAt(lessonId);
            const viewerCount = await liveWatchService.getViewerCount(lessonId, course.teacher_id, live_session_id);
            const live_name = updated.live_name ?? null;
            const live_description = updated.live_description ?? null;
            try {
                liveStatsBroadcast.broadcastLiveStats(lessonId, {
                    broadcast_status,
                    live_started_at,
                    viewerCount,
                    live_session_id,
                    live_name,
                    live_description,
                }, { force: true });
            } catch (_) {}
            res.json({ broadcast_status });
        } catch (error) {
            console.error('Set broadcast status error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /** Teacher reports that the live time limit was reached; backend will force-end after grace period if not stopped. */
    async reportLimitReached(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const session = await liveSessionService.setLimitReachedAt(lessonId);
            if (!session) return res.status(400).json({ error: 'No active live session for this lesson.' });
            res.status(200).json({ ok: true });
        } catch (error) {
            console.error('Report limit reached error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getLiveViewers(req, res) {
        try {
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (!isTeacherWorkspaceUser(req) || course.teacher_id !== workspaceTeacherId(req)) {
                return res.status(403).json({ error: 'Access denied' });
            }
            const watchers = await liveWatchService.getWatchers(lessonId);
            const live_session_id = lesson.current_live_session_id || null;
            const viewerCount = await liveWatchService.getViewerCount(lessonId, course.teacher_id, live_session_id);
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
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            const enrolled = await courseService.isEnrolled(req.user.id, lesson.course_id);
            if (!enrolled) return res.status(403).json({ error: 'Access denied' });
            if (!lesson.is_live) return res.status(400).json({ error: 'Lesson is not live' });
            const liveSessionId = lesson.current_live_session_id || null;
            await liveWatchService.join(lessonId, req.user.id, liveSessionId);
            const viewerCount = await liveWatchService.getViewerCount(lessonId, course.teacher_id, liveSessionId);
            const live_started_at = await lessonService.getLiveStartedAt(lessonId);
            let broadcast_status = 'ended';
            let live_name = null;
            let live_description = null;
            if (liveSessionId) {
                const session = await liveSessionService.getById(liveSessionId);
                broadcast_status = session?.broadcast_status || 'starting';
                live_name = session?.live_name ?? null;
                live_description = session?.live_description ?? null;
            }
            try {
                liveStatsBroadcast.broadcastLiveStats(lessonId, {
                    broadcast_status,
                    live_started_at,
                    viewerCount,
                    live_session_id: liveSessionId,
                    live_name,
                    live_description,
                }, { force: true });
            } catch (_) {}
            res.json({
                ok: true,
                viewerCount,
                broadcast_status,
                live_started_at,
                live_session_id: liveSessionId,
                live_name,
                live_description,
            });
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
            const lesson = await lessonService.getLessonById(lessonId);
            const course = lesson ? await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role) : null;
            const teacherId = course?.teacher_id || null;
            const live_session_id = lesson?.current_live_session_id || null;
            const viewerCount = teacherId ? await liveWatchService.getViewerCount(lessonId, teacherId, live_session_id) : 0;
            let broadcast_status = 'ended';
            let live_started_at = null;
            let live_name = null;
            let live_description = null;
            if (live_session_id) {
                const session = await liveSessionService.getById(live_session_id);
                broadcast_status = session?.broadcast_status || 'starting';
                live_name = session?.live_name ?? null;
                live_description = session?.live_description ?? null;
                live_started_at = await lessonService.getLiveStartedAt(lessonId);
            }
            try {
                liveStatsBroadcast.broadcastLiveStats(lessonId, {
                    broadcast_status,
                    live_started_at,
                    viewerCount,
                    live_session_id,
                    live_name,
                    live_description,
                }, { force: true });
            } catch (_) {}
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
            await liveWatchService.heartbeat(lessonId, req.user.id);
            const access = await liveAccessService.resolveLiveAccess(req, lessonId);
            if (!access.ok) return res.status(access.status).json({ error: access.error });
            const live_session_id = access.lesson?.current_live_session_id || null;
            const viewerCount = await ttlCache.getOrSet(
                `liveViewers:${lessonId}:${live_session_id || 'none'}`,
                liveDelivery.viewerCountCacheMs,
                () => liveWatchService.getViewerCount(lessonId, access.teacherId, live_session_id)
            );
            res.json({ ok: true, viewerCount });
        } catch (error) {
            console.error('Live watch heartbeat error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async addLiveNote(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const content = (req.body && req.body.content) || '';
            const file = req.files?.file?.[0];
            let filePath = null, fileName = null;
            if (file && (file.buffer || file.path)) {
                const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
                if (buffer && r2Storage.isConfigured && r2Storage.uploadLessonMedia) {
                    const r2Key = await r2Storage.uploadLessonMedia(req.user.id, lesson.course_id, lessonId, buffer, file.originalname || 'file', 'notes');
                    filePath = r2Key;
                    fileName = file.originalname || 'file';
                } else if (buffer) {
                    const dir = path.join(UPLOADS_LESSONS, lessonId, 'live_notes');
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    const ext = path.extname(file.originalname || '') || '.bin';
                    const fname = `note-${Date.now()}${ext}`;
                    const fullPath = path.join(dir, fname);
                    fs.writeFileSync(fullPath, buffer);
                    filePath = `/uploads/lessons/${lessonId}/live_notes/${fname}`;
                    fileName = file.originalname || 'file';
                }
            } else if (req.body && req.body.existing_file_path) {
                // Allow reusing an already-uploaded file (e.g. from pre-live step)
                filePath = String(req.body.existing_file_path);
                fileName = (req.body.existing_file_name && String(req.body.existing_file_name)) || 'file';
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
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
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
                } else if (buffer) {
                    const dir = path.join(UPLOADS_LESSONS, lessonId, 'live_assignments');
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    const ext = path.extname(file.originalname || '') || '.bin';
                    const fname = `assignment-${Date.now()}${ext}`;
                    const fullPath = path.join(dir, fname);
                    fs.writeFileSync(fullPath, buffer);
                    filePath = `/uploads/lessons/${lessonId}/live_assignments/${fname}`;
                    fileName = file.originalname || 'file';
                }
            } else if (req.body && req.body.existing_file_path) {
                // Allow reusing an already-uploaded file (e.g. from pre-live step)
                filePath = String(req.body.existing_file_path);
                fileName = (req.body.existing_file_name && String(req.body.existing_file_name)) || 'file';
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

    /**
     * Pre-live upload helper for notes: upload file to R2/local and return the path,
     * but DO NOT create any live_materials row yet.
     */
    async uploadPreliveNoteFile(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const file = req.files?.file?.[0];
            if (!file || (!file.buffer && !file.path)) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
            if (!buffer) {
                return res.status(400).json({ error: 'Invalid file' });
            }
            let filePath, fileName;
            if (r2Storage.isConfigured && r2Storage.uploadLessonMedia) {
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
            return res.status(201).json({ filePath, fileName });
        } catch (error) {
            console.error('Upload prelive note file error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    /**
     * Pre-live upload helper for assignments: upload file to R2/local and return the path,
     * but DO NOT create any live_materials row yet.
     */
    async uploadPreliveAssignmentFile(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) return res.status(403).json({ error: 'Teachers only' });
            const lessonId = req.params.id;
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });
            const file = req.files?.file?.[0];
            if (!file || (!file.buffer && !file.path)) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
            if (!buffer) {
                return res.status(400).json({ error: 'Invalid file' });
            }
            let filePath, fileName;
            if (r2Storage.isConfigured && r2Storage.uploadLessonMedia) {
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
            return res.status(201).json({ filePath, fileName });
        } catch (error) {
            console.error('Upload prelive assignment file error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async reorderLessons(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { courseId, orderedIds } = req.body;
            if (!courseId || !Array.isArray(orderedIds)) {
                return res.status(400).json({ error: 'Invalid input' });
            }
            
            const ownerId = workspaceTeacherId(req);
            const course = await courseService.getCourseById(courseId, ownerId);
            if (!course || course.teacher_id !== ownerId) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            await lessonService.reorderLessons(courseId, orderedIds);
            res.json({ message: 'Lessons reordered successfully' });
        } catch (error) {
            console.error('Reorder lessons error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async reorderVideos(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const { lessonId, orderedIds } = req.body;
            if (!lessonId || !Array.isArray(orderedIds)) {
                return res.status(400).json({ error: 'Invalid input' });
            }
            
            const ownerId = workspaceTeacherId(req);
            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
            
            const course = await courseService.getCourseById(lesson.course_id, ownerId);
            if (!course || course.teacher_id !== ownerId) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            await lessonService.reorderVideosInLesson(lessonId, orderedIds);
            res.json({ message: 'Videos reordered successfully' });
        } catch (error) {
            console.error('Reorder videos error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async deleteLesson(req, res) {
        try {
            if (!isTeacherWorkspaceUser(req)) {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const existingLesson = await lessonService.getLessonById(req.params.id);
            if (!existingLesson) return res.status(404).json({ error: 'Lesson not found' });

            // Load course in owner-aware mode so teacher can see inactive/draft courses too
            const course = await courseService.getCourseById(existingLesson.course_id, req.user.id);
            if (!course) {
                return res.status(404).json({ error: 'Course not found' });
            }
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized' });

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
            if (!isTeacherWorkspaceUser(req)) {
                return res.status(403).json({ error: 'Access denied. Teachers only.' });
            }
            const lessonId = req.params.id;

            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

            const course = await courseService.getCourseById(lesson.course_id, req.user?.id, req.user?.role);
            if (!course) return res.status(404).json({ error: 'Course not found' });
            if (course.teacher_id !== workspaceTeacherId(req)) return res.status(403).json({ error: 'Not authorized to save recording for this lesson.' });

            const liveSession = await liveSessionService.getActiveByLesson(lessonId);
            if (!liveSession) {
                return res.status(400).json({ error: 'No active live session found. Start a live stream and record before saving.' });
            }

            const isR2Live = liveSession.provider === 'r2_live';

            if (!isR2Live) {
                if (!req.file || (!req.file.buffer && !req.file.path)) {
                    return res.status(400).json({ error: 'No recording file uploaded.' });
                }
                const sizeBytes = req.file.buffer ? req.file.buffer.length : (req.file.size || 0);
                if (sizeBytes < 1000) {
                    return res.status(400).json({ error: 'Recording is too short or invalid. Record for at least a few seconds before saving.' });
                }
            } else if (!r2Storage.isConfigured) {
                return res.status(503).json({ error: 'R2 storage is not configured for live save.' });
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

            const stagingVideoDir = path.join(STAGING_DIR, videoId);
            const r2Prefix = useR2 ? r2Storage.getVideoKeyPrefix(ownerId, course.id, lessonId, videoId) : null;
            let liveSourcePrefix = null;

            // r2_live: flush segments into live+recording prefixes, stop uploaders, finalize recording only.
            // Live sliding-window playlists under live/sessions/ are never rewritten here.
            if (isR2Live && useR2) {
                const liveSegmentUploader = require('../worker/liveSegmentUploader');
                liveSourcePrefix = r2LiveStorage.getLiveRecordingPrefix(liveSession.id);
                try {
                    if (liveSession.ingest_stream_key) {
                        await liveSegmentUploader.processSession({
                            id: liveSession.id,
                            lesson_id: liveSession.lesson_id,
                            ingest_stream_key: liveSession.ingest_stream_key,
                            hls_ready_at: liveSession.hls_ready_at,
                        });
                    }
                } catch (flushErr) {
                    console.warn('[saveLiveRecording] final flush failed:', flushErr.message);
                }
                // Verify append-only recording has media BEFORE ending the live session.
                // SRS writes seg-N.ts at recording root; legacy MediaMTX wrote under 720p/.
                const recKeysRoot = await r2Storage.listObjects(`${liveSourcePrefix}/`);
                const recKeys720 = await r2Storage.listObjects(`${liveSourcePrefix}/720p/`);
                const hasRecMedia = [...recKeysRoot, ...recKeys720].some(
                  (k) =>
                    /\/seg-\d+\.ts$/i.test(k) ||
                    /_video\d+_seg\d+\.(mp4|m4s|ts)$/i.test(k) ||
                    /\.ts$/i.test(k)
                );
                if (!hasRecMedia) {
                    return res.status(400).json({
                        error: 'No live HLS recording found. Stream for a few seconds before saving.',
                        code: 'no_recording',
                    });
                }
                await liveSessionService.markSaved(liveSession.id);
                await new Promise((r) => setTimeout(r, 800));
                const finalized = await liveSegmentUploader.finalizeSessionRecording(liveSession.id);
                if (!finalized.ok) {
                    return res.status(400).json({
                        error: 'No live HLS recording found. Stream for a few seconds before saving.',
                        code: finalized.reason || 'no_recording',
                    });
                }
                if (finalized.prefix) liveSourcePrefix = finalized.prefix;
            }

            const video = await adminService.createVideoWithId(
                videoId,
                title,
                isR2Live && useR2 ? 'r2_live' : (useR2 ? 'r2_staging' : stagingVideoDir),
                ownerId,
                lessonId,
                liveOrder,
                { storageProvider: useR2 ? 'r2' : 'local', r2Key: isR2Live && useR2 ? r2Prefix : null, description: liveDesc, notes, assignments }
            );

            if (isR2Live && useR2) {
                // Encrypt from append-only recording prefix; keep until encrypt succeeds.
                await adminService.updateVideoR2(video.id, r2Prefix);
                await adminService.createProcessingTask(
                    ownerId,
                    video.id,
                    'h264',
                    ['720p'],
                    28,
                    false,
                    'live_hls_encrypt',
                    liveSourcePrefix
                );
            } else if (useR2) {
                const r2StagingKey = `${r2Prefix}/staging/input.webm`;
                if (req.file.buffer) {
                    await r2Storage.uploadFile(r2StagingKey, req.file.buffer, 'video/webm');
                } else {
                    await r2Storage.uploadFromPath(req.file.path, r2StagingKey, 'video/webm');
                }
                await adminService.updateVideoR2(video.id, r2Prefix);
                await adminService.createProcessingTask(ownerId, video.id, 'h264', ['360p', '720p', '1080p'], 28, false);
            } else {
                if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
                if (!fs.existsSync(stagingVideoDir)) fs.mkdirSync(stagingVideoDir, { recursive: true });
                const dest = path.join(stagingVideoDir, 'input.webm');
                if (req.file.buffer) {
                    fs.writeFileSync(dest, req.file.buffer);
                } else {
                    fs.copyFileSync(req.file.path, dest);
                }
                await adminService.createProcessingTask(ownerId, video.id, 'h264', ['360p', '720p', '1080p'], 28, false);
            }

            if (req.file?.path) {
                try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
            }

            const attendeeCount = await liveWatchService.getAttendeeCountBySession(videoId);
            await db.query(
                'UPDATE videos SET view_count = COALESCE(view_count, 0) + $1 WHERE id = $2',
                [attendeeCount, videoId]
            );

            if (!(isR2Live && useR2)) {
                await liveSessionService.markSaved(liveSession.id);
            }

            // Mark lesson as no longer live and clear current_live_session_id.
            await lessonService.updateLiveStatus(lessonId, false, {});

            res.status(201).json({
                message: isR2Live
                    ? 'Live recording saved. Encrypting HLS and preparing VOD...'
                    : 'Recording saved. It will be encrypted and processed like other lesson videos.',
                video_id: video.id,
                lesson_id: lessonId,
            });
        } catch (error) {
            console.error('Save live recording error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    /** GET live HLS playlist for r2_live provider (JWT + enrollment). */
    async getLivePlaylist(req, res) {
        try {
            const lessonId = req.params.id;
            const access = await liveAccessService.resolveLiveAccess(req, lessonId, {
                requireActiveSession: true,
                provider: 'r2_live',
            });
            if (!access.ok) return res.status(access.status).json({ error: access.error });

            const { activeSession, isTeacher } = access;
            const apiBase = getLivePlaylistApiBase(req, lessonId);
            const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token || null;
            const pathName = activeSession.ingest_stream_key
                ? r2LiveStorage.getMediamtxPathName(activeSession.ingest_stream_key)
                : null;
            const useCdn = await liveCdnDeliveryService.shouldServeViaCdn(activeSession);
            const r2Prefix = r2LiveStorage.getLiveSessionPrefix(activeSession.id);
            const isActiveLive = activeSession.status === 'active' && !!pathName;
            const studentR2Only = liveDelivery.studentR2Only && !isTeacher && req.query.preview !== '1';

            const subpath = (req.query.subpath && String(req.query.subpath)) || 'master.m3u8';
            const safeSub = subpath.replace(/\.\./g, '').replace(/^\/+/, '');
            const r2Key = `${r2Prefix}/${safeSub}`;

            // Students: R2/CDN only — never MediaMTX cold-start (stable smooth playback).
            if (studentR2Only && isActiveLive && !useCdn) {
                if (safeSub.endsWith('.m3u8') || liveMediamtxProxyService.isSegmentResource(safeSub) || req.query.mtx) {
                    return res.status(404).json({
                        error: 'Live stream is preparing. Please wait a moment.',
                        code: 'LIVE_WARMING_UP',
                    });
                }
            }

            // MediaMTX passthrough — teacher preview or legacy cold start only.
            if (req.query.mtx && pathName && !useCdn && !studentR2Only) {
                const resource = liveMediamtxProxyService.sanitizeResource(String(req.query.mtx));
                try {
                    if (liveMediamtxProxyService.isSegmentResource(resource)) {
                        const seg = await liveMediamtxProxyService.getSegmentBody(pathName, resource);
                        res.set('Content-Type', seg.contentType);
                        res.set('Cache-Control', 'no-store');
                        return res.send(seg.body);
                    }
                    const body = await liveMediamtxProxyService.getPlaylistBody(pathName, resource, apiBase, accessToken);
                    res.set('Content-Type', 'application/vnd.apple.mpegurl');
                    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
                    return res.send(body);
                } catch (_) {
                    return res.status(404).json({ error: 'Live stream is not ready yet.' });
                }
            }

            // CDN scale path (YouTube/FB model): playlists via API, segments at CDN edge.
            if (useCdn) {
                if (req.query.mtx && liveMediamtxProxyService.isSegmentResource(String(req.query.mtx))) {
                    const mtxName = liveMediamtxProxyService.sanitizeResource(String(req.query.mtx));
                    const file = mtxName.includes('/') ? mtxName.split('/').pop() : mtxName;
                    const segKey = `${r2Prefix}/720p/${file}`;
                    const cdnUrl = await liveCdnDeliveryService.getCdnRedirectForSegment(segKey);
                    if (cdnUrl) return res.redirect(302, cdnUrl);
                }

                if (safeSub.endsWith('.m3u8') && await r2Storage.objectExists(r2Key)) {
                    const body = await liveCdnDeliveryService.getLivePlaylistFromR2(
                        r2Key, r2Prefix, safeSub, apiBase, accessToken
                    );
                    res.set('Content-Type', 'application/vnd.apple.mpegurl');
                    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
                    liveDiagnosticsService.append({
                        type: 'playlist_served',
                        lessonId,
                        sessionId: activeSession.id,
                        data: {
                            source: 'r2',
                            file: safeSub,
                            segCount: body.split('\n').filter((l) => {
                                const t = l.trim();
                                return t && !t.startsWith('#');
                            }).length,
                            segmentDelivery: liveDelivery.useLocalSegmentProxy ? 'proxy' : 'cdn',
                        },
                    });
                    return res.send(body);
                }

                if (liveMediamtxProxyService.isSegmentResource(safeSub)) {
                    if (liveDelivery.useLocalSegmentProxy && await r2Storage.objectExists(r2Key)) {
                        const stream = await r2Storage.getObjectStream(r2Key);
                        res.set('Content-Type', liveMediamtxProxyService.contentTypeForResource(safeSub));
                        res.set('Cache-Control', 'public, max-age=120, immutable');
                        res.set('Access-Control-Allow-Origin', '*');
                        return stream.pipe(res);
                    }
                    const cdnUrl = await liveCdnDeliveryService.getCdnRedirectForSegment(r2Key);
                    if (cdnUrl) return res.redirect(302, cdnUrl);
                }
            }

            // R2 mirror ready but CDN edge not yet — serve playlists via API proxy (transition, non-student only).
            if (!studentR2Only && isActiveLive && activeSession.hls_ready_at && safeSub.endsWith('.m3u8') && await r2Storage.objectExists(r2Key)) {
                const body = await hlsDeliveryService.getPlaylistBody(
                    r2Key, r2Prefix, apiBase, safeSub, accessToken, { livePlaylist: true }
                );
                res.set('Content-Type', 'application/vnd.apple.mpegurl');
                res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
                return res.send(body);
            }

            // Cold start: MediaMTX origin (teacher preview / legacy only).
            if (!studentR2Only && isActiveLive && safeSub === 'master.m3u8') {
                try {
                    const body = await liveMediamtxProxyService.getPlaylistBody(
                        pathName, liveMediamtxProxyService.MASTER_RESOURCE, apiBase, accessToken
                    );
                    res.set('Content-Type', 'application/vnd.apple.mpegurl');
                    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
                    return res.send(body);
                } catch (_) {
                    return res.status(404).json({ error: 'Playlist not ready yet.' });
                }
            }

            if (liveMediamtxProxyService.isSegmentResource(safeSub)) {
                if (!isActiveLive && await r2Storage.objectExists(r2Key)) {
                    const stream = await r2Storage.getObjectStream(r2Key);
                    res.set('Content-Type', liveMediamtxProxyService.contentTypeForResource(safeSub));
                    res.set('Cache-Control', 'no-store');
                    return stream.pipe(res);
                }
                if (isActiveLive && !studentR2Only) {
                    const mtxName = safeSub.includes('/') ? safeSub.split('/').pop() : safeSub;
                    try {
                        const seg = await liveMediamtxProxyService.getSegmentBody(pathName, mtxName);
                        res.set('Content-Type', seg.contentType);
                        res.set('Cache-Control', 'no-store');
                        return res.send(seg.body);
                    } catch (_) {
                        return res.status(404).json({ error: 'Segment not ready yet.' });
                    }
                }
                if (studentR2Only && isActiveLive) {
                    return res.status(404).json({
                        error: 'Live stream is preparing. Please wait a moment.',
                        code: 'LIVE_WARMING_UP',
                    });
                }
                return res.status(404).json({ error: 'Segment not ready yet.' });
            }

            if (!isActiveLive && await r2Storage.objectExists(r2Key)) {
                const body = await hlsDeliveryService.getPlaylistBody(r2Key, r2Prefix, apiBase, safeSub, accessToken, { livePlaylist: true });
                res.set('Content-Type', 'application/vnd.apple.mpegurl');
                res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
                return res.send(body);
            }

            if (pathName && safeSub === 'master.m3u8') {
                try {
                    const body = await liveMediamtxProxyService.getPlaylistBody(
                        pathName, liveMediamtxProxyService.MASTER_RESOURCE, apiBase, accessToken
                    );
                    res.set('Content-Type', 'application/vnd.apple.mpegurl');
                    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
                    return res.send(body);
                } catch (_) {
                    return res.status(404).json({ error: 'Playlist not ready yet.' });
                }
            }

            return res.status(404).json({ error: 'Playlist not ready yet.' });
        } catch (error) {
            console.error('Get live playlist error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /** POST client playback / teacher telemetry for R2 live debugging. */
    async postLiveDiag(req, res) {
        try {
            const lessonId = req.params.id;
            const access = await liveAccessService.resolveLiveAccess(req, lessonId);
            if (!access.ok) return res.status(access.status).json({ error: access.error });

            const body = req.body || {};
            const sessionId = access.lesson.current_live_session_id || body.sessionId || null;
            const role = access.isTeacher ? 'teacher' : 'student';

            liveDiagnosticsService.append({
                type: body.type || 'playback_sample',
                lessonId,
                sessionId,
                role,
                message: body.message,
                data: {
                    ...body,
                    uid: req.user?.id,
                },
            });

            return res.json({ ok: true });
        } catch (error) {
            console.error('Post live diag error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    /** GET diagnostics report for active live session (teacher / enrolled student). */
    async getLiveDiag(req, res) {
        try {
            const lessonId = req.params.id;
            const access = await liveAccessService.resolveLiveAccess(req, lessonId);
            if (!access.ok) return res.status(access.status).json({ error: access.error });

            const sessionId = access.lesson.current_live_session_id || req.query.sessionId || null;
            const report = liveDiagnosticsService.getSessionReport(lessonId, sessionId);
            res.set('Cache-Control', 'no-store');
            return res.json(report);
        } catch (error) {
            console.error('Get live diag error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    /** GET global diagnostics (internal — secret query param). */
    async getLiveDiagInternal(req, res) {
        try {
            const secret = req.query.secret || req.headers['x-live-diag-secret'];
            const expected = process.env.LIVE_DIAG_SECRET || liveDelivery.ingestAuthSecret;
            if (!secret || secret !== expected) {
                return res.status(401).json({ error: 'unauthorized' });
            }
            const lessonId = req.query.lessonId || null;
            const sessionId = req.query.sessionId || null;
            const report = lessonId || sessionId
                ? liveDiagnosticsService.getSessionReport(lessonId, sessionId)
                : liveDiagnosticsService.getGlobalReport();
            res.set('Cache-Control', 'no-store');
            return res.json(report);
        } catch (error) {
            console.error('Get live diag internal error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    /** POST internal MediaMTX ingest auth hook. */
    async liveIngestAuth(req, res) {
        try {
            const result = await liveIngestService.validateIngestAuth(req.body || {}, req.headers);
            if (!result.ok) {
                return res.status(401).json({ error: result.reason || 'unauthorized' });
            }
            return res.status(200).json({ ok: true });
        } catch (error) {
            console.error('Live ingest auth error:', error);
            return res.status(401).json({ error: 'unauthorized' });
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
