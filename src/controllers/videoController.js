const videoService = require('../services/videoService');
const lessonService = require('../services/lessonService');
const r2Storage = require('../services/r2StorageService');

function contentTypeForPath(subpath) {
    if (subpath.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (subpath.endsWith('.ts')) return 'video/mp2t';
    return 'application/octet-stream';
}

class VideoController {
    async getVideoDetails(req, res) {
        try {
            const { videoId } = req.params;
            const userId = req.user.id;
            const role = req.user.role;

            const video = await videoService.getVideoById(videoId);
            if (!video) {
                return res.status(404).json({ error: 'Video not found' });
            }

            const isOwner = video.owner_id === userId;
            let hasPermission = isOwner || await videoService.checkPermission(userId, videoId);
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
                if (video.is_preview && !isOwner && !enrolled) {
                    result.isLocked = false;
                } else {
                    result.isLocked = await videoService.isVideoLockedForStudent(userId, videoId);
                }
            }

            res.json(result);
        } catch (error) {
            console.error('Get video details error:', error);
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
                if (userIdForLockCheck) {
                    const lesson = await lessonService.getLessonById(lessonId);
                    if (lesson) {
                        // Get all lessons in the course to check if this lesson is locked
                        const allLessons = await lessonService.getLessonsByCourse(lesson.course_id, userIdForLockCheck);
                        const currentLesson = allLessons.find(l => l.id === lessonId);
                        lessonIsLocked = currentLesson?.isLocked === true;
                    }
                }
                
                videos = await videoService.getVideosByLesson(lessonId, userIdForLockCheck, lessonIsLocked);
                // Filter out processing videos for students
                if (role === 'student') {
                    videos = videos.filter(v => v.status !== 'processing');
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
            const userId = req.user.id; // From authMiddleware

            const signedUrl = await videoService.getSignedVideoUrl(userId, videoId);
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
            const userId = req.user.id;
            const role = req.user.role;
            if (!vid) return res.status(400).json({ error: 'Missing video ID (vid or id)' });
            
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
            const userId = req.user.id;
            const role = req.user.role;

            const video = await videoService.getVideoById(videoId);
            if (!video) return res.status(404).send('Video not found');
            if (video.storage_provider !== 'r2' || !video.r2_key || !r2Storage.isConfigured) {
                return res.status(404).send('Video not in R2');
            }

            let hasAccess = video.owner_id === userId || await videoService.checkPermission(userId, videoId);
            if (!hasAccess && video.is_preview) hasAccess = true;
            if (!hasAccess) return res.status(403).send('Access denied');

            // For students, check if video is locked
            if (role === 'student') {
                const isLocked = await videoService.isVideoLockedForStudent(userId, videoId);
                if (isLocked) {
                    return res.status(403).send('Video is locked. Complete the required assignment from the previous video/lesson to unlock.');
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
}

module.exports = new VideoController();
