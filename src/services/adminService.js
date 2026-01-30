const db = require('../../db');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_ROOT_DIR = process.env.KEYS_ROOT_DIR || path.join(__dirname, '../../keys');

class AdminService {
    async createVideo(title, storagePath, ownerId) {
        const signingSecret = crypto.randomBytes(32).toString('hex');
        
        const result = await db.query(
            'INSERT INTO videos (title, storage_path, signing_secret, owner_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, storagePath, signingSecret, ownerId]
        );
        
        const video = result.rows[0];

        // Generate and save encryption key
        try {
            const keyDir = path.join(KEYS_ROOT_DIR, video.id);
            if (!fs.existsSync(keyDir)) {
                fs.mkdirSync(keyDir, { recursive: true });
            }
            const keyPath = path.join(keyDir, 'enc.key');
            const key = crypto.randomBytes(16); // 128-bit key
            fs.writeFileSync(keyPath, key);
            console.log(`Generated key for video ${video.id} at ${keyPath}`);
        } catch (err) {
            console.error('Failed to generate key file:', err);
        }

        return video;
    }

    async updateVideoStoragePath(videoId, newPath) {
        const result = await db.query(
            'UPDATE videos SET storage_path = $1 WHERE id = $2 RETURNING *',
            [newPath, videoId]
        );
        return result.rows[0];
    }

    async grantPermission(userId, videoId, expiresInSeconds) {
        // Calculate expiration timestamp
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

        const result = await db.query(
            `INSERT INTO user_permissions (user_id, video_id, expires_at) 
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, video_id) 
             DO UPDATE SET expires_at = $3
             RETURNING *`,
            [userId, videoId, expiresAt]
        );
        return result.rows[0];
    }

    async createProcessingTask(userId, videoId, codecPreference, resolutions, crf, compress) {
        const allowedCodecs = ['h264', 'h265'];
        if (!allowedCodecs.includes(codecPreference)) {
            throw new Error('Invalid codec preference');
        }
        const allowedRes = ['360p', '720p', '1080p'];
        const invalidRes = (resolutions || []).filter(r => !allowedRes.includes(r));
        if (invalidRes.length > 0) {
            throw new Error('Invalid resolutions');
        }

        const result = await db.query(
            `INSERT INTO video_processing_tasks 
             (user_id, video_id, codec_preference, resolutions, crf, compress, status) 
             VALUES ($1, $2, $3, $4, $5, $6, 'pending')
             RETURNING *`,
            [userId, videoId, codecPreference, resolutions, crf || null, compress || false]
        );
        return result.rows[0];
    }

    async deleteVideo(videoId, ownerId) {
        // 1. Check ownership and get storage path
        const videoRes = await db.query(
            'SELECT * FROM videos WHERE id = $1 AND owner_id = $2',
            [videoId, ownerId]
        );
        
        if (videoRes.rows.length === 0) {
            throw new Error('Video not found or access denied');
        }
        
        const video = videoRes.rows[0];

        // 2. Delete from DB
        // Must delete permissions first because no CASCADE
        await db.query('DELETE FROM user_permissions WHERE video_id = $1', [videoId]);
        
        // Videos delete will cascade to video_processing_tasks
        await db.query('DELETE FROM videos WHERE id = $1', [videoId]);

        // 3. Delete files
        try {
            // Delete video directory
            if (video.storage_path && fs.existsSync(video.storage_path)) {
                fs.rmSync(video.storage_path, { recursive: true, force: true });
            } else {
                // If storage_path was relative or not absolute, try to construct it
                // Based on createVideo, it's usually absolute. 
                // Fallback check in public/videos just in case
                const fallbackPath = path.join(__dirname, '../../public/videos', videoId);
                if (fs.existsSync(fallbackPath)) {
                    fs.rmSync(fallbackPath, { recursive: true, force: true });
                }
            }

            // Delete key directory
            const keyDir = path.join(KEYS_ROOT_DIR, videoId);
            if (fs.existsSync(keyDir)) {
                fs.rmSync(keyDir, { recursive: true, force: true });
            }
        } catch (err) {
            console.error(`Failed to cleanup files for video ${videoId}:`, err);
            // Don't throw here, as DB is already cleaned
        }

        return { message: 'Video deleted successfully' };
    }
}

module.exports = new AdminService();
