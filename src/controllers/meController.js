const db = require('../../db');
const userService = require('../services/userService');
const cache = require('../utils/ttlCache');
const { bootstrapCacheKey } = require('../utils/bootstrapCache');

/**
 * GET /v1/me/bootstrap
 * Lightweight bootstrap data for authenticated users to reduce initial page load calls.
 */
async function getBootstrap(req, res) {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const user = await userService.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Staff permissions must always be fresh (owner may have just changed them).
        const isStaff = (user.role || '') === 'teacher_staff';
        const ttlMs = isStaff ? 0 : 60 * 1000;
        const key = bootstrapCacheKey(userId);

        const load = async () => {
            const base = {
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role || 'student',
                    linkedGoogle: !!user.google_id,
                    coreMember: !!user.core_member,
                    mustChangePassword: !!user.must_change_password,
                    name: user.name || null,
                },
            };

            const teacherProfile = await userService.getTeacherProfile(userId);
            if (teacherProfile) {
                base.user.teacherProfile = {
                    name: teacherProfile.name,
                    bio: teacherProfile.bio,
                    location: teacherProfile.location,
                    avatar: teacherProfile.avatar,
                    specialization: typeof teacherProfile.specialization === 'string'
                        ? JSON.parse(teacherProfile.specialization)
                        : (teacherProfile.specialization || []),
                    experience: teacherProfile.experience,
                    certifications: typeof teacherProfile.certifications === 'string'
                        ? JSON.parse(teacherProfile.certifications)
                        : (teacherProfile.certifications || []),
                    created_at: teacherProfile.created_at,
                    updated_at: teacherProfile.updated_at,
                };
            }

            if ((user.role || 'student') === 'teacher') {
                const ownedRes = await db.query(
                    'SELECT id FROM courses WHERE teacher_id = $1 ORDER BY created_at DESC',
                    [userId]
                );
                const ownedCourseIds = ownedRes.rows.map((r) => r.id);
                return {
                    ...base,
                    teacher: {
                        ownedCourseIds,
                        totalOwnedCourses: ownedCourseIds.length,
                        isOwner: true,
                        teacherId: userId,
                        permissions: null,
                    },
                };
            }

            if (isStaff) {
                const teacherStaffService = require('../services/teacherStaffService');
                const membership = await teacherStaffService.getActiveMembershipByStaffUserId(userId);
                if (!membership) {
                    return {
                        ...base,
                        teacherStaff: { disabled: true },
                    };
                }
                const ownedRes = await db.query(
                    'SELECT id FROM courses WHERE teacher_id = $1 ORDER BY created_at DESC',
                    [membership.teacher_id]
                );
                const ownedCourseIds = ownedRes.rows.map((r) => r.id);
                const ownerProfile = await userService.getTeacherProfile(membership.teacher_id);
                return {
                    ...base,
                    teacher: {
                        ownedCourseIds,
                        totalOwnedCourses: ownedCourseIds.length,
                        isOwner: false,
                        teacherId: membership.teacher_id,
                        permissions: membership.permissions,
                        displayName: membership.display_name,
                        ownerName: ownerProfile?.name || null,
                    },
                    teacherStaff: {
                        teacherId: membership.teacher_id,
                        permissions: membership.permissions,
                        displayName: membership.display_name,
                        status: membership.status,
                    },
                };
            }

            const enrolledRes = await db.query(
                'SELECT course_id FROM course_enrollments WHERE user_id = $1',
                [userId]
            );
            const courseIds = enrolledRes.rows.map((r) => r.course_id);

            const totalCourses = courseIds.length;
            if (totalCourses === 0) {
                return {
                    ...base,
                    student: {
                        enrolledCourseIds: [],
                        progressSummary: {
                            totalCourses: 0,
                            totalWatchSeconds: 0,
                            totalWatchHours: 0,
                            overallCompletionPercentage: 0,
                        },
                    },
                };
            }

            const totalWatchResult = await db.query(
                `SELECT COALESCE(SUM(total_watch_seconds), 0)::float as total
                 FROM video_watch_progress WHERE user_id = $1 AND course_id = ANY($2::uuid[])`,
                [userId, courseIds]
            );
            const totalWatchSeconds = parseFloat(totalWatchResult.rows[0]?.total) || 0;

            const totalDurationResult = await db.query(
                `SELECT COALESCE(SUM(v.duration_seconds), 0)::float as total
                 FROM videos v
                 JOIN lessons l ON l.id = v.lesson_id
                 JOIN course_enrollments ce ON ce.course_id = l.course_id AND ce.user_id = $1
                 WHERE (v.status IS NULL OR v.status = 'active')`,
                [userId]
            );
            const totalDurationSeconds = parseFloat(totalDurationResult.rows[0]?.total) || 0;

            const effectiveResult = await db.query(
                `SELECT COALESCE(SUM(LEAST(p.max_watched_seconds, p.total_watch_seconds)), 0)::float as total
                 FROM video_watch_progress p
                 JOIN videos v ON v.id = p.video_id
                 WHERE p.user_id = $1 AND p.course_id = ANY($2::uuid[]) AND (v.status IS NULL OR v.status = 'active')`,
                [userId, courseIds]
            );
            const totalEffectiveSeconds = parseFloat(effectiveResult.rows[0]?.total) || 0;

            const overallCompletionPercentage = totalDurationSeconds > 0
                ? Math.min(100, Math.round((totalEffectiveSeconds / totalDurationSeconds) * 100))
                : 0;

            return {
                ...base,
                student: {
                    enrolledCourseIds: courseIds,
                    progressSummary: {
                        totalCourses,
                        totalWatchSeconds,
                        totalWatchHours: Math.round((totalWatchSeconds / 3600) * 100) / 100,
                        overallCompletionPercentage,
                    },
                },
            };
        };

        const body = ttlMs > 0 ? await cache.getOrSet(key, ttlMs, load) : await load();

        res.set('Cache-Control', isStaff ? 'private, no-store' : 'private, max-age=30');
        return res.json(body);
    } catch (error) {
        if (error && error.status === 404) {
            return res.status(404).json({ error: 'User not found' });
        }
        console.error('Get bootstrap error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { getBootstrap };
