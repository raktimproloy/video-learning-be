const db = require('../../db');
const fs = require('fs');
const path = require('path');
const r2Storage = require('./r2StorageService');
const keyStorage = require('./keyStorageService');

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

        // Check course enrollment permission (only if course and lesson are active)
        const courseEnrollment = await db.query(
            `SELECT 1 
             FROM course_enrollments ce
             JOIN lessons l ON ce.course_id = l.course_id
             JOIN courses c ON c.id = l.course_id
             JOIN videos v ON l.id = v.lesson_id
             WHERE ce.user_id = $1 AND v.id = $2
             AND (COALESCE(c.status, 'active') = 'active')
             AND (COALESCE(l.status, 'active') = 'active')`,
            [userId, videoId]
        );
        return courseEnrollment.rows.length > 0;
    }

    /**
     * Checks if user is owner of the video OR a marketer managing the course.
     */
    async isOwnerOrManager(userId, videoId) {
        const video = await this.getVideoById(videoId);
        if (!video) return false;
        if (video.owner_id === userId) return true;

        // Check if user is the marketer who referred the teacher
        const marketerPermission = await db.query(
            `SELECT 1 
             FROM courses c
             JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
             JOIN lessons l ON c.id = l.course_id
             JOIN videos v ON l.id = v.lesson_id
             WHERE tp.referred_by = $1 AND v.id = $2`,
            [userId, videoId]
        );
        return marketerPermission.rows.length > 0;
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
     * Only videos in active courses and active lessons; excludes processing/inactive videos.
     */
    async getAvailableVideos(userId) {
        const query = `
            SELECT DISTINCT
                v.id, 
                v.title, 
                v.source_type,
                true as has_access
            FROM videos v
            LEFT JOIN user_permissions up ON v.id = up.video_id AND up.user_id = $1 AND up.expires_at > NOW()
            LEFT JOIN lessons l ON v.lesson_id = l.id
            LEFT JOIN courses c ON l.course_id = c.id
            LEFT JOIN course_enrollments ce ON l.course_id = ce.course_id AND ce.user_id = $1
            WHERE ((up.video_id IS NOT NULL) OR (ce.course_id IS NOT NULL))
            AND (
                (up.video_id IS NOT NULL)
                OR (ce.course_id IS NOT NULL AND (COALESCE(c.status, 'active') = 'active') AND (COALESCE(l.status, 'active') = 'active'))
            )
            AND (v.status IS NULL OR v.status = 'active' OR v.status = 'processing')
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
                v.source_type,
                (SELECT COUNT(*) FROM user_permissions up WHERE up.video_id = v.id AND up.expires_at > NOW()) as student_count
            FROM videos v
            WHERE v.owner_id = $1
            ORDER BY v.created_at DESC
        `;
        const result = await db.query(query, [ownerId]);
        return result.rows;
    }

    async getVideosByLesson(lessonId, userId = null, lessonIsLocked = false, isOwner = false) {
        const statusFilter = isOwner ? '' : `AND (v.status IS NULL OR v.status = 'active' OR v.status = 'processing')`;
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
            WHERE v.lesson_id = $1 ${statusFilter}
            ORDER BY v."order" ASC, v.created_at ASC
        `;
        const result = await db.query(query, [lessonId]);
        const videos = result.rows.map((row) => {
            const notes = row.notes ? (typeof row.notes === 'string' ? JSON.parse(row.notes) : row.notes) : [];
            const assignments = row.assignments ? (typeof row.assignments === 'string' ? JSON.parse(row.assignments) : row.assignments) : [];
            const hasRequired = Array.isArray(assignments) && assignments.some((a) => a && a.isRequired === true);
            return {
                ...row,
                isPreview: row.is_preview ?? false,
                source_type: row.source_type || 'upload',
                notes: Array.isArray(notes) ? notes : [],
                assignments: Array.isArray(assignments) ? assignments : [],
                hasRequiredAssignment: !!hasRequired,
                viewCount: row.view_count != null ? parseInt(row.view_count, 10) : 0,
                // Use video status if available, otherwise fall back to processing_status
                status: row.status || (row.processing_status && row.processing_status !== 'completed' ? 'processing' : 'active'),
            };
        });

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
     * Check if a video can be set as preview. Preview is only allowed when all previous videos in the same lesson have no required assignments.
     * @param {string} lessonId
     * @param {number} order - Order of the video we want to set as preview
     * @param {string|null} excludeVideoId - When editing, exclude this video from the "previous" check
     * @returns {{ allowed: boolean, reason?: string }}
     */
    async canSetVideoPreview(lessonId, order, excludeVideoId = null) {
        if (!lessonId) return { allowed: true };
        const result = await db.query(
            `SELECT id, assignments FROM videos WHERE lesson_id = $1 AND "order" < $2 AND ($3::uuid IS NULL OR id != $3) ORDER BY "order" ASC`,
            [lessonId, order, excludeVideoId]
        );
        for (const row of result.rows) {
            const assignments = row.assignments ? (typeof row.assignments === 'string' ? JSON.parse(row.assignments) : row.assignments) : [];
            const hasRequired = Array.isArray(assignments) && assignments.some((a) => a && a.isRequired === true);
            if (hasRequired) {
                return { allowed: false, reason: 'Cannot set as preview: a previous video in this lesson has required assignments. Students must complete them before accessing the next video.' };
            }
        }
        return { allowed: true };
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

        const courseService = require('./courseService');
        const course = await courseService.getCourseByIdSimple(lesson.course_id);
        const teacherId = course?.teacher_id ?? null;

        // Check if lesson itself is locked (students only see active lessons)
        const allLessons = await lessonService.getLessonsByCourse(lesson.course_id, userId, teacherId);
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
    async getSignedVideoUrl(userId, videoId, customBaseUrl) {
        const video = await this.getVideoById(videoId);
        if (!video) {
            throw new Error('Video not found');
        }

        // Guest (not logged in): only preview videos allowed
        if (!userId) {
            if (!video.is_preview) {
                throw new Error('Access denied');
            }
            // Skip all user-specific checks for guests
        } else {
            const isOwnerOrManager = await this.isOwnerOrManager(userId, videoId);

            // Check access: User must be owner/manager OR have permission
            let hasAccess = false;
            if (isOwnerOrManager) {
                hasAccess = true;
            } else {
                hasAccess = await this.checkPermission(userId, videoId);
            }

            // Allow any logged-in user to watch preview videos (no enrollment required)
            if (!hasAccess && video.is_preview) {
                hasAccess = true;
            }
            if (!hasAccess) {
                throw new Error('Access denied');
            }

            // Non-owners cannot access inactive videos
            if (!isOwnerOrManager && video.status === 'inactive') {
                throw new Error('Access denied');
            }

            // Non-owners: course and lesson must be active (draft/inactive hidden from students)
            if (!isOwnerOrManager && video.lesson_id) {
                const courseLessonCheck = await db.query(
                    `SELECT 1 FROM lessons l
                     JOIN courses c ON l.course_id = c.id
                     WHERE l.id = $1 AND (COALESCE(c.status, 'active') = 'active') AND (COALESCE(l.status, 'active') = 'active')`,
                    [video.lesson_id]
                );
                if (courseLessonCheck.rows.length === 0) {
                    throw new Error('Access denied');
                }
            }

            // Increment view count when a non-owner (e.g. student) requests playback
            if (video.owner_id !== userId) {
                await db.query(
                    'UPDATE videos SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1',
                    [videoId]
                ).catch(() => { /* ignore if column missing */ });
            }

            // For students, check if video is locked
            const userRole = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
            if (userRole.rows.length > 0 && userRole.rows[0].role === 'student') {
                const isLocked = await this.isVideoLockedForStudent(userId, videoId);
                if (isLocked) {
                    throw new Error('Video is locked. Complete the required assignment from the previous video/lesson to unlock.');
                }
            }
        }

        const baseUrl = customBaseUrl || process.env.BASE_URL || 'http://localhost:5000';
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

        // Guest (no token): only preview videos allowed
        if (!userId) {
            if (!video.is_preview) {
                throw new Error('Access denied');
            }
            // Skip permission checks — go straight to key retrieval
            return keyStorage.getKey(videoId);
        }

        const isOwnerOrManager = await this.isOwnerOrManager(userId, videoId);

        let hasAccess = false;
        if (isOwnerOrManager) {
            hasAccess = true;
        } else {
            hasAccess = await this.checkPermission(userId, videoId);
        }
        if (!hasAccess && video.is_preview) {
            hasAccess = true;
        }
        if (!hasAccess) {
            throw new Error('Access denied');
        }

        // Non-owners cannot access inactive videos
        if (!isOwnerOrManager && video.status === 'inactive') {
            throw new Error('Access denied');
        }

        // Non-owners: course and lesson must be active (draft/inactive hidden from students)
        if (!isOwnerOrManager && video.lesson_id) {
            const courseLessonCheck = await db.query(
                `SELECT 1 FROM lessons l
                 JOIN courses c ON l.course_id = c.id
                 WHERE l.id = $1 AND (COALESCE(c.status, 'active') = 'active') AND (COALESCE(l.status, 'active') = 'active')`,
                [video.lesson_id]
            );
            if (courseLessonCheck.rows.length === 0) {
                throw new Error('Access denied');
            }
        }

        return keyStorage.getKey(videoId);
    }

    /**
     * Saves the current video file details as a new version in video_versions.
     */
    async saveVideoVersion(videoId, userId, userRole) {
        const video = await this.getVideoById(videoId);
        if (!video) throw new Error('Video not found');
        
        await db.query(`
            INSERT INTO video_versions 
            (video_id, storage_path, signing_secret, r2_key, duration_seconds, size_bytes, version_number, created_by_user_id, created_by_role)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            video.id, 
            video.storage_path, 
            video.signing_secret, 
            video.r2_key, 
            video.duration_seconds, 
            video.size_bytes, 
            video.version_number,
            userId,
            userRole
        ]);
    }

    /**
     * Fetches the version history for a given video.
     */
    async getVideoVersions(videoId) {
        const result = await db.query(`
            SELECT vv.*, u.name as created_by_name
            FROM video_versions vv
            LEFT JOIN users u ON vv.created_by_user_id = u.id
            WHERE vv.video_id = $1
            ORDER BY vv.version_number DESC
        `, [videoId]);
        return result.rows;
    }

    /**
     * Restores a video to a previous version.
     */
    async restoreVideoVersion(videoId, versionId, userId, userRole) {
        // Find the version
        const versionRes = await db.query('SELECT * FROM video_versions WHERE id = $1 AND video_id = $2', [versionId, videoId]);
        if (versionRes.rows.length === 0) throw new Error('Version not found');
        const version = versionRes.rows[0];

        // Save current state as a new version just in case (if we want to preserve the current state before replacing)
        await this.saveVideoVersion(videoId, userId, userRole);

        // Update the main video row with the version's data and increment version_number
        const newVersionNumber = (await this.getVideoById(videoId)).version_number + 1;
        
        await db.query(`
            UPDATE videos
            SET storage_path = $1, signing_secret = $2, r2_key = $3, duration_seconds = $4, size_bytes = $5, 
                version_number = $6, last_updated_by_user_id = $7, last_updated_by_role = $8, status = 'active'
            WHERE id = $9
        `, [
            version.storage_path, version.signing_secret, version.r2_key, version.duration_seconds, version.size_bytes,
            newVersionNumber, userId, userRole, videoId
        ]);

        // Save the restored state as the new current version in the history table
        await db.query(`
            INSERT INTO video_versions 
            (video_id, storage_path, signing_secret, r2_key, duration_seconds, size_bytes, version_number, created_by_user_id, created_by_role)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            videoId, version.storage_path, version.signing_secret, version.r2_key, version.duration_seconds, version.size_bytes,
            newVersionNumber, userId, userRole
        ]);

        return newVersionNumber;
    }

    /**
     * Deletes a video version from the history.
     */
    async deleteVideoVersion(versionId, videoId) {
        // Optional: delete from storage provider? 
        // The problem is version shares the r2_key or storage_path with other versions or current video,
        // so we shouldn't delete the actual file unless we do reference counting. 
        // Just deleting the history record is safer for now.
        await db.query('DELETE FROM video_versions WHERE id = $1 AND video_id = $2', [versionId, videoId]);
    }
}

module.exports = new VideoService();
