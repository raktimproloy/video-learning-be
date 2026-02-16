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
            WHERE (up.video_id IS NOT NULL) OR (ce.course_id IS NOT NULL)
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

    async getVideosByLesson(lessonId) {
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
        return result.rows;
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
