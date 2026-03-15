const db = require('../../db');
const r2Storage = require('./r2StorageService');
const keyStorage = require('./keyStorageService');

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
