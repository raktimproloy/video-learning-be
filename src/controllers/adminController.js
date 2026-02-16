const adminService = require('../services/adminService');
const lessonService = require('../services/lessonService');
const videoService = require('../services/videoService');
const r2Storage = require('../services/r2StorageService');
const { validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');

const STAGING_DIR = path.resolve(__dirname, '../../staging');

class AdminController {
    async addVideo(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        const ownerId = req.user.id;
        const { title, lesson_id, order } = req.body;
        const useR2 = r2Storage.isConfigured;

        try {
            let courseId = null;
            if (lesson_id) {
                const lesson = await lessonService.getLessonById(lesson_id);
                if (lesson) courseId = lesson.course_id;
            }
            if (!courseId && lesson_id) {
                return res.status(400).json({ error: 'Lesson not found' });
            }
            const effectiveCourseId = courseId || 'unknown';
            const effectiveLessonId = lesson_id || 'unknown';

            if (useR2) {
                const video = await adminService.createVideo(title, 'staging_placeholder', ownerId, lesson_id, order ?? 0, {
                    storageProvider: 'r2',
                    r2Key: null,
                });
                const r2Prefix = r2Storage.getVideoKeyPrefix(ownerId, effectiveCourseId, effectiveLessonId, video.id);
                const stagingVideoDir = path.join(STAGING_DIR, video.id);
                if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
                if (!fs.existsSync(stagingVideoDir)) fs.mkdirSync(stagingVideoDir, { recursive: true });
                const inputPath = path.join(stagingVideoDir, 'input.mp4');
                const uploadedPath = path.isAbsolute(req.file.path) ? req.file.path : path.resolve(process.cwd(), req.file.path);
                if (!fs.existsSync(uploadedPath)) throw new Error(`Uploaded file not found at ${uploadedPath}. Ensure uploads directory exists.`);
                fs.renameSync(uploadedPath, inputPath);
                await adminService.updateVideoStoragePath(video.id, stagingVideoDir);
                await adminService.updateVideoR2(video.id, r2Prefix);
                const codecPreference = 'h264';
                const resolutions = ['360p', '720p', '1080p'];
                await adminService.createProcessingTask(ownerId, video.id, codecPreference, resolutions, 28, false);
                const updated = await videoService.getVideoById(video.id);
                return res.status(201).json(updated);
            }

            const video = await adminService.createVideo(title, 'pending_creation', ownerId, lesson_id, order ?? 0);
            const publicVideosDir = path.join(__dirname, '../../public/videos');
            const videoDir = path.join(publicVideosDir, video.id);
            if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
            const inputFilePath = path.join(videoDir, 'input.mp4');
            const uploadedPath = path.isAbsolute(req.file.path) ? req.file.path : path.resolve(process.cwd(), req.file.path);
            if (!fs.existsSync(uploadedPath)) throw new Error(`Uploaded file not found at ${uploadedPath}. Ensure uploads directory exists.`);
            fs.renameSync(uploadedPath, inputFilePath);
            const updatedVideo = await adminService.updateVideoStoragePath(video.id, videoDir);
            const codecPreference = 'h264';
            const resolutions = ['360p', '720p', '1080p'];
            await adminService.createProcessingTask(ownerId, video.id, codecPreference, resolutions, 28, false);
            res.status(201).json(updatedVideo);
        } catch (error) {
            console.error('Add Video Error:', error);
            const cleanupPath = req.file && (path.isAbsolute(req.file.path) ? req.file.path : path.resolve(process.cwd(), req.file.path));
            if (req.file && cleanupPath && fs.existsSync(cleanupPath)) {
                try { fs.unlinkSync(cleanupPath); } catch (e) {}
            }
            if (error.code === '23503') return res.status(400).json({ error: 'Invalid user ID (owner_id). Please relogin.' });
            const message = error.message || 'Internal Server Error';
            res.status(500).json({ error: message });
        }
    }

    async grantPermission(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { user_id, video_id, duration_seconds } = req.body;
            // Default to 1 hour if not specified
            const duration = duration_seconds || 3600; 
            
            const permission = await adminService.grantPermission(user_id, video_id, duration);
            res.status(200).json({ message: 'Permission granted', permission });
        } catch (error) {
            console.error('Grant Permission Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    async createProcessingTask(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        try {
            const userId = req.user.id;
            const { video_id, codec_preference, resolutions, crf, compress } = req.body;
            const task = await adminService.createProcessingTask(userId, video_id, codec_preference, resolutions, crf, compress);
            res.status(201).json(task);
        } catch (error) {
            console.error('Create Processing Task Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    async deleteVideo(req, res) {
        try {
            const videoId = req.params.id;
            const ownerId = req.user.id;
            
            const result = await adminService.deleteVideo(videoId, ownerId);
            res.status(200).json(result);
        } catch (error) {
            console.error('Delete Video Error:', error);
            if (error.message === 'Video not found or access denied') {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = new AdminController();
