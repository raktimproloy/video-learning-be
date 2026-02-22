const db = require('../../db');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const r2Storage = require('./r2StorageService');

const KEYS_ROOT_DIR = process.env.KEYS_ROOT_DIR || path.join(__dirname, '../../keys');

class AdminService {
    /**
     * Create video record. Use storagePath for local, or pass storageProvider='r2' and r2Key for R2.
     * options: { storageProvider, r2Key, description, isPreview, notes, assignments, status }
     */
    async createVideo(title, storagePath, ownerId, lessonId = null, order = 0, options = {}) {
        const signingSecret = crypto.randomBytes(32).toString('hex');
        const storageProvider = options.storageProvider || 'local';
        const r2Key = options.r2Key || null;
        const description = options.description || null;
        const isPreview = options.isPreview === true;
        const notes = options.notes ? JSON.stringify(options.notes) : '[]';
        const assignments = options.assignments ? JSON.stringify(options.assignments) : '[]';
        const status = options.status || 'processing';
        const sourceType = options.sourceType === 'live' ? 'live' : 'upload';

        const result = await db.query(
            `INSERT INTO videos (title, description, storage_path, signing_secret, owner_id, lesson_id, "order", is_preview, notes, assignments, storage_provider, r2_key, status, source_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
            [title, description, storagePath, signingSecret, ownerId, lessonId, order, isPreview, notes, assignments, storageProvider, r2Key, status, sourceType]
        );
        const video = result.rows[0];

        try {
            const keyDir = path.join(KEYS_ROOT_DIR, video.id);
            if (!fs.existsSync(keyDir)) {
                fs.mkdirSync(keyDir, { recursive: true });
            }
            const keyPath = path.join(keyDir, 'enc.key');
            const key = crypto.randomBytes(16);
            fs.writeFileSync(keyPath, key);
            console.log(`Generated key for video ${video.id} at ${keyPath}`);
        } catch (err) {
            console.error('Failed to generate key file:', err);
        }

        return video;
    }

    /**
     * Create video with a specific ID (used when saving live recording - live_session_id becomes video_id).
     */
    async createVideoWithId(videoId, title, storagePath, ownerId, lessonId = null, order = 0, options = {}) {
        const signingSecret = crypto.randomBytes(32).toString('hex');
        const storageProvider = options.storageProvider || 'local';
        const r2Key = options.r2Key || null;
        const description = options.description || null;
        const isPreview = options.isPreview === true;
        const notes = options.notes ? JSON.stringify(options.notes) : '[]';
        const assignments = options.assignments ? JSON.stringify(options.assignments) : '[]';
        const status = options.status || 'processing';
        const sourceType = 'live';

        const result = await db.query(
            `INSERT INTO videos (id, title, description, storage_path, signing_secret, owner_id, lesson_id, "order", is_preview, notes, assignments, storage_provider, r2_key, status, source_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
            [videoId, title, description, storagePath, signingSecret, ownerId, lessonId, order, isPreview, notes, assignments, storageProvider, r2Key, status, sourceType]
        );
        const video = result.rows[0];

        try {
            const keyDir = path.join(KEYS_ROOT_DIR, video.id);
            if (!fs.existsSync(keyDir)) {
                fs.mkdirSync(keyDir, { recursive: true });
            }
            const keyPath = path.join(keyDir, 'enc.key');
            const key = crypto.randomBytes(16);
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

    async updateVideoDuration(videoId, durationSeconds) {
        const result = await db.query(
            'UPDATE videos SET duration_seconds = $1 WHERE id = $2 RETURNING *',
            [durationSeconds, videoId]
        );
        return result.rows[0];
    }

    async updateVideoMetadata(videoId, metadata) {
        const updates = [];
        const values = [];
        let idx = 1;
        if (metadata.description !== undefined) { updates.push(`description = $${idx++}`); values.push(metadata.description); }
        if (metadata.isPreview !== undefined) { updates.push(`is_preview = $${idx++}`); values.push(metadata.isPreview); }
        if (metadata.notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(JSON.stringify(metadata.notes)); }
        if (metadata.assignments !== undefined) { updates.push(`assignments = $${idx++}`); values.push(JSON.stringify(metadata.assignments)); }
        if (metadata.status !== undefined) { updates.push(`status = $${idx++}`); values.push(metadata.status); }
        if (metadata.title !== undefined) { updates.push(`title = $${idx++}`); values.push(metadata.title); }
        if (metadata.order !== undefined) { updates.push(`"order" = $${idx++}`); values.push(metadata.order); }
        if (updates.length === 0) return (await db.query('SELECT * FROM videos WHERE id = $1', [videoId])).rows[0];
        values.push(videoId);
        const result = await db.query(
            `UPDATE videos SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return result.rows[0];
    }

    async updateVideoStatus(videoId, status) {
        const result = await db.query(
            'UPDATE videos SET status = $1 WHERE id = $2 RETURNING *',
            [status, videoId]
        );
        return result.rows[0];
    }

    async getProcessingStatus(videoId, ownerId) {
        // Check ownership
        const videoRes = await db.query(
            'SELECT id, status FROM videos WHERE id = $1 AND owner_id = $2',
            [videoId, ownerId]
        );
        if (videoRes.rows.length === 0) {
            throw new Error('Video not found or access denied');
        }

        const video = videoRes.rows[0];
        
        // Get latest processing task status
        const taskRes = await db.query(
            `SELECT status, error_message, created_at, updated_at 
             FROM video_processing_tasks 
             WHERE video_id = $1 
             ORDER BY created_at DESC 
             LIMIT 1`,
            [videoId]
        );

        const task = taskRes.rows[0];
        
        return {
            videoId: video.id,
            videoStatus: video.status,
            processingStatus: task ? task.status : null,
            errorMessage: task ? task.error_message : null,
            createdAt: task ? task.created_at : null,
            updatedAt: task ? task.updated_at : null,
        };
    }

    async updateVideoR2(videoId, r2Key, sizeBytes = null) {
        const updates = ['storage_provider = $1', 'r2_key = $2'];
        const values = ['r2', r2Key, videoId];
        if (sizeBytes != null) {
            updates.push('size_bytes = $4');
            values.push(sizeBytes);
        }
        const result = await db.query(
            `UPDATE videos SET ${updates.join(', ')} WHERE id = $3 RETURNING *`,
            values
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
        // 1. Check ownership and get video row
        const videoRes = await db.query(
            'SELECT * FROM videos WHERE id = $1 AND owner_id = $2',
            [videoId, ownerId]
        );

        if (videoRes.rows.length === 0) {
            throw new Error('Video not found or access denied');
        }

        const video = videoRes.rows[0];

        // 2. Delete from Cloudflare R2 first (so DB is only removed after R2 is cleared)
        if (video.r2_key && r2Storage.isConfigured) {
            try {
                await r2Storage.deletePrefix(video.r2_key);
            } catch (err) {
                console.error(`Failed to delete video ${videoId} from R2:`, err);
                throw new Error('Failed to delete video from storage. Please try again.');
            }
        }

        // 3. Delete local staging / keys (best-effort)
        try {
            if (video.storage_path && fs.existsSync(video.storage_path)) {
                fs.rmSync(video.storage_path, { recursive: true, force: true });
            }
            const fallbackPath = path.join(__dirname, '../../public/videos', videoId);
            if (fs.existsSync(fallbackPath)) {
                fs.rmSync(fallbackPath, { recursive: true, force: true });
            }
            const keyDir = path.join(KEYS_ROOT_DIR, videoId);
            if (fs.existsSync(keyDir)) {
                fs.rmSync(keyDir, { recursive: true, force: true });
            }
        } catch (err) {
            console.error(`Failed to cleanup local files for video ${videoId}:`, err);
        }

        // 4. Delete from DB only after R2 (and local) cleanup
        await db.query('DELETE FROM user_permissions WHERE video_id = $1', [videoId]);
        await db.query('DELETE FROM videos WHERE id = $1', [videoId]);

        return { message: 'Video deleted successfully' };
    }
}

module.exports = new AdminService();
