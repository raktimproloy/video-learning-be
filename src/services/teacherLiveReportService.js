/**
 * Teacher course-specific live class report.
 * Uses existing data: live_sessions (start/stop), live_watch_records (student join/leave, watch_seconds),
 * live_usage_records (teacher + student minutes per session).
 */
const db = require('../../db');

/**
 * Get live class report for a course owned by the teacher.
 * Includes every ended session (saved or discarded) with start/end, student count, student IDs, minutes.
 * @param {string} teacherId
 * @param {string} courseId
 * @returns {Promise<object>} { courseId, courseTitle, totalLiveSessions, totalTeacherMinutes, totalStudentMinutes, averageStudentsPerSession, sessions: [...] }
 */
async function getCourseLiveReport(teacherId, courseId) {
    const course = await db.query(
        'SELECT id, title FROM courses WHERE id = $1 AND teacher_id = $2',
        [courseId, teacherId]
    ).then(r => r.rows[0]);
    if (!course) return null;

    const sessions = await db.query(
        `SELECT ls.id AS session_id, ls.lesson_id, ls.live_name, ls.started_at, ls.ended_at, ls.status, l.title AS lesson_title
         FROM live_sessions ls
         JOIN lessons l ON l.id = ls.lesson_id
         WHERE ls.course_id = $1 AND ls.owner_id = $2 AND ls.status IN ('saved', 'discarded') AND ls.ended_at IS NOT NULL
         ORDER BY ls.started_at DESC`,
        [courseId, teacherId]
    ).then(r => r.rows);

    const sessionIds = sessions.map(s => s.session_id);
    if (sessionIds.length === 0) {
        return {
            courseId: course.id,
            courseTitle: course.title,
            totalLiveSessions: 0,
            totalTeacherMinutes: 0,
            totalStudentMinutes: 0,
            totalMinutes: 0,
            averageStudentsPerSession: 0,
            sessions: [],
        };
    }

    const usageBySession = await db.query(
        `SELECT lur.live_session_id, lur.user_id, lur.role, lur.minutes_used,
                u.email
         FROM live_usage_records lur
         LEFT JOIN users u ON u.id = lur.user_id
         WHERE lur.live_session_id = ANY($1::uuid[])`,
        [sessionIds]
    ).then(r => r.rows);

    const bySession = {};
    for (const row of usageBySession) {
        const sid = row.live_session_id;
        if (!bySession[sid]) bySession[sid] = { teacherMinutes: 0, students: [] };
        if (row.role === 'teacher') {
            bySession[sid].teacherMinutes = Number(row.minutes_used);
        } else {
            bySession[sid].students.push({
                studentId: row.user_id,
                studentEmail: row.email || null,
                minutesUsed: Number(row.minutes_used),
            });
        }
    }

    let totalTeacherMinutes = 0;
    let totalStudentMinutes = 0;
    const sessionList = sessions.map((s) => {
        const usage = bySession[s.session_id] || { teacherMinutes: 0, students: [] };
        const startedAt = s.started_at;
        const endedAt = s.ended_at;
        const durationMinutes = endedAt && startedAt
            ? Math.max(0, (new Date(endedAt) - new Date(startedAt)) / 60000)
            : 0;
        const studentCount = usage.students.length;
        const teacherMin = usage.teacherMinutes;
        const studentMin = usage.students.reduce((sum, st) => sum + st.minutesUsed, 0);
        totalTeacherMinutes += teacherMin;
        totalStudentMinutes += studentMin;
        return {
            sessionId: s.session_id,
            lessonId: s.lesson_id,
            lessonTitle: s.lesson_title,
            liveName: s.live_name,
            startedAt,
            endedAt,
            durationMinutes: Math.round(durationMinutes * 100) / 100,
            teacherMinutes: Math.round(teacherMin * 100) / 100,
            studentCount,
            studentIds: usage.students.map(st => st.studentId),
            attendees: usage.students.map(st => ({
                studentId: st.studentId,
                studentEmail: st.studentEmail,
                minutesUsed: Math.round(st.minutesUsed * 100) / 100,
            })),
            status: s.status,
        };
    });

    const totalLiveSessions = sessionList.length;
    const averageStudentsPerSession = totalLiveSessions > 0
        ? Math.round((sessionList.reduce((sum, s) => sum + s.studentCount, 0) / totalLiveSessions) * 100) / 100
        : 0;

    return {
        courseId: course.id,
        courseTitle: course.title,
        totalLiveSessions,
        totalTeacherMinutes: Math.round(totalTeacherMinutes * 100) / 100,
        totalStudentMinutes: Math.round(totalStudentMinutes * 100) / 100,
        totalMinutes: Math.round((totalTeacherMinutes + totalStudentMinutes) * 100) / 100,
        averageStudentsPerSession,
        sessions: sessionList,
    };
}

module.exports = { getCourseLiveReport };
