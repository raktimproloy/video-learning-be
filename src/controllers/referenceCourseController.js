const db = require('../../db');
const courseService = require('../services/courseService');

class ReferenceCourseController {
    // Middleware-like function to verify marketer owns this teacher's course
    verifyCourseOwnership = async (marketerId, courseId) => {
        const query = `
            SELECT c.id 
            FROM courses c
            JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
            WHERE c.id = $1 AND tp.referred_by = $2
        `;
        const res = await db.query(query, [courseId, marketerId]);
        return res.rows.length > 0;
    }

    createLesson = async (req, res) => {
        try {
            const marketerId = req.user.id;
            const courseId = req.params.courseId;

            const isOwner = await this.verifyCourseOwnership(marketerId, courseId);
            if (!isOwner) {
                return res.status(403).json({ error: 'You do not have permission to edit this course.' });
            }

            const { title, description, order, isPreview, status: reqStatus, notes, assignments } = req.body;
            const status = reqStatus || 'draft';

            let parsedNotes = [];
            let parsedAssignments = [];
            try { parsedNotes = notes ? (typeof notes === 'string' ? JSON.parse(notes) : notes) : []; } catch (e) {}
            try { parsedAssignments = assignments ? (typeof assignments === 'string' ? JSON.parse(assignments) : assignments) : []; } catch (e) {}

            const result = await db.query(
                `INSERT INTO lessons (course_id, title, description, "order", is_preview, notes, assignments, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [
                    courseId,
                    title || '',
                    description || '',
                    parseInt(order, 10) || 0,
                    isPreview === 'true' || isPreview === true,
                    JSON.stringify(parsedNotes),
                    JSON.stringify(parsedAssignments),
                    status
                ]
            );

            res.status(201).json({ message: 'Lesson created successfully', lesson: result.rows[0] });
        } catch (error) {
            console.error('Reference Lesson Create error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    createVideo = async (req, res) => {
        try {
            const marketerId = req.user.id;
            const courseId = req.params.courseId;

            const isOwner = await this.verifyCourseOwnership(marketerId, courseId);
            if (!isOwner) {
                return res.status(403).json({ error: 'You do not have permission to edit this course.' });
            }

            const { lessonId, title, description, order, isPreview, status, notes, assignments } = req.body;
            if (!lessonId) return res.status(400).json({ error: 'lessonId is required' });

            const courseRes = await db.query('SELECT teacher_id FROM courses WHERE id = $1', [courseId]);
            if (courseRes.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
            const teacherId = courseRes.rows[0].teacher_id;

            let parsedNotes = [];
            let parsedAssignments = [];
            try { parsedNotes = notes ? (typeof notes === 'string' ? JSON.parse(notes) : notes) : []; } catch (e) {}
            try { parsedAssignments = assignments ? (typeof assignments === 'string' ? JSON.parse(assignments) : assignments) : []; } catch (e) {}

            const result = await db.query(
                `INSERT INTO videos (lesson_id, owner_id, title, description, "order", is_preview, notes, assignments, status, source_type, storage_path, signing_secret)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
                [
                    lessonId,
                    teacherId,
                    title || '',
                    description || '',
                    parseInt(order, 10) || 0,
                    isPreview === 'true' || isPreview === true,
                    JSON.stringify(parsedNotes),
                    JSON.stringify(parsedAssignments),
                    status || 'draft',
                    'upload',
                    'pending', // storage_path (dummy value since marketer doesn't upload video)
                    'pending'  // signing_secret (dummy value)
                ]
            );

            res.status(201).json({ message: 'Video created successfully', video: result.rows[0] });
        } catch (error) {
            console.error('Reference Video Create error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    createCourse = async (req, res) => {
        try {
            const marketerId = req.user.id;
            const { teacherId, ...courseData } = req.body;

            if (!teacherId) {
                return res.status(400).json({ error: 'Teacher ID is required' });
            }

            // Verify teacher belongs to this marketer
            const verifyQuery = `
                SELECT user_id FROM teacher_profiles 
                WHERE user_id = $1 AND referred_by = $2
            `;
            const verifyRes = await db.query(verifyQuery, [teacherId, marketerId]);
            if (verifyRes.rows.length === 0) {
                return res.status(403).json({ error: 'You can only create courses for teachers you referred' });
            }

            // Create course using courseService
            const newCourse = await courseService.createCourse(teacherId, courseData);
            res.status(201).json({ message: 'Course created successfully', course: newCourse });
        } catch (error) {
            console.error('Reference Course Create error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    getCourseDetails = async (req, res) => {
        try {
            const marketerId = req.user.id;
            const courseId = req.params.courseId;

            const isOwner = await this.verifyCourseOwnership(marketerId, courseId);
            if (!isOwner) {
                return res.status(403).json({ error: 'You do not have permission to view this course.' });
            }

            // Fetch course
            const courseRes = await db.query('SELECT * FROM courses WHERE id = $1', [courseId]);
            if (courseRes.rows.length === 0) {
                return res.status(404).json({ error: 'Course not found' });
            }
            const course = courseRes.rows[0];

            // Fetch lessons
            const lessonsRes = await db.query('SELECT id, title, description, "order", is_preview FROM lessons WHERE course_id = $1 ORDER BY "order" ASC, created_at ASC', [courseId]);
            
            // Fetch videos
            const videosRes = await db.query('SELECT v.id, v.lesson_id, v.title, v."order", v.is_preview FROM videos v JOIN lessons l ON v.lesson_id = l.id WHERE l.course_id = $1 ORDER BY v."order" ASC, v.created_at ASC', [courseId]);

            // Combine
            course.lessons = lessonsRes.rows.map(lesson => ({
                ...lesson,
                videos: videosRes.rows.filter(v => String(v.lesson_id) === String(lesson.id))
            }));

            res.json(course);
        } catch (error) {
            console.error('Reference Course Details error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    updateCourse = async (req, res) => {
        try {
            const marketerId = req.user.id;
            const courseId = req.params.courseId;

            const isOwner = await this.verifyCourseOwnership(marketerId, courseId);
            if (!isOwner) {
                return res.status(403).json({ error: 'You do not have permission to edit this course.' });
            }

            // Allowed fields to update
            const updateData = {
                title: req.body.title,
                shortDescription: req.body.shortDescription,
                fullDescription: req.body.fullDescription,
                price: req.body.price,
                discountPrice: req.body.discountPrice,
                category: req.body.category,
                subcategory: req.body.subcategory,
                tags: req.body.tags,
                level: req.body.level,
                language: req.body.language,
                subtitle: req.body.subtitle,
                hasLiveClass: req.body.hasLiveClass,
                hasAssignments: req.body.hasAssignments,
                status: req.body.status
            };

            // Remove undefined fields
            Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

            const updatedCourse = await courseService.updateCourse(courseId, updateData);
            res.json({ message: 'Course updated successfully', course: updatedCourse });
        } catch (error) {
            console.error('Reference Course Update error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    updateLesson = async (req, res) => {
        try {
            const marketerId = req.user.id;
            const courseId = req.params.courseId;
            const lessonId = req.params.lessonId;

            const isOwner = await this.verifyCourseOwnership(marketerId, courseId);
            if (!isOwner) {
                return res.status(403).json({ error: 'You do not have permission to edit this lesson.' });
            }

            const { title, description, order, isPreview, status, notes, assignments } = req.body;
            
            let updateQuery = 'UPDATE lessons SET updated_at = NOW()';
            const queryParams = [];
            let paramIndex = 1;

            if (title !== undefined) {
                updateQuery += `, title = $${paramIndex}`;
                queryParams.push(title);
                paramIndex++;
            }
            if (description !== undefined) {
                updateQuery += `, description = $${paramIndex}`;
                queryParams.push(description);
                paramIndex++;
            }
            if (order !== undefined) {
                updateQuery += `, "order" = $${paramIndex}`;
                queryParams.push(parseInt(order, 10) || 0);
                paramIndex++;
            }
            if (isPreview !== undefined) {
                updateQuery += `, is_preview = $${paramIndex}`;
                queryParams.push(isPreview === 'true' || isPreview === true);
                paramIndex++;
            }
            if (status !== undefined) {
                updateQuery += `, status = $${paramIndex}`;
                queryParams.push(status);
                paramIndex++;
            }
            if (notes !== undefined) {
                let parsedNotes = [];
                try { parsedNotes = typeof notes === 'string' ? JSON.parse(notes) : notes; } catch (e) {}
                updateQuery += `, notes = $${paramIndex}`;
                queryParams.push(JSON.stringify(parsedNotes));
                paramIndex++;
            }
            if (assignments !== undefined) {
                let parsedAssignments = [];
                try { parsedAssignments = typeof assignments === 'string' ? JSON.parse(assignments) : assignments; } catch (e) {}
                updateQuery += `, assignments = $${paramIndex}`;
                queryParams.push(JSON.stringify(parsedAssignments));
                paramIndex++;
            }

            updateQuery += ` WHERE id = $${paramIndex} AND course_id = $${paramIndex + 1} RETURNING *`;
            queryParams.push(lessonId, courseId);

            const result = await db.query(updateQuery, queryParams);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Lesson not found in this course' });
            }

            res.json({ message: 'Lesson updated successfully', lesson: result.rows[0] });
        } catch (error) {
            console.error('Reference Lesson Update error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    updateVideo = async (req, res) => {
        try {
            const marketerId = req.user.id;
            const courseId = req.params.courseId;
            const videoId = req.params.videoId;

            const isOwner = await this.verifyCourseOwnership(marketerId, courseId);
            if (!isOwner) {
                return res.status(403).json({ error: 'You do not have permission to edit this video.' });
            }

            const { title, description, order, isPreview, status, notes, assignments } = req.body;
            
            let updateQuery = 'UPDATE videos SET ';
            const queryParams = [];
            let paramIndex = 1;

            const updates = [];
            if (title !== undefined) {
                updates.push(`title = $${paramIndex}`);
                queryParams.push(title);
                paramIndex++;
            }
            if (description !== undefined) {
                updates.push(`description = $${paramIndex}`);
                queryParams.push(description);
                paramIndex++;
            }
            if (order !== undefined) {
                updates.push(`"order" = $${paramIndex}`);
                queryParams.push(parseInt(order, 10) || 0);
                paramIndex++;
            }
            if (isPreview !== undefined) {
                updates.push(`is_preview = $${paramIndex}`);
                queryParams.push(isPreview === 'true' || isPreview === true);
                paramIndex++;
            }
            if (status !== undefined) {
                updates.push(`status = $${paramIndex}`);
                queryParams.push(status);
                paramIndex++;
            }
            if (notes !== undefined) {
                let parsedNotes = [];
                try { parsedNotes = typeof notes === 'string' ? JSON.parse(notes) : notes; } catch (e) {}
                updates.push(`notes = $${paramIndex}`);
                queryParams.push(JSON.stringify(parsedNotes));
                paramIndex++;
            }
            if (assignments !== undefined) {
                let parsedAssignments = [];
                try { parsedAssignments = typeof assignments === 'string' ? JSON.parse(assignments) : assignments; } catch (e) {}
                updates.push(`assignments = $${paramIndex}`);
                queryParams.push(JSON.stringify(parsedAssignments));
                paramIndex++;
            }

            if (updates.length === 0) {
                return res.status(400).json({ error: 'No fields provided to update' });
            }

            updateQuery += updates.join(', ');
            updateQuery += ` WHERE id = $${paramIndex} RETURNING *`;
            queryParams.push(videoId);

            // Need to verify this video actually belongs to this course
            const verifyVideoQuery = `
                SELECT v.id FROM videos v
                JOIN lessons l ON v.lesson_id = l.id
                WHERE v.id = $1 AND l.course_id = $2
            `;
            const verifyRes = await db.query(verifyVideoQuery, [videoId, courseId]);
            if (verifyRes.rows.length === 0) {
                return res.status(404).json({ error: 'Video not found in this course' });
            }

            const result = await db.query(updateQuery, queryParams);
            res.json({ message: 'Video updated successfully', video: result.rows[0] });
        } catch (error) {
            console.error('Reference Video Update error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new ReferenceCourseController();
