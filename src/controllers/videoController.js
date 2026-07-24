const videoService = require('../services/videoService');
const lessonService = require('../services/lessonService');
const courseService = require('../services/courseService');
const r2Storage = require('../services/r2StorageService');
const liveChatService = require('../services/liveChatService');

function contentTypeForPath(subpath) {
    if (subpath.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (subpath.endsWith('.ts')) return 'video/mp2t';
    return 'application/octet-stream';
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

            // Guest (no token): only preview videos are accessible
            if (!userId) {
                if (!video.is_preview) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                // Return safe minimal info for guests
                const guestResult = {
                    id: video.id,
                    title: video.title,
                    description: video.description,
                    duration_seconds: video.duration_seconds,
                    order: video.order,
                    lesson_id: video.lesson_id,
                    source_type: video.source_type,
                    notes: [],
                    assignments: [],
                    isPreview: true,
                    isLocked: false,
                    thumbnail_url: null,
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

            const result = { ...video };
            result.isPreview = result.is_preview ?? false;
            if (result.notes && typeof result.notes === 'string') {
                try { result.notes = JSON.parse(result.notes); } catch { result.notes = []; }
            }
            if (result.assignments && typeof result.assignments === 'string') {
                try { result.assignments = JSON.parse(result.assignments); } catch { result.assignments = []; }
            }

            // For students, check if video is locked
            if (role === 'student') {
                const enrolled = await videoService.checkPermission(userId, videoId);
                if (video.is_preview && !isOwnerOrManager && !enrolled) {
                    result.isLocked = false;
                } else {
                    result.isLocked = await videoService.isVideoLockedForStudent(userId, videoId);
                }
            }

            // Build thumbnail URL
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
            if (video.thumbnail_r2_key) {
                result.thumbnail_url = `${baseUrl}/v1/video/${videoId}/thumbnail`;
            } else {
                result.thumbnail_url = null;
            }

            res.json(result);
        } catch (error) {
            console.error('Get video details error:', error);
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
                console.log(`[DEBUG] listVideos: role=${role}, userId=${userId}, initial isOwner=${isOwner}`);
                if (lesson && !isOwner) {
                    const course = await courseService.getCourseByIdSimple(lesson.course_id);
                    console.log(`[DEBUG] listVideos: course.teacher_id=${course?.teacher_id}, userId=${userId}`);
                    isOwner = course && userId && course.teacher_id === userId;
                    if (userIdForLockCheck) {
                        const allLessons = await lessonService.getLessonsByCourse(lesson.course_id, userIdForLockCheck, course?.teacher_id);
                        const currentLesson = allLessons.find(l => l.id === lessonId);
                        lessonIsLocked = currentLesson?.isLocked === true;
                    }
                }
                console.log(`[DEBUG] listVideos: final isOwner=${isOwner}`);
                
                videos = await videoService.getVideosByLesson(lessonId, userIdForLockCheck, lessonIsLocked, isOwner);
                
                // If they are the owner, they should not be filtered as a student
                if (role === 'student' && !isOwner) {
                    videos = videos.filter(v => v.status !== 'processing' && v.status !== 'uploading');
                }
            } else if (role === 'teacher') {
                // Teacher sees videos they own
                videos = await videoService.getManagedVideos(userId);
            } else {
                // Student sees videos they have permission for
                videos = await videoService.getAvailableVideos(userId);
            }
            console.log(`listVideos: role=${role}, lessonId=${lessonId}, returned ${videos.length} videos`);
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
                res.set('Content-Type', 'application/octet-stream');
                return res.send(key);
            }

            // For students, check if video is locked before providing key
            if (role === 'student') {
                const isLocked = await videoService.isVideoLockedForStudent(userId, vid);
                if (isLocked) {
                    return res.status(403).send('Video is locked. Complete the required assignment from the previous video/lesson to unlock.');
                }
            }

            const key = await videoService.getVideoKey(userId, vid);
            res.set('Content-Type', 'application/octet-stream');
            res.send(key);
        } catch (error) {
            console.error('Error getting key:', error);
            if (error.message === 'Access denied') return res.status(403).send('No access');
            if (error.message === 'Key file not found') return res.status(404).send('Key not found');
            res.status(500).send('Internal server error');
        }
    }

    async streamSegment(req, res) {
        try {
            const videoId = req.params.videoId;
            const subpath = req.params.path || req.params[0] || 'master.m3u8';
            const userId = req.user?.id ?? null;
            const role = req.user?.role ?? 'guest';

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Video not found');
            if (video.storage_provider !== 'r2' || !video.r2_key || !r2Storage.isConfigured) {
                return res.status(404).send('Video not in R2');
            }

            // Guest: only preview videos allowed
            if (!userId) {
                if (!video.is_preview) return res.status(401).send('Authentication required');
            } else {
                const isOwnerOrManager = await videoService.isOwnerOrManager(userId, videoId);
                let hasAccess = isOwnerOrManager || await videoService.checkPermission(userId, videoId);
                if (!hasAccess && video.is_preview) hasAccess = true;
                if (!hasAccess) return res.status(403).send('Access denied');
                if (!isOwnerOrManager && video.status === 'inactive') return res.status(403).send('Access denied');

                // For students, check if video is locked
                if (role === 'student') {
                    const isLocked = await videoService.isVideoLockedForStudent(userId, videoId);
                    if (isLocked) {
                        return res.status(403).send('Video is locked. Complete the required assignment from the previous video/lesson to unlock.');
                    }
                }
            }

            const r2Key = `${video.r2_key}/${subpath}`;
            const stream = await r2Storage.getObjectStream(r2Key);
            res.set('Content-Type', contentTypeForPath(subpath));
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
            const userId = req.user.id;

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Not found');
            if (!video.thumbnail_r2_key) return res.status(404).send('No thumbnail');

            const isOwnerOrManager = await videoService.isOwnerOrManager(userId, videoId);
            let hasAccess = isOwnerOrManager || await videoService.checkPermission(userId, videoId);
            if (!hasAccess && video.is_preview) hasAccess = true;
            if (!hasAccess) return res.status(403).send('Access denied');

            const stream = await r2Storage.getObjectStream(video.thumbnail_r2_key);
            res.set('Content-Type', 'image/jpeg');
            res.set('Cache-Control', 'public, max-age=86400');
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
