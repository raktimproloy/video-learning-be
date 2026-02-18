const adminService = require('../services/adminService');
const { isImage, compressImage } = require('../utils/imageCompress');
const lessonService = require('../services/lessonService');
const videoService = require('../services/videoService');
const r2Storage = require('../services/r2StorageService');
const { validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');

const STAGING_DIR = path.resolve(__dirname, '../../staging');
const UPLOADS_LESSONS = path.resolve(__dirname, '../../uploads/lessons');

function parseNotesAndAssignments(body) {
    let notes = [];
    let assignments = [];
    try {
        notes = body.notes ? (typeof body.notes === 'string' ? JSON.parse(body.notes) : body.notes) : [];
    } catch (e) { notes = []; }
    try {
        assignments = body.assignments ? (typeof body.assignments === 'string' ? JSON.parse(body.assignments) : body.assignments) : [];
    } catch (e) { assignments = []; }
    return { notes, assignments };
}

async function processVideoFiles(req, notes, assignments, videoId, lessonId, courseId, teacherId) {
    const files = req.files || [];
    const noteFiles = {};
    const assignmentFiles = {};
    files.forEach((f) => {
        const m = f.fieldname?.match(/^note_file_(\d+)$/);
        if (m) noteFiles[parseInt(m[1], 10)] = f;
        const m2 = f.fieldname?.match(/^assignment_file_(\d+)$/);
        if (m2) assignmentFiles[parseInt(m2[1], 10)] = f;
    });

    const outNotes = [...notes];
    for (let i = 0; i < outNotes.length; i++) {
        const note = outNotes[i];
        if (note.type === 'file' && noteFiles[i]) {
            const f = noteFiles[i];
            let buffer = f.buffer || (f.path ? fs.readFileSync(f.path) : null);
            if (buffer && isImage(f.originalname)) buffer = await compressImage(buffer, f.originalname);
            if (buffer && r2Storage.isConfigured && r2Storage.uploadVideoMedia) {
                const r2Key = await r2Storage.uploadVideoMedia(teacherId, courseId, lessonId, videoId, buffer, f.originalname, 'notes');
                note.filePath = r2Key;
                note.fileName = f.originalname;
            } else if (buffer) {
                const dir = path.join(UPLOADS_LESSONS, lessonId, 'videos', videoId, 'notes');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const ext = path.extname(f.originalname);
                const fileName = `note-${Date.now()}-${i}${ext}`;
                const filePath = path.join(dir, fileName);
                fs.writeFileSync(filePath, buffer);
                note.filePath = `/uploads/lessons/${lessonId}/videos/${videoId}/notes/${fileName}`;
                note.fileName = f.originalname;
            }
        }
    }

    const outAssignments = [...assignments];
    for (let i = 0; i < outAssignments.length; i++) {
        const a = outAssignments[i];
        if (a.type === 'file' && assignmentFiles[i]) {
            const f = assignmentFiles[i];
            let buffer = f.buffer || (f.path ? fs.readFileSync(f.path) : null);
            if (buffer && isImage(f.originalname)) buffer = await compressImage(buffer, f.originalname);
            if (buffer && r2Storage.isConfigured && r2Storage.uploadVideoMedia) {
                const r2Key = await r2Storage.uploadVideoMedia(teacherId, courseId, lessonId, videoId, buffer, f.originalname, 'assignments');
                a.filePath = r2Key;
                a.fileName = f.originalname;
            } else if (buffer) {
                const dir = path.join(UPLOADS_LESSONS, lessonId, 'videos', videoId, 'assignments');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const ext = path.extname(f.originalname);
                const fileName = `assignment-${Date.now()}-${i}${ext}`;
                const filePath = path.join(dir, fileName);
                fs.writeFileSync(filePath, buffer);
                a.filePath = `/uploads/lessons/${lessonId}/videos/${videoId}/assignments/${fileName}`;
                a.fileName = f.originalname;
            }
        }
    }
    return { notes: outNotes, assignments: outAssignments };
}

class AdminController {
    async addVideo(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const files = req.files || [];
        const videoFile = files.find((f) => f.fieldname === 'video');
        if (!videoFile) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        const ownerId = req.user.id;
        const { title, description, lesson_id, order, isPreview } = req.body;
        const { notes, assignments } = parseNotesAndAssignments(req.body);
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

            const wantPreview = isPreview === 'true' || isPreview === true;
            if (wantPreview && lesson_id) {
                const orderNum = parseInt(order, 10) || 0;
                const { allowed, reason } = await videoService.canSetVideoPreview(lesson_id, orderNum, null);
                if (!allowed) {
                    return res.status(400).json({ error: reason });
                }
            }

            const videoOptions = {
                description: description || null,
                isPreview: wantPreview,
                notes,
                assignments,
                status: 'processing', // Set status to processing when video is uploaded
            };

            if (useR2) {
                const video = await adminService.createVideo(title, 'staging_placeholder', ownerId, lesson_id, parseInt(order, 10) || 0, {
                    ...videoOptions,
                    storageProvider: 'r2',
                    r2Key: null,
                });
                const r2Prefix = r2Storage.getVideoKeyPrefix(ownerId, effectiveCourseId, effectiveLessonId, video.id);
                const stagingVideoDir = path.join(STAGING_DIR, video.id);
                if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
                if (!fs.existsSync(stagingVideoDir)) fs.mkdirSync(stagingVideoDir, { recursive: true });
                const inputPath = path.join(stagingVideoDir, 'input.mp4');
                const uploadedPath = path.isAbsolute(videoFile.path) ? videoFile.path : path.resolve(process.cwd(), videoFile.path);
                if (!fs.existsSync(uploadedPath)) throw new Error(`Uploaded file not found at ${uploadedPath}. Ensure uploads directory exists.`);
                fs.renameSync(uploadedPath, inputPath);
                await adminService.updateVideoStoragePath(video.id, stagingVideoDir);
                await adminService.updateVideoR2(video.id, r2Prefix);

                if (notes.length > 0 || assignments.length > 0) {
                    const { notes: finalNotes, assignments: finalAssignments } = await processVideoFiles(
                        req, notes, assignments, video.id, effectiveLessonId, effectiveCourseId, ownerId
                    );
                    await adminService.updateVideoMetadata(video.id, { notes: finalNotes, assignments: finalAssignments });
                }

                const codecPreference = 'h264';
                const resolutions = ['360p', '720p', '1080p'];
                await adminService.createProcessingTask(ownerId, video.id, codecPreference, resolutions, 28, false);
                const updated = await videoService.getVideoById(video.id);
                return res.status(201).json(updated);
            }

            const video = await adminService.createVideo(title, 'pending_creation', ownerId, lesson_id, parseInt(order, 10) || 0, videoOptions);
            const publicVideosDir = path.join(__dirname, '../../public/videos');
            const videoDir = path.join(publicVideosDir, video.id);
            if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
            const inputFilePath = path.join(videoDir, 'input.mp4');
            const uploadedPath = path.isAbsolute(videoFile.path) ? videoFile.path : path.resolve(process.cwd(), videoFile.path);
            if (!fs.existsSync(uploadedPath)) throw new Error(`Uploaded file not found at ${uploadedPath}. Ensure uploads directory exists.`);
            fs.renameSync(uploadedPath, inputFilePath);

            if (notes.length > 0 || assignments.length > 0) {
                const { notes: finalNotes, assignments: finalAssignments } = await processVideoFiles(
                    req, notes, assignments, video.id, effectiveLessonId, effectiveCourseId, ownerId
                );
                await adminService.updateVideoMetadata(video.id, { notes: finalNotes, assignments: finalAssignments });
            }

            const updatedVideo = await adminService.updateVideoStoragePath(video.id, videoDir);
            const codecPreference = 'h264';
            const resolutions = ['360p', '720p', '1080p'];
            await adminService.createProcessingTask(ownerId, video.id, codecPreference, resolutions, 28, false);
            res.status(201).json(updatedVideo);
        } catch (error) {
            console.error('Add Video Error:', error);
            const cleanupPaths = (req.files || []).map((f) => f.path && (path.isAbsolute(f.path) ? f.path : path.resolve(process.cwd(), f.path)));
            cleanupPaths.forEach((p) => {
                if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) {} }
            });
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

    async getVideo(req, res) {
        try {
            const videoId = req.params.id;
            const ownerId = req.user.id;
            
            const video = await videoService.getVideoById(videoId);
            if (!video || video.owner_id !== ownerId) {
                return res.status(404).json({ error: 'Video not found or access denied' });
            }

            const result = { ...video };
            result.isPreview = result.is_preview ?? false;
            if (result.notes && typeof result.notes === 'string') {
                try { result.notes = JSON.parse(result.notes); } catch { result.notes = []; }
            }
            if (result.assignments && typeof result.assignments === 'string') {
                try { result.assignments = JSON.parse(result.assignments); } catch { result.assignments = []; }
            }
            res.status(200).json(result);
        } catch (error) {
            console.error('Get Video Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    async getProcessingStatus(req, res) {
        try {
            const videoId = req.params.id;
            const ownerId = req.user.id;
            
            const status = await adminService.getProcessingStatus(videoId, ownerId);
            res.status(200).json(status);
        } catch (error) {
            console.error('Get Processing Status Error:', error);
            if (error.message === 'Video not found or access denied') {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    async updateVideo(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const videoId = req.params.id;
            const ownerId = req.user.id;
            
            // Check ownership
            const video = await videoService.getVideoById(videoId);
            if (!video || video.owner_id !== ownerId) {
                return res.status(404).json({ error: 'Video not found or access denied' });
            }

            const { title, description, order, isPreview, status } = req.body;
            const { notes, assignments } = parseNotesAndAssignments(req.body);
            
            const metadata = {};
            if (title !== undefined) metadata.title = title;
            if (description !== undefined) metadata.description = description;
            if (order !== undefined) metadata.order = parseInt(order, 10);
            if (isPreview !== undefined) metadata.isPreview = isPreview === 'true' || isPreview === true;
            if (status !== undefined) metadata.status = status;
            if (notes !== undefined) metadata.notes = notes;
            if (assignments !== undefined) metadata.assignments = assignments;

            if (metadata.isPreview === true && video.lesson_id) {
                const effectiveOrder = metadata.order !== undefined ? metadata.order : video.order;
                const { allowed, reason } = await videoService.canSetVideoPreview(video.lesson_id, effectiveOrder, videoId);
                if (!allowed) {
                    return res.status(400).json({ error: reason });
                }
            }

            // Handle file uploads for notes and assignments if provided
            const files = req.files || [];
            if (files.length > 0 && (notes.length > 0 || assignments.length > 0)) {
                let courseId = null;
                if (video.lesson_id) {
                    const lesson = await lessonService.getLessonById(video.lesson_id);
                    if (lesson) courseId = lesson.course_id;
                }
                const effectiveCourseId = courseId || 'unknown';
                const effectiveLessonId = video.lesson_id || 'unknown';
                
                const { notes: finalNotes, assignments: finalAssignments } = await processVideoFiles(
                    req, notes, assignments, videoId, effectiveLessonId, effectiveCourseId, ownerId
                );
                metadata.notes = finalNotes;
                metadata.assignments = finalAssignments;
            }

            const updated = await adminService.updateVideoMetadata(videoId, metadata);
            res.status(200).json(updated);
        } catch (error) {
            console.error('Update Video Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = new AdminController();
