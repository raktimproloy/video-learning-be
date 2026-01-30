const db = require('../../db');
const fs = require('fs');
const path = require('path');
const { generateSecurePath } = require('../utils/nginxSigner');

// Root directory where keys are stored. 
// In production, this might be /var/www/keys
// We'll fallback to a local 'keys' folder for dev
const KEYS_ROOT_DIR = process.env.KEYS_ROOT_DIR || path.join(__dirname, '../../keys');

class VideoService {
    /**
     * Checks if a user has permission to access a video.
     */
    async checkPermission(userId, videoId) {
        const result = await db.query(
            'SELECT 1 FROM user_permissions WHERE user_id=$1 AND video_id=$2 AND expires_at > NOW()',
            [userId, videoId]
        );
        return result.rows.length > 0;
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
            SELECT 
                v.id, 
                v.title, 
                true as has_access
            FROM videos v
            JOIN user_permissions up ON v.id = up.video_id
            WHERE up.user_id = $1 AND up.expires_at > NOW()
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

        // Construct public URL
        // We serve 'public/videos' at '/videos' endpoint
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const manifestUrl = `${baseUrl}/videos/${video.id}/master.m3u8`;
        
        // Return the direct URL. 
        // We are skipping Nginx secure link generation for this implementation 
        // as we are using Express static serving.
        // The protection relies on the Key encryption.
        return manifestUrl;
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
