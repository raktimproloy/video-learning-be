const db = require('../../db');

class BundleService {
    async create(teacherId, { title, description, mainPrice, discountPrice, currency, courseIds }) {
        if (!courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
            throw new Error('At least one course is required');
        }
        const check = await db.query(
            'SELECT id FROM courses WHERE teacher_id = $1 AND id = ANY($2::uuid[])',
            [teacherId, courseIds]
        );
        if (check.rows.length !== courseIds.length) {
            throw new Error('All courses must be yours');
        }
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            const bundleResult = await client.query(
                `INSERT INTO course_bundles (teacher_id, title, description, main_price, discount_price, currency)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [
                    teacherId,
                    title || 'Untitled Bundle',
                    description || '',
                    parseFloat(mainPrice) || 0,
                    discountPrice != null && discountPrice !== '' ? parseFloat(discountPrice) : null,
                    currency || 'USD',
                ]
            );
            const bundle = bundleResult.rows[0];
            for (const courseId of courseIds) {
                await client.query(
                    'INSERT INTO bundle_courses (bundle_id, course_id) VALUES ($1, $2)',
                    [bundle.id, courseId]
                );
            }
            await client.query('COMMIT');
            return this.getById(bundle.id, teacherId);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async getById(bundleId, teacherId = null) {
        const result = await db.query(
            `SELECT b.*,
                    COALESCE(
                        (SELECT json_agg(json_build_object('id', c.id, 'title', c.title, 'price', COALESCE(c.discount_price, c.price)))
                         FROM bundle_courses bc
                         JOIN courses c ON c.id = bc.course_id
                         WHERE bc.bundle_id = b.id),
                        '[]'::json
                    ) as courses
             FROM course_bundles b
             WHERE b.id = $1 ${teacherId ? 'AND b.teacher_id = $2' : ''}`,
            teacherId ? [bundleId, teacherId] : [bundleId]
        );
        const row = result.rows[0];
        if (!row) return null;
        let courses = row.courses;
        if (typeof courses === 'string') {
            try {
                courses = JSON.parse(courses);
            } catch (e) {
                courses = [];
            }
        }
        if (!Array.isArray(courses)) courses = [];
        return {
            id: row.id,
            teacher_id: row.teacher_id,
            title: row.title,
            description: row.description || '',
            main_price: parseFloat(row.main_price) || 0,
            discount_price: row.discount_price != null ? parseFloat(row.discount_price) : null,
            currency: row.currency || 'USD',
            created_at: row.created_at,
            updated_at: row.updated_at,
            courses,
        };
    }

    async getByTeacher(teacherId) {
        const result = await db.query(
            `SELECT b.id, b.title, b.description, b.main_price, b.discount_price, b.currency, b.created_at, b.updated_at,
                    (SELECT COUNT(*)::int FROM bundle_courses WHERE bundle_id = b.id) as course_count,
                    (SELECT json_agg(c.id) FROM bundle_courses bc JOIN courses c ON c.id = bc.course_id WHERE bc.bundle_id = b.id) as course_ids
             FROM course_bundles b
             WHERE b.teacher_id = $1
             ORDER BY b.updated_at DESC`,
            [teacherId]
        );
        return result.rows.map(row => {
            let courseIds = row.course_ids;
            if (typeof courseIds === 'string') {
                try {
                    courseIds = JSON.parse(courseIds);
                } catch (e) {
                    courseIds = [];
                }
            }
            if (!Array.isArray(courseIds)) courseIds = [];
            return {
                id: row.id,
                teacher_id: row.teacher_id,
                title: row.title,
                description: row.description || '',
                main_price: parseFloat(row.main_price) || 0,
                discount_price: row.discount_price != null ? parseFloat(row.discount_price) : null,
                currency: row.currency || 'USD',
                created_at: row.created_at,
                updated_at: row.updated_at,
                course_count: row.course_count || 0,
                course_ids: courseIds,
            };
        });
    }

    async update(teacherId, bundleId, { title, description, mainPrice, discountPrice, currency }) {
        const result = await db.query(
            `UPDATE course_bundles
             SET title = COALESCE(NULLIF(TRIM($2), ''), title),
                 description = COALESCE($3, description),
                 main_price = COALESCE($4, main_price),
                 discount_price = $5,
                 currency = COALESCE($6, currency),
                 updated_at = NOW()
             WHERE id = $1 AND teacher_id = $7
             RETURNING *`,
            [
                bundleId,
                title,
                description,
                mainPrice != null && mainPrice !== '' ? parseFloat(mainPrice) : null,
                discountPrice != null && discountPrice !== '' ? parseFloat(discountPrice) : null,
                currency,
                teacherId,
            ]
        );
        if (!result.rows[0]) return null;
        return this.getById(bundleId, teacherId);
    }

    async delete(teacherId, bundleId) {
        const result = await db.query(
            'DELETE FROM course_bundles WHERE id = $1 AND teacher_id = $2 RETURNING id',
            [bundleId, teacherId]
        );
        return result.rowCount > 0;
    }
}

module.exports = new BundleService();
