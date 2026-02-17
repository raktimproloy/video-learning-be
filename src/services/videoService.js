const db = require('../../db');
const fs = require('fs');
const path = require('path');
const r2Storage = require('./r2StorageService');

const KEYS_ROOT_DIR = process.env.KEYS_ROOT_DIR || path.join(__dirname, '../../keys');

class VideoService {
    /**
     * Checks if a user has permission to access a video.
     */
    async checkPermission(userId, videoId) {
        // Check direct video permission
        const directPermission = await db.query(
            'SELECT 1 FROM user_permissions WHERE user_id=$1 AND video_id=$2 AND expires_at > NOW()',
            [userId, videoId]
        );
        if (directPermission.rows.length > 0) return true;

        // Check course enrollment permission
        const courseEnrollment = await db.query(
            `SELECT 1 
             FROM course_enrollments ce
             JOIN lessons l ON ce.course_id = l.course_id
             JOIN videos v ON l.id = v.lesson_id
             WHERE ce.user_id = $1 AND v.id = $2`,
            [userId, videoId]
        );
        return courseEnrollment.rows.length > 0;
    }

    /**
     * Retrieves video details by ID.
     */
    async getVideoById(videoId) {
        const result = await db.query(
            'SELECT * FROM videos WHERE id=$1',
            [videoId]
        );
        return result.rows[0];
    }

    /**
     * Retrieves all videos with access status for a user (Student View).
     * Excludes videos with status 'processing'.
     */
    async getAvailableVideos(userId) {
        const query = `
            SELECT DISTINCT
                v.id, 
                v.title, 
                true as has_access
            FROM videos v
            LEFT JOIN user_permissions up ON v.id = up.video_id AND up.user_id = $1 AND up.expires_at > NOW()
            LEFT JOIN lessons l ON v.lesson_id = l.id
            LEFT JOIN course_enrollments ce ON l.course_id = ce.course_id AND ce.user_id = $1
            WHERE ((up.video_id IS NOT NULL) OR (ce.course_id IS NOT NULL))
            AND (v.status IS NULL OR v.status != 'processing')
            ORDER BY v.title ASC
        `;
        const result = await db.query(query, [userId]);
        return result.rows;
    }

    /**
     * Retrieves videos uploaded by a specific owner (Teacher View).
     */
    async getManagedVideos(ownerId) {
        const query = `
            SELECT 
                v.id, 
                v.title, 
                v.created_at,
                v.size_bytes,
                (SELECT COUNT(*) FROM user_permissions up WHERE up.video_id = v.id AND up.expires_at > NOW()) as student_count
            FROM videos v
            WHERE v.owner_id = $1
            ORDER BY v.created_at DESC
        `;
        const result = await db.query(query, [ownerId]);
        return result.rows;
    }

    async getVideosByLesson(lessonId, userId = null, lessonIsLocked = false) {
        const query = `
            SELECT 
                v.*,
                (
                    SELECT status 
                    FROM video_processing_tasks 
                    WHERE video_id = v.id 
                    ORDER BY created_at DESC 
                    LIMIT 1
                ) as processing_status
            FROM videos v
            WHERE v.lesson_id = $1 
            ORDER BY v."order" ASC, v.created_at ASC
        `;
        const result = await db.query(query, [lessonId]);
        const videos = result.rows.map((row) => ({
            ...row,
            isPreview: row.is_preview ?? false,
            // Use video status if available, otherwise fall back to processing_status
            status: row.status || (row.processing_status && row.processing_status !== 'completed' ? 'processing' : 'active'),
        }));

        // If lesson is locked, lock all videos
        if (lessonIsLocked) {
            return videos.map((video) => ({
                ...video,
                isLocked: true
            }));
        }

        // If userId is provided, check lock status for each video
        if (userId) {
            const assignmentService = require('./assignmentService');
            const videosWithLockStatus = [];
            for (let i = 0; i < videos.length; i++) {
                const video = videos[i];
                let isLocked = false;
                
                // First video is never locked
                if (i > 0) {
                    // Check ALL previous videos - if any previous video has required assignments not completed, lock this video
                    for (let j = 0; j < i; j++) {
                        const previousVideo = videos[j];
                        const completed = await assignmentService.hasCompletedVideoAssignments(userId, previousVideo.id);
                        if (!completed) {
                            isLocked = true;
                            break; // Once we find one locked video, this one is locked
                        }
                    }
                }
                
                videosWithLockStatus.push({
                    ...video,
                    isLocked
                });
            }
            return videosWithLockStatus;
        }
        
        return videos;
    }

    /**
     * Check if a video is locked for a student (based on previous video/lesson assignments).
     */
    async isVideoLockedForStudent(userId, videoId) {
        const video = await this.getVideoById(videoId);
        if (!video || !video.lesson_id) return false;

        const assignmentService = require('./assignmentService');
        const lessonService = require('./lessonService');
        
        // Get lesson info
        const lesson = await lessonService.getLessonById(video.lesson_id);
        if (!lesson) return false;

        // Check if lesson itself is locked
        const allLessons = await lessonService.getLessonsByCourse(lesson.course_id, userId);
        const currentLesson = allLessons.find(l => l.id === lesson.id);
        if (currentLesson?.isLocked === true) {
            return true;
        }

        // Check if video is locked within the lesson
        const videos = await this.getVideosByLesson(video.lesson_id, userId, false);
        const currentVideo = videos.find(v => v.id === videoId);
        return currentVideo?.isLocked === true;
    }

    /**
     * Generates a signed URL for the video manifest (.m3u8).
     */
    async getSignedVideoUrl(userId, videoId) {
        const video = await this.getVideoById(videoId);
        if (!video) {
            throw new Error('Video not found');
        }

        // Check access: User must be owner OR have permission
        let hasAccess = false;
        if (video.owner_id === userId) {
            hasAccess = true;
        } else {
            hasAccess = await this.checkPermission(userId, videoId);
        }

        if (!hasAccess) {
            throw new Error('Access denied');
        }

        // For students, check if video is locked
        const userRole = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userRole.rows.length > 0 && userRole.rows[0].role === 'student') {
            const isLocked = await this.isVideoLockedForStudent(userId, videoId);
            if (isLocked) {
                throw new Error('Video is locked. Complete the required assignment from the previous video/lesson to unlock.');
            }
        }

        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        if (video.storage_provider === 'r2' && video.r2_key && r2Storage.isConfigured) {
            return `${baseUrl}/v1/video/${video.id}/stream/master.m3u8`;
        }
        return `${baseUrl}/videos/${video.id}/master.m3u8`;
    }

    /**
     * Retrieves the raw encryption key for a video.
     */
    async getVideoKey(userId, videoId) {
        // Check access: User must be owner OR have permission
        const video = await this.getVideoById(videoId);
        if (!video) {
             throw new Error('Video not found');
        }

        let hasAccess = false;
        if (video.owner_id === userId) {
            hasAccess = true;
        } else {
            hasAccess = await this.checkPermission(userId, videoId);
        }

        if (!hasAccess) {
            throw new Error('Access denied');
        }

        // Construct path to the key file
        // e.g., KEYS_ROOT_DIR/<videoId>/enc.key
        const keyPath = path.join(KEYS_ROOT_DIR, videoId, 'enc.key');

        if (!fs.existsSync(keyPath)) {
            throw new Error('Key file not found');
        }

        return fs.readFileSync(keyPath);
    }
}

module.exports = new VideoService();
