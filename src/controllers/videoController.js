const videoService = require('../services/videoService');
const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');
const progressService = require('../services/progressService');
const r2Storage = require('../services/r2StorageService');
const hlsDeliveryService = require('../services/hlsDeliveryService');
const streamAuthCache = require('../services/streamAuthCache');
const videoDelivery = require('../config/videoDelivery');
const liveChatService = require('../services/liveChatService');
const db = require('../../db');
const { sanitizeNotes, sanitizeAssignments } = require('../utils/contentVisibility');

function contentTypeForPath(subpath) {
    if (subpath.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (subpath.endsWith('.ts')) return 'video/mp2t';
    return 'application/octet-stream';
}

function buildPublicBaseUrl(req) {
    let baseUrl = process.env.BASE_URL || process.env.API_URL;
    if (baseUrl) {
        return baseUrl.replace(/\/v1\/?$/, '');
    }
    let protocol = req.headers['x-forwarded-proto'] || req.protocol;
    if (typeof protocol === 'string' && protocol.includes(',')) protocol = protocol.split(',')[0].trim();
    let host = req.headers['x-forwarded-host'] || req.get('host');
    if (typeof host === 'string' && host.includes(',')) host = host.split(',')[0].trim();
    if (process.env.NODE_ENV === 'production' && host && !host.includes('localhost')) protocol = 'https';
    return `${protocol}://${host}`;
}

function extractAccessToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim() || null;
    }
    if (req.query && typeof req.query.token === 'string' && req.query.token) {
        return req.query.token;
    }
    return null;
}

/** Send body without Express ETag/304 — critical for HLS playlists and AES keys. */
function sendNoStore(res, body, contentType) {
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.removeHeader('ETag');
    return res.status(200).end(typeof body === 'string' ? body : body);
}

class VideoController {
    async getVideoDetails(req, res) {
        try {
            const { videoId } = req.params;
            const userId = req.user?.id ?? null;
            const role = req.user?.role ?? 'guest';

            const video = await videoService.getVideoById(videoId);
            if (!video) {
                return res.status(404).json({ error: 'Video not found' });
            }

            const rawNotes = (() => {
                if (!video.notes) return [];
                if (typeof video.notes === 'string') {
                    try { return JSON.parse(video.notes); } catch { return []; }
                }
                return Array.isArray(video.notes) ? video.notes : [];
            })();
            const rawAssignments = (() => {
                if (!video.assignments) return [];
                if (typeof video.assignments === 'string') {
                    try { return JSON.parse(video.assignments); } catch { return []; }
                }
                return Array.isArray(video.assignments) ? video.assignments : [];
            })();

            // Guest (no token): only preview videos are accessible
            if (!userId) {
                if (!video.is_preview) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                // Return safe minimal info for guests — public content full, private titles only
                const guestResult = {
                    id: video.id,
                    title: video.title,
                    description: video.description,
                    duration_seconds: video.duration_seconds,
                    order: video.order,
                    lesson_id: video.lesson_id,
                    source_type: video.source_type,
                    notes: sanitizeNotes(rawNotes, false),
                    assignments: sanitizeAssignments(rawAssignments, false),
                    isPreview: true,
                    isLocked: false,
                    thumbnail_url: (video.custom_thumbnail_r2_key || video.thumbnail_r2_key)
                        ? `${buildPublicBaseUrl(req)}/v1/video/${videoId}/thumbnail`
                        : null,
                };
                return res.json(guestResult);
            }

            const isOwnerOrManager = await videoService.isOwnerOrManager(userId, videoId);
            let hasPermission = isOwnerOrManager || await videoService.checkPermission(userId, videoId);
            if (!hasPermission && video.is_preview) {
                hasPermission = true;
            }
            if (!hasPermission) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const enrolled = isOwnerOrManager || await videoService.checkPermission(userId, videoId);
            const fullAccess = enrolled;

            const result = { ...video };
            result.isPreview = result.is_preview ?? false;
            result.notes = sanitizeNotes(rawNotes, fullAccess);
            result.assignments = sanitizeAssignments(rawAssignments, fullAccess);

            // For students, check if video is locked
            if (role === 'student') {
                if (video.is_preview && !isOwnerOrManager && !enrolled) {
                    result.isLocked = false;
                } else {
                    result.isLocked = await videoService.isVideoLockedForStudent(userId, videoId);
                }
            }

            // Build thumbnail URL (custom cover first, then auto first-frame)
            const baseUrl = buildPublicBaseUrl(req);
            if (video.custom_thumbnail_r2_key || video.thumbnail_r2_key) {
                result.thumbnail_url = `${baseUrl}/v1/video/${videoId}/thumbnail`;
            } else {
                result.thumbnail_url = null;
            }
            result.has_custom_thumbnail = !!video.custom_thumbnail_r2_key;

            res.json(result);
        } catch (error) {
            console.error('Get video details error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * GET /video/:videoId/watch-bootstrap
     * Single round-trip payload for watch page critical path (metadata + sign + resume + sidebar list).
     */
    async getWatchBootstrap(req, res) {
        try {
            const { videoId } = req.params;
            const userId = req.user?.id ?? null;
            const role = req.user?.role ?? 'guest';

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).json({ error: 'Video not found' });

            const rawNotes = (() => {
                if (!video.notes) return [];
                if (typeof video.notes === 'string') {
                    try { return JSON.parse(video.notes); } catch { return []; }
                }
                return Array.isArray(video.notes) ? video.notes : [];
            })();
            const rawAssignments = (() => {
                if (!video.assignments) return [];
                if (typeof video.assignments === 'string') {
                    try { return JSON.parse(video.assignments); } catch { return []; }
                }
                return Array.isArray(video.assignments) ? video.assignments : [];
            })();

            if (!userId && !video.is_preview) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const accessPromise = videoService.assertPlaybackAccess(userId, video, role).catch(e => ({ error: e }));
            const progressPromise = (userId && role !== 'reference')
                ? progressService.getVideoProgress(userId, videoId).catch(() => ({ lastPositionSeconds: 0, maxWatchedSeconds: 0 }))
                : Promise.resolve({ lastPositionSeconds: 0, maxWatchedSeconds: 0 });
            const lessonPromise = video.lesson_id
                ? lessonService.getLessonById(video.lesson_id).catch(() => null)
                : Promise.resolve(null);

            const [accessResult, progress, lesson] = await Promise.all([accessPromise, progressPromise, lessonPromise]);

            if (accessResult.error) {
                const msg = accessResult.error.message || 'Access denied';
                if (msg === 'Video not found') return res.status(404).json({ error: msg });
                if (!userId) return res.status(401).json({ error: 'Authentication required' });
                return res.status(403).json({ error: msg });
            }

            const access = accessResult;
            const { isOwnerOrManager, enrolled, isPreviewOnly, isLocked } = access;
            const fullAccess = isOwnerOrManager || enrolled;

            const baseUrl = buildPublicBaseUrl(req);
            
            const signUrlPromise = !isLocked 
                ? videoService.resolvePlaybackUrl(userId, video, baseUrl).catch(() => null)
                : Promise.resolve(null);

            let lessonVideosPromise = Promise.resolve([]);
            let lessonTitle = '';
            let courseId = null;

            if (lesson) {
                lessonTitle = lesson.title ?? 'Lesson';
                courseId = lesson.course_id ?? null;

                lessonVideosPromise = (async () => {
                    let lessonIsLocked = false;
                    let isOwner = role === 'teacher' || role === 'admin';
                    if (userId && !isOwner) {
                        const course = await courseService.getCourseByIdSimple(lesson.course_id).catch(() => null);
                        isOwner = !!(course && course.teacher_id === userId);
                        if (role === 'student') {
                            const allLessons = await lessonService.getLessonsByCourse(lesson.course_id, userId, course?.teacher_id).catch(() => []);
                            lessonIsLocked = allLessons.find((l) => l.id === video.lesson_id)?.isLocked === true;
                        }
                    }
                    const userIdForLockCheck = role === 'student' ? userId : null;
                    let lVideos = await videoService.getLessonVideoListItems(
                        video.lesson_id,
                        userIdForLockCheck,
                        lessonIsLocked,
                        isOwner
                    ).catch(() => []);
                    if (role === 'student' && !isOwner) {
                        lVideos = lVideos.filter((v) => v.status !== 'processing' && v.status !== 'uploading');
                    }
                    return lVideos;
                })();
            }

            const viewCountPromise = (userId && video.owner_id !== userId && !isPreviewOnly)
                ? db.query('UPDATE videos SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1', [videoId]).catch(() => {})
                : Promise.resolve();

            const [signUrl, lessonVideos] = await Promise.all([signUrlPromise, lessonVideosPromise, viewCountPromise]);

            res.json({
                video: {
                    id: video.id,
                    title: video.title,
                    description: video.description,
                    duration_seconds: video.duration_seconds,
                    order: video.order,
                    lesson_id: video.lesson_id,
                    source_type: video.source_type,
                    owner_id: video.owner_id,
                    notes: sanitizeNotes(rawNotes, fullAccess),
                    assignments: sanitizeAssignments(rawAssignments, fullAccess),
                    isPreview: video.is_preview ?? false,
                    isLocked,
                    thumbnail_url: (video.custom_thumbnail_r2_key || video.thumbnail_r2_key)
                        ? `${baseUrl}/v1/video/${videoId}/thumbnail`
                        : null,
                },
                signUrl,
                progress,
                lessonVideos,
                lessonTitle,
                courseId,
                isPreviewOnly,
            });
        } catch (error) {
            console.error('Watch bootstrap error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }


    async getLiveChat(req, res) {
        try {
            const { videoId } = req.params;
            const userId = req.user.id;

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).json({ error: 'Video not found' });
            if (video.source_type !== 'live') return res.status(400).json({ error: 'This video is not from a live session' });

            const isOwnerOrManager = await videoService.isOwnerOrManager(userId, videoId);
            let hasAccess = isOwnerOrManager || await videoService.checkPermission(userId, videoId);
            if (!hasAccess && video.is_preview) hasAccess = true;
            if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

            const lessonId = video.lesson_id;
            if (!lessonId) return res.status(400).json({ error: 'Video has no lesson' });

            const messages = await liveChatService.getMessages(lessonId, videoId, 500);
            res.json({ messages });
        } catch (error) {
            console.error('Get live chat error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async listVideos(req, res) {
        try {
            const userId = req.user.id;
            const role = req.user.role;
            const { lessonId } = req.query;

            let videos;

            if (lessonId) {
                // If filtering by lesson, check access or ownership
                // For now, if teacher -> check ownership of course/lesson (skipped for brevity, assuming UI handles it or strict middleware later)
                // If student -> check permissions (TODO: check if student has access to course)
                // For MVP, just return videos by lesson
                // Pass userId for students to check lock status
                const userIdForLockCheck = role === 'student' ? userId : null;
                let lessonIsLocked = false;
                
                // For students, check if the lesson itself is locked
                const lesson = await lessonService.getLessonById(lessonId);
                // Teachers and Admins always see all their videos; isOwner=true disables the status filter
                let isOwner = role === 'teacher' || role === 'admin';
                if (lesson && !isOwner) {
                    const course = await courseService.getCourseByIdSimple(lesson.course_id);
                    isOwner = course && userId && course.teacher_id === userId;
                    if (userIdForLockCheck) {
                        const allLessons = await lessonService.getLessonsByCourse(lesson.course_id, userIdForLockCheck, course?.teacher_id);
                        const currentLesson = allLessons.find(l => l.id === lessonId);
                        lessonIsLocked = currentLesson?.isLocked === true;
                    }
                }
                videos = await videoService.getLessonVideoListItems(lessonId, userIdForLockCheck, lessonIsLocked, isOwner);
                if (role === 'student' && !isOwner) {
                    videos = videos.filter(v => v.status !== 'processing' && v.status !== 'uploading');
                    // Strip private note/assignment bodies unless enrolled
                    let enrolled = false;
                    if (lesson) {
                        enrolled = await courseService.isEnrolled(userId, lesson.course_id);
                    }
                    if (!enrolled) {
                        const { sanitizeNotes, sanitizeAssignments } = require('../utils/contentVisibility');
                        videos = videos.map((v) => ({
                            ...v,
                            notes: sanitizeNotes(Array.isArray(v.notes) ? v.notes : [], false),
                            assignments: sanitizeAssignments(Array.isArray(v.assignments) ? v.assignments : [], false),
                        }));
                    }
                }
            } else if (role === 'teacher') {
                // Teacher sees videos they own
                videos = await videoService.getManagedVideos(userId);
            } else {
                // Student sees videos they have permission for
                videos = await videoService.getAvailableVideos(userId);
            }
            res.json(videos);
        } catch (error) {
            console.error('Error listing videos:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getSignedUrl(req, res) {
        try {
            const { videoId } = req.params;
            const userId = req.user?.id ?? null;

            // Guests can only get signed URL for preview videos
            if (!userId) {
                const video = await videoService.getVideoById(videoId);
                if (!video) return res.status(404).json({ error: 'Video not found' });
                if (!video.is_preview) return res.status(401).json({ error: 'Authentication required' });
            }

            let baseUrl = process.env.BASE_URL || process.env.API_URL;
            if (baseUrl) {
                baseUrl = baseUrl.replace(/\/v1\/?$/, '');
            } else {
                let protocol = req.headers['x-forwarded-proto'] || req.protocol;
                if (typeof protocol === 'string' && protocol.includes(',')) protocol = protocol.split(',')[0].trim();
                let host = req.headers['x-forwarded-host'] || req.get('host');
                if (typeof host === 'string' && host.includes(',')) host = host.split(',')[0].trim();
                if (process.env.NODE_ENV === 'production' && !host.includes('localhost')) protocol = 'https';
                baseUrl = `${protocol}://${host}`;
            }
            const signedUrl = await videoService.getSignedVideoUrl(userId, videoId, baseUrl);
            res.json({ url: signedUrl });
        } catch (error) {
            console.error('Error getting signed URL:', error);
            if (error.message === 'Access denied') {
                return res.status(403).json({ error: 'Access denied' });
            }
            if (error.message === 'Video not found') {
                return res.status(404).json({ error: 'Video not found' });
            }
            if (error.message && error.message.includes('Video is locked')) {
                return res.status(403).json({ error: error.message });
            }
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getKey(req, res) {
        try {
            if (req.authTokenInvalid) {
                return res.status(401).send('Authentication required');
            }

            const vid = req.query.vid || req.query.id;
            const userId = req.user?.id ?? null;
            const role = req.user?.role ?? 'guest';
            if (!vid) return res.status(400).json({ error: 'Missing video ID (vid or id)' });

            // For guests: only allow key for preview videos
            if (!userId) {
                const video = await videoService.getVideoById(vid);
                if (!video) return res.status(404).send('Video not found');
                if (!video.is_preview) return res.status(401).send('Authentication required');
                // Guest can get the key — skip straight to key retrieval
                const key = await videoService.getVideoKey(null, vid);
                return sendNoStore(res, key, 'application/octet-stream');
            }

            // For students, check if video is locked before providing key
            if (role === 'student') {
                const isLocked = await videoService.isVideoLockedForStudent(userId, vid);
                if (isLocked) {
                    return res.status(403).send('Video is locked. Complete the required assignment from the previous video/lesson to unlock.');
                }
            }

            const key = await videoService.getVideoKey(userId, vid);
            return sendNoStore(res, key, 'application/octet-stream');
        } catch (error) {
            console.error('Error getting key:', error);
            if (error.message === 'Access denied') return res.status(403).send('No access');
            if (error.message === 'Key file not found') return res.status(404).send('Key not found');
            res.status(500).send('Internal server error');
        }
    }

    async streamSegment(req, res) {
        try {
            if (req.authTokenInvalid) {
                return res.status(401).send('Authentication required');
            }

            const videoId = req.params.videoId;
            const subpath = req.params.path || req.params[0] || 'master.m3u8';
            const userId = req.user?.id ?? null;
            const role = req.user?.role ?? 'guest';

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Video not found');
            if (video.storage_provider !== 'r2' || !video.r2_key || !r2Storage.isConfigured) {
                return res.status(404).send('Video not in R2');
            }

            const auth = await streamAuthCache.authorizeStream(userId, role, video);
            if (!auth.allowed) {
                return res.status(auth.status || 403).send(auth.message || 'Access denied');
            }
            if (auth.isLocked) {
                return res.status(403).send('Video is locked. Complete the required assignment from the previous video/lesson to unlock.');
            }

            const r2Key = `${video.r2_key}/${subpath}`;
            const apiStreamBase = `${buildPublicBaseUrl(req)}/v1/video/${videoId}/stream`;
            const accessToken = extractAccessToken(req);

            // HLS playlists: proxy + rewrite key/child URLs (+ CDN/presign segments)
            if (subpath.endsWith('.m3u8')) {
                const body = await hlsDeliveryService.getPlaylistBody(
                    r2Key,
                    video.r2_key,
                    apiStreamBase,
                    subpath,
                    accessToken
                );
                return sendNoStore(res, body, contentTypeForPath(subpath));
            }

            // Segments: optional presign/CDN redirect (fallback to API proxy)
            if (subpath.endsWith('.ts') && videoDelivery.cdnSegmentDelivery !== 'off') {
                try {
                    const directUrl = await hlsDeliveryService.buildSegmentDeliveryUrl(r2Key);
                    if (directUrl) {
                        res.set('Cache-Control', 'private, max-age=60');
                        return res.redirect(302, directUrl);
                    }
                } catch (redirectErr) {
                    console.warn('[Stream] presign redirect failed, falling back to proxy:', redirectErr.message);
                }
            }

            const stream = await r2Storage.getObjectStream(r2Key);
            res.set('Content-Type', contentTypeForPath(subpath));
            if (subpath.endsWith('.ts')) {
                res.set('Cache-Control', 'private, max-age=300');
            }
            stream.pipe(res);
        } catch (error) {
            console.error('Stream error:', error);
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Not found');
            }
            res.status(500).send('Internal server error');
        }
    }

    async streamOriginal(req, res) {
        try {
            const { videoId } = req.params;
            const userId = req.user.id;

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Not found');
            if (!video.original_r2_key) return res.status(404).send('Original video not available');

            const isOwnerOrManager = await videoService.isOwnerOrManager(userId, videoId);
            if (!isOwnerOrManager) return res.status(403).send('Access denied. Only the owner or manager can view the original video.');

            const stream = await r2Storage.getObjectStream(video.original_r2_key);
            const ext = video.original_r2_key.split('.').pop()?.toLowerCase();
            const contentType = ext === 'webm' ? 'video/webm' : 'video/mp4';

            res.set('Content-Type', contentType);
            // Optionally, handle range requests properly if required by the player
            // But for simple streaming, returning the stream works.
            stream.pipe(res);
        } catch (error) {
            console.error('Stream original error:', error);
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Original file not found in storage');
            }
            res.status(500).send('Internal server error');
        }
    }

    async downloadOriginal(req, res) {
        try {
            const { videoId } = req.params;
            const userId = req.user.id;

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Not found');
            if (!video.original_r2_key) return res.status(404).send('Original video not available');

            const isOwnerOrManager = await videoService.isOwnerOrManager(userId, videoId);
            if (!isOwnerOrManager) return res.status(403).send('Access denied. Only the owner or manager can download the original video.');

            const stream = await r2Storage.getObjectStream(video.original_r2_key);
            const ext = video.original_r2_key.split('.').pop()?.toLowerCase() || 'mp4';
            const contentType = ext === 'webm' ? 'video/webm' : 'video/mp4';
            const filename = video.title ? `${video.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${ext}` : `original_video.${ext}`;

            res.set('Content-Type', contentType);
            res.set('Content-Disposition', `attachment; filename="${filename}"`);
            stream.pipe(res);
        } catch (error) {
            console.error('Download original error:', error);
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Original file not found in storage');
            }
            res.status(500).send('Internal server error');
        }
    }

    async streamVersionOriginal(req, res) {
        try {
            const { videoId, versionId } = req.params;
            const userId = req.user.id;

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Not found');

            const version = await videoService.getVideoVersionById(versionId, videoId);
            if (!version) return res.status(404).send('Version not found');
            if (!version.original_r2_key) return res.status(404).send('Original video not available for this version');

            const isOwnerOrManager = await videoService.isOwnerOrManager(userId, videoId);
            if (!isOwnerOrManager) return res.status(403).send('Access denied. Only the owner or manager can view the original video.');

            const stream = await r2Storage.getObjectStream(version.original_r2_key);
            const ext = version.original_r2_key.split('.').pop()?.toLowerCase();
            const contentType = ext === 'webm' ? 'video/webm' : 'video/mp4';

            res.set('Content-Type', contentType);
            stream.pipe(res);
        } catch (error) {
            console.error('Stream version original error:', error);
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Original file not found in storage');
            }
            res.status(500).send('Internal server error');
        }
    }

    async downloadVersionOriginal(req, res) {
        try {
            const { videoId, versionId } = req.params;
            const userId = req.user.id;

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Video not found');

            const version = await videoService.getVideoVersionById(versionId, videoId);
            if (!version) return res.status(404).send('Version not found');
            if (!version.original_r2_key) return res.status(404).send('Original video not available for this version');

            const isOwnerOrManager = await videoService.isOwnerOrManager(userId, videoId);
            if (!isOwnerOrManager) return res.status(403).send('Access denied. Only the owner or manager can download the original video.');

            const stream = await r2Storage.getObjectStream(version.original_r2_key);
            const ext = version.original_r2_key.split('.').pop()?.toLowerCase() || 'mp4';
            const contentType = ext === 'webm' ? 'video/webm' : 'video/mp4';
            const titleSafe = video.title ? video.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'video';
            const filename = `${titleSafe}_v${version.version_number}.${ext}`;

            res.set('Content-Type', contentType);
            res.set('Content-Disposition', `attachment; filename="${filename}"`);
            stream.pipe(res);
        } catch (error) {
            console.error('Download version original error:', error);
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Original file not found in storage');
            }
            res.status(500).send('Internal server error');
        }
    }

    async getThumbnail(req, res) {
        try {
            const { videoId } = req.params;
            const userId = req.user?.id ?? null;

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Not found');

            const thumbKey = video.custom_thumbnail_r2_key || video.thumbnail_r2_key;
            if (!thumbKey) return res.status(404).send('No thumbnail');

            const allowed = await videoService.canAccessThumbnail(userId, video);
            if (!allowed) {
                return userId
                    ? res.status(403).send('Access denied')
                    : res.status(401).send('Authentication required');
            }

            const stream = await r2Storage.getObjectStream(thumbKey);
            const lower = String(thumbKey).toLowerCase();
            const contentType = lower.endsWith('.png')
                ? 'image/png'
                : lower.endsWith('.webp')
                    ? 'image/webp'
                    : lower.endsWith('.gif')
                        ? 'image/gif'
                        : 'image/jpeg';
            res.set('Content-Type', contentType);
            res.set('ETag', `"${Buffer.from(String(thumbKey)).toString('base64url')}"`);
            res.set(
                'Cache-Control',
                video.custom_thumbnail_r2_key
                    ? 'private, no-cache, must-revalidate'
                    : 'public, max-age=86400'
            );
            stream.pipe(res);
        } catch (error) {
            if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
                return res.status(404).send('Not found');
            }
            console.error('Get thumbnail error:', error);
            res.status(500).send('Internal server error');
        }
    }
}

module.exports = new VideoController();
