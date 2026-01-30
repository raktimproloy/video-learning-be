const adminService = require('../services/adminService');
const { validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');

class AdminController {
    async addVideo(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        try {
            const { title } = req.body;
            // req.user is populated by verifyToken middleware
            const ownerId = req.user.id; 
            
            // 1. Create video with placeholder path
            const video = await adminService.createVideo(title, 'pending_creation', ownerId);
            
            // 2. Define final storage path
            // e.g. public/videos/<uuid>/
            const publicVideosDir = path.join(__dirname, '../../public/videos');
            const videoDir = path.join(publicVideosDir, video.id);
            
            if (!fs.existsSync(videoDir)) {
                fs.mkdirSync(videoDir, { recursive: true });
            }

            // 3. Move uploaded file to video directory
            const inputFilePath = path.join(videoDir, 'input.mp4');
            fs.renameSync(req.file.path, inputFilePath);

            // 4. Update video storage path in DB
            // Store the absolute path or relative path? 
            // The system seems to use absolute paths based on schema comments, but relative is more portable.
            // videoService uses path.posix.join(video.storage_path, 'master.m3u8')
            // If we use absolute path here, it should work.
            const updatedVideo = await adminService.updateVideoStoragePath(video.id, videoDir);

            // 5. Calculate file size and update (optional, but good practice)
            // We could update size_bytes here if we wanted.

            res.status(201).json(updatedVideo);
        } catch (error) {
            console.error('Add Video Error:', error);
            // Cleanup uploaded file if it exists and wasn't moved
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (e) {}
            }
            
            if (error.code === '23503') { // Foreign key violation
                 return res.status(400).json({ error: 'Invalid user ID (owner_id). Please relogin.' });
            }

            res.status(500).json({ error: 'Internal Server Error' });
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
