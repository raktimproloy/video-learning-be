const db = require('../../db');
const r2Storage = require('./r2StorageService');
const keyStorage = require('./keyStorageService');

/** Safe length of notes/assignments JSON array column. */
function jsonArrayLength(value) {
    if (value == null) return 0;
    let arr = value;
    if (typeof value === 'string') {
        try {
            arr = JSON.parse(value);
        } catch {
            return 0;
        }
    }
    return Array.isArray(arr) ? arr.length : 0;
}

function bump(map, key) {
    const k = key == null || key === '' ? 'unset' : String(key);
    map[k] = (map[k] || 0) + 1;
}

class AdminTeachersService {
    async list(skip = 0, limit = 10) {
        // Teacher rating from teacher_reviews (students review teacher directly)
        const avgRatingQuery = `(SELECT COALESCE(AVG(tr.rating), 0)::numeric(3,2) FROM teacher_reviews tr WHERE tr.teacher_id = u.id)`;

        const result = await db.query(
            `SELECT 
                u.id,
                u.email,
                u.created_at,
                COALESCE(tp.name, u.email) as name,
                tp.bio,
                tp.institute_name,
                (SELECT COUNT(*)::int FROM courses c WHERE c.teacher_id = u.id) as course_count,
                (SELECT COUNT(DISTINCT ce.user_id)::int FROM course_enrollments ce
                 JOIN courses c ON ce.course_id = c.id WHERE c.teacher_id = u.id) as student_count,
                ${avgRatingQuery} as avg_rating
             FROM users u
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE (u.role = 'teacher' OR tp.user_id IS NOT NULL)
             ORDER BY u.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, skip]
        );

        const countResult = await db.query(
            `SELECT COUNT(*)::int as total
             FROM users u
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE (u.role = 'teacher' OR tp.user_id IS NOT NULL)`
        );
        const total = countResult.rows[0]?.total || 0;

        const teachers = result.rows.map(row => ({
            id: row.id,
            email: row.email,
            name: row.name || row.email,
            bio: row.bio || null,
            instituteName: row.institute_name || null,
            courses: parseInt(row.course_count, 10) || 0,
            students: parseInt(row.student_count, 10) || 0,
            rating: parseFloat(row.avg_rating) || 0,
            joinedAt: row.created_at,
        }));

        return { teachers, total };
    }

    async getById(id) {
        const result = await db.query(
            `SELECT 
                u.id,
                u.email,
                u.created_at,
                tp.name,
                tp.bio,
                tp.institute_name,
                tp.account_email,
                tp.address,
                tp.profile_image_path,
                tp.youtube_url,
                tp.linkedin_url,
                (SELECT COUNT(*)::int FROM courses c WHERE c.teacher_id = u.id) as course_count,
                (SELECT COUNT(DISTINCT ce.user_id)::int FROM course_enrollments ce
                 JOIN courses c ON ce.course_id = c.id WHERE c.teacher_id = u.id) as student_count
             FROM users u
             LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
             WHERE u.id = $1 AND (u.role = 'teacher' OR tp.user_id IS NOT NULL)`,
            [id]
        );
        const row = result.rows[0];
        if (!row) return null;

        const trResult = await db.query(
            `SELECT COALESCE(AVG(rating), 0)::float as avg_rating, COUNT(*)::int as review_count
             FROM teacher_reviews WHERE teacher_id = $1`,
            [id]
        );
        const avgRating = parseFloat(trResult.rows[0]?.avg_rating) || 0;
        const reviewCount = parseInt(trResult.rows[0]?.review_count, 10) || 0;

        return {
            id: row.id,
            email: row.email,
            name: row.name || row.email,
            bio: row.bio || null,
            instituteName: row.institute_name || null,
            accountEmail: row.account_email || null,
            address: row.address || null,
            profileImagePath: row.profile_image_path || null,
            youtubeUrl: row.youtube_url || null,
            linkedinUrl: row.linkedin_url || null,
            courses: parseInt(row.course_count, 10) || 0,
            students: parseInt(row.student_count, 10) || 0,
            rating: avgRating,
            reviewCount,
            joinedAt: row.created_at,
        };
    }

    /**
     * Full teaching inventory for admin: every course, lesson, and video with statuses, counts, views, upload dates.
     * @param {string} teacherId
     * @returns {Promise<object|null>}
     */
    async getFullReport(teacherId) {
        const teacher = await this.getById(teacherId);
        if (!teacher) return null;

        const reviewsCheck = await db.query(`
            SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reviews')
        `);
        const hasReviews = reviewsCheck.rows[0]?.exists || false;
        const ratingSub = hasReviews
            ? `(SELECT COALESCE(AVG(r.rating), 0)::numeric(3,2) FROM reviews r WHERE r.course_id = c.id)`
            : `0::numeric(3,2)`;
        const reviewCountSub = hasReviews
            ? `(SELECT COUNT(*)::int FROM reviews r WHERE r.course_id = c.id)`
            : `0::int`;

        const coursesResult = await db.query(
            `SELECT
                c.id,
                c.title,
                c.status,
                c.created_at,
                c.updated_at,
                c.price,
                c.discount_price,
                c.currency,
                ac.name AS category_name,
                (SELECT COUNT(*)::int FROM course_enrollments ce WHERE ce.course_id = c.id) AS student_count,
                ${ratingSub} AS rating,
                ${reviewCountSub} AS review_count
             FROM courses c
             LEFT JOIN admin_categories ac ON c.admin_category_id = ac.id
             WHERE c.teacher_id = $1
             ORDER BY c.created_at DESC`,
            [teacherId]
        );

        const courseRows = coursesResult.rows;
        const courseIds = courseRows.map((r) => r.id);

        const courseStatusSummary = {};
        for (const r of courseRows) {
            const st = (r.status || 'unset').toLowerCase();
            courseStatusSummary[st] = (courseStatusSummary[st] || 0) + 1;
        }

        if (courseIds.length === 0) {
            return {
                ...teacher,
                courseStatusSummary,
                aggregates: {
                    totalCourses: 0,
                    totalLessons: 0,
                    lessonsByStatus: {},
                    totalVideos: 0,
                    videosByStatus: {},
                    totalLessonNotes: 0,
                    totalLessonAssignments: 0,
                    totalVideoNotes: 0,
                    totalVideoAssignments: 0,
                    totalVideoViews: 0,
                    totalDurationSeconds: 0,
                },
                courseBreakdown: [],
            };
        }

        const lessonsResult = await db.query(
            `SELECT l.id, l.course_id, l.title, l.status, l."order", l.is_preview, l.notes, l.assignments,
                    l.created_at, l.updated_at,
                    (SELECT COUNT(*)::int FROM videos v WHERE v.lesson_id = l.id) AS video_count
             FROM lessons l
             WHERE l.course_id = ANY($1::uuid[])
             ORDER BY l.course_id, l."order" ASC NULLS LAST, l.created_at ASC`,
            [courseIds]
        );

        const videosResult = await db.query(
            `SELECT v.id, v.lesson_id, v.title, v.status, v.view_count, v.created_at,
                    v.duration_seconds, v."order", v.notes, v.assignments, v.source_type,
                    l.course_id, l.title AS lesson_title, l."order" AS lesson_order
             FROM videos v
             JOIN lessons l ON v.lesson_id = l.id
             WHERE l.course_id = ANY($1::uuid[])
             ORDER BY l.course_id, l."order" ASC NULLS LAST, v."order" ASC NULLS LAST, v.created_at ASC`,
            [courseIds]
        );

        const lessonsByCourse = new Map();
        for (const row of lessonsResult.rows) {
            if (!lessonsByCourse.has(row.course_id)) lessonsByCourse.set(row.course_id, []);
            lessonsByCourse.get(row.course_id).push(row);
        }

        const videosByCourse = new Map();
        for (const row of videosResult.rows) {
            if (!videosByCourse.has(row.course_id)) videosByCourse.set(row.course_id, []);
            videosByCourse.get(row.course_id).push(row);
        }

        const aggregates = {
            totalCourses: courseRows.length,
            totalLessons: lessonsResult.rows.length,
            lessonsByStatus: {},
            totalVideos: videosResult.rows.length,
            videosByStatus: {},
            totalLessonNotes: 0,
            totalLessonAssignments: 0,
            totalVideoNotes: 0,
            totalVideoAssignments: 0,
            totalVideoViews: 0,
            totalDurationSeconds: 0,
        };

        for (const row of lessonsResult.rows) {
            bump(aggregates.lessonsByStatus, (row.status || 'active').toLowerCase());
            aggregates.totalLessonNotes += jsonArrayLength(row.notes);
            aggregates.totalLessonAssignments += jsonArrayLength(row.assignments);
        }

        for (const row of videosResult.rows) {
            bump(
                aggregates.videosByStatus,
                row.status == null ? 'unset' : String(row.status).toLowerCase()
            );
            aggregates.totalVideoNotes += jsonArrayLength(row.notes);
            aggregates.totalVideoAssignments += jsonArrayLength(row.assignments);
            aggregates.totalVideoViews += parseInt(row.view_count, 10) || 0;
            aggregates.totalDurationSeconds += parseInt(row.duration_seconds, 10) || 0;
        }

        const courseBreakdown = courseRows.map((cr) => {
            const lid = cr.id;
            const lessonRows = lessonsByCourse.get(lid) || [];
            const videoRows = videosByCourse.get(lid) || [];

            const lessonsByStatus = {};
            let lessonNotes = 0;
            let lessonAssignments = 0;
            const lessons = lessonRows.map((l) => {
                const n = jsonArrayLength(l.notes);
                const a = jsonArrayLength(l.assignments);
                lessonNotes += n;
                lessonAssignments += a;
                const lst = (l.status || 'active').toLowerCase();
                lessonsByStatus[lst] = (lessonsByStatus[lst] || 0) + 1;
                return {
                    id: l.id,
                    title: l.title,
                    order: l.order,
                    status: l.status || 'active',
                    isPreview: !!l.is_preview,
                    videoCount: parseInt(l.video_count, 10) || 0,
                    notesCount: n,
                    assignmentsCount: a,
                    createdAt: l.created_at,
                    updatedAt: l.updated_at,
                };
            });

            const videosByStatus = {};
            let videoNotes = 0;
            let videoAssignments = 0;
            let videoViews = 0;
            let durationSeconds = 0;
            const videos = videoRows.map((v) => {
                const n = jsonArrayLength(v.notes);
                const a = jsonArrayLength(v.assignments);
                videoNotes += n;
                videoAssignments += a;
                const vc = parseInt(v.view_count, 10) || 0;
                videoViews += vc;
                const ds = parseInt(v.duration_seconds, 10) || 0;
                durationSeconds += ds;
                const vst = v.status == null ? 'unset' : String(v.status).toLowerCase();
                videosByStatus[vst] = (videosByStatus[vst] || 0) + 1;
                return {
                    id: v.id,
                    lessonId: v.lesson_id,
                    lessonTitle: v.lesson_title,
                    lessonOrder: v.lesson_order,
                    title: v.title,
                    order: v.order,
                    status: v.status,
                    sourceType: v.source_type || null,
                    viewCount: vc,
                    durationSeconds: ds,
                    notesCount: n,
                    assignmentsCount: a,
                    createdAt: v.created_at,
                    // videos table has no updated_at; use created_at for API shape
                    updatedAt: v.created_at,
                };
            });

            return {
                id: cr.id,
                title: cr.title,
                status: cr.status || 'active',
                category: cr.category_name || null,
                price: parseFloat(cr.price) || 0,
                discountPrice: cr.discount_price != null ? parseFloat(cr.discount_price) : null,
                currency: cr.currency || 'USD',
                students: parseInt(cr.student_count, 10) || 0,
                rating: parseFloat(cr.rating) || 0,
                reviewCount: parseInt(cr.review_count, 10) || 0,
                createdAt: cr.created_at,
                updatedAt: cr.updated_at,
                lessonsByStatus,
                videosByStatus,
                counts: {
                    lessons: lessonRows.length,
                    videos: videoRows.length,
                    lessonNotes,
                    lessonAssignments,
                    videoNotes,
                    videoAssignments,
                    videoViews,
                    durationSeconds,
                },
                lessons,
                videos,
            };
        });

        return {
            ...teacher,
            courseStatusSummary,
            aggregates,
            courseBreakdown,
        };
    }

    /**
     * Update teacher profile (profile fields only). Does not allow changing users.email or role.
     * @param {string} id - Teacher user id
     * @param {object} payload - Optional name, bio, instituteName, accountEmail, address, youtubeUrl, linkedinUrl
     * @returns {object|null} Updated teacher or null if not found / not a teacher
     */
    async updateTeacher(id, payload) {
        const check = await db.query(
            `SELECT u.id FROM users u
             LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
             WHERE u.id = $1 AND (u.role = 'teacher' OR tp.user_id IS NOT NULL)`,
            [id]
        );
        if (check.rows.length === 0) {
            return null;
        }
        const camelToSnake = { name: 'name', bio: 'bio', instituteName: 'institute_name', accountEmail: 'account_email', address: 'address', youtubeUrl: 'youtube_url', linkedinUrl: 'linkedin_url' };
        const values = [id];
        const setParts = [];
        let idx = 2;
        for (const [camel, snake] of Object.entries(camelToSnake)) {
            if (payload[camel] !== undefined) {
                setParts.push(`${snake} = $${idx}`);
                values.push(payload[camel] === '' ? null : payload[camel]);
                idx++;
            }
        }
        if (setParts.length === 0) {
            return this.getById(id);
        }
        const updateResult = await db.query(
            `UPDATE teacher_profiles SET ${setParts.join(', ')} WHERE user_id = $1`,
            values
        );
        if (updateResult.rowCount === 0) {
            await db.query(
                `INSERT INTO teacher_profiles (user_id, name, bio, institute_name, account_email, address, youtube_url, linkedin_url)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    id,
                    payload.name === undefined ? null : (payload.name === '' ? null : payload.name),
                    payload.bio === undefined ? null : (payload.bio === '' ? null : payload.bio),
                    payload.instituteName === undefined ? null : (payload.instituteName === '' ? null : payload.instituteName),
                    payload.accountEmail === undefined ? null : (payload.accountEmail === '' ? null : payload.accountEmail),
                    payload.address === undefined ? null : (payload.address === '' ? null : payload.address),
                    payload.youtubeUrl === undefined ? null : (payload.youtubeUrl === '' ? null : payload.youtubeUrl),
                    payload.linkedinUrl === undefined ? null : (payload.linkedinUrl === '' ? null : payload.linkedinUrl),
                ]
            );
        }
        return this.getById(id);
    }

    /**
     * Permanently delete a teacher and all associated data.
     * 1. Removes all R2 objects under teachers/{teacherId}/
     * 2. In a DB transaction: removes user_permissions for teacher's videos,
     *    deletes videos owned by teacher, deletes courses (cascade lessons, enrollments, etc.),
     *    then deletes the user (cascade teacher_profiles, reviews, payment methods, etc.).
     * @param {string} teacherId - UUID of the teacher user
     * @throws {Error} If user is not a teacher or not found, or if deletion fails
     */
    async deleteTeacher(teacherId) {
        const check = await db.query(
            `SELECT u.id FROM users u
             LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
             WHERE u.id = $1 AND (u.role = 'teacher' OR tp.user_id IS NOT NULL)`,
            [teacherId]
        );
        if (check.rows.length === 0) {
            throw new Error('Teacher not found');
        }

        const videoIdsResult = await db.query(
            'SELECT id FROM videos WHERE owner_id = $1',
            [teacherId]
        );
        const videoIds = videoIdsResult.rows.map((r) => r.id);
        for (const videoId of videoIds) {
            try {
                await keyStorage.deleteKey(videoId);
            } catch (err) {
                console.warn(`[deleteTeacher] keyStorage.deleteKey(${videoId}):`, err.message);
            }
        }

        const prefix = `teachers/${teacherId}/`;
        if (r2Storage.isConfigured) {
            try {
                await r2Storage.deletePrefix(prefix);
            } catch (err) {
                console.error(`[deleteTeacher] R2 deletePrefix failed for ${prefix}:`, err);
                throw new Error('Failed to remove teacher files from storage. Please try again.');
            }
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `DELETE FROM user_permissions WHERE video_id IN (SELECT id FROM videos WHERE owner_id = $1)`,
                [teacherId]
            );
            await client.query('DELETE FROM videos WHERE owner_id = $1', [teacherId]);
            await client.query('DELETE FROM courses WHERE teacher_id = $1', [teacherId]);
            const userResult = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [teacherId]);
            if (userResult.rowCount === 0) {
                throw new Error('Failed to delete user record');
            }

            await client.query('COMMIT');
            return { message: 'Teacher and all associated data have been permanently removed.' };
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }
}

module.exports = new AdminTeachersService();
