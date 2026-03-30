const { validationResult } = require('express-validator');
const path = require('path');
const recordingDraftService = require('../services/recordingDraftService');
const lessonService = require('../services/lessonService');
const adminService = require('../services/adminService');
const r2Storage = require('../services/r2StorageService');

class RecordingDraftController {
    async list(req, res) {
        try {
            const teacherId = req.user.id;
            const rows = await recordingDraftService.listByTeacher(teacherId);
            return res.json(rows);
        } catch (error) {
            console.error('List recording drafts error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getById(req, res) {
        try {
            const teacherId = req.user.id;
            const { id } = req.params;
            const row = await recordingDraftService.getById(id, teacherId);
            if (!row) return res.status(404).json({ error: 'Recording draft not found' });
            return res.json(row);
        } catch (error) {
            console.error('Get recording draft error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    async create(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0]?.msg || 'Validation failed', errors: errors.array() });
        }
        try {
            const teacherId = req.user.id;
            const {
                title,
                description,
                course_id,
                lesson_id,
                source_object_key,
                source_prefix,
                mime_type,
                size_bytes,
                duration_seconds,
            } = req.body;

            const row = await recordingDraftService.create({
                teacherId,
                title: title || 'Recording draft',
                description,
                courseId: course_id,
                lessonId: lesson_id,
                sourceObjectKey: source_object_key,
                sourcePrefix: source_prefix,
                mimeType: mime_type,
                sizeBytes: size_bytes ? Number(size_bytes) : null,
                durationSeconds: duration_seconds ? Number(duration_seconds) : null,
            });
            return res.status(201).json(row);
        } catch (error) {
            console.error('Create recording draft error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    async update(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0]?.msg || 'Validation failed', errors: errors.array() });
        }
        try {
            const teacherId = req.user.id;
            const { id } = req.params;
            const patch = {
                title: req.body.title,
                description: req.body.description,
                courseId: req.body.course_id,
                lessonId: req.body.lesson_id,
                trimStartSeconds: req.body.trim_start_seconds != null ? Number(req.body.trim_start_seconds) : undefined,
                trimEndSeconds: req.body.trim_end_seconds != null ? Number(req.body.trim_end_seconds) : undefined,
                sourceObjectKey: req.body.source_object_key,
                sourcePrefix: req.body.source_prefix,
                sizeBytes: req.body.size_bytes != null ? Number(req.body.size_bytes) : undefined,
                durationSeconds: req.body.duration_seconds != null ? Number(req.body.duration_seconds) : undefined,
            };
            const row = await recordingDraftService.update(id, teacherId, patch);
            if (!row) return res.status(404).json({ error: 'Recording draft not found' });
            return res.json(row);
        } catch (error) {
            console.error('Update recording draft error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getSignedSourceUrl(req, res) {
        try {
            if (!r2Storage.isConfigured) {
                return res.status(400).json({ error: 'R2 is not configured.' });
            }
            const teacherId = req.user.id;
            const { id } = req.params;
            const draft = await recordingDraftService.getById(id, teacherId);
            if (!draft) return res.status(404).json({ error: 'Recording draft not found' });
            const url = await r2Storage.getPresignedGetUrl(draft.source_object_key, 3600);
            return res.json({ url });
        } catch (error) {
            console.error('Get recording draft signed source URL error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    async publish(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0]?.msg || 'Validation failed', errors: errors.array() });
        }

        try {
            if (!r2Storage.isConfigured) {
                return res.status(400).json({ error: 'R2 is not configured.' });
            }

            const teacherId = req.user.id;
            const { id } = req.params;
            const draft = await recordingDraftService.getById(id, teacherId);
            if (!draft) return res.status(404).json({ error: 'Recording draft not found' });
            if (draft.status === 'published' && draft.published_video_id) {
                return res.status(400).json({ error: 'Already published' });
            }

            const lessonId = req.body.lesson_id || draft.lesson_id;
            if (!lessonId) return res.status(400).json({ error: 'lesson_id is required to publish' });

            const lesson = await lessonService.getLessonById(lessonId);
            if (!lesson) return res.status(400).json({ error: 'Lesson not found' });
            const courseId = lesson.course_id;
            const order = Number(req.body.order ?? 0) || 0;
            const title = (req.body.title || draft.title || 'Recording').trim();
            const description = req.body.description ?? draft.description ?? null;
            const isPreview = req.body.isPreview === true || req.body.isPreview === 'true';

            const video = await adminService.createVideo(
                title,
                'r2_staging',
                teacherId,
                lessonId,
                order,
                {
                    description,
                    isPreview,
                    notes: [],
                    assignments: [],
                    status: 'processing',
                    storageProvider: 'r2',
                    r2Key: null,
                }
            );

            const videoPrefix = r2Storage.getVideoKeyPrefix(teacherId, courseId, lessonId, video.id);
            const ext = path.extname(draft.source_object_key || '') || '.webm';
            const finalStagingKey = `${videoPrefix}/staging/input${ext}`;
            const stream = await r2Storage.getObjectStream(draft.source_object_key);
            await r2Storage.uploadStream(finalStagingKey, stream, draft.mime_type || 'video/webm');

            await adminService.updateVideoR2(video.id, videoPrefix, draft.size_bytes || null);
            await adminService.createProcessingTask(teacherId, video.id, 'h264', ['360p', '720p', '1080p'], 28, false);

            await recordingDraftService.update(id, teacherId, {
                status: 'published',
                publishedVideoId: video.id,
                lessonId,
                courseId,
            });

            return res.status(200).json({
                ok: true,
                draftId: id,
                videoId: video.id,
                lessonId,
                courseId,
            });
        } catch (error) {
            console.error('Publish recording draft error:', error);
            return res.status(500).json({ error: 'Failed to publish recording draft' });
        }
    }
}

module.exports = new RecordingDraftController();

