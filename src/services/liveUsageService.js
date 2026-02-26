/**
 * Live usage tracking: minutes per provider, per teacher, per student.
 * When a new class starts, the system picks a provider that has free minutes; if none, uses AWS IVS.
 * Ongoing classes are never ended when a limit is reached.
 */
const db = require('../../db');

const PROVIDERS = ['agora', '100ms', 'youtube', 'aws_ivs'];

/**
 * Record usage for a completed live session. Call when session ends (endDiscarded or markSaved).
 * Inserts one row per participant: teacher (session duration) and each student (watch_seconds).
 * Idempotent: skips if usage already recorded for this session.
 */
async function recordUsageForSession(liveSessionId) {
    const session = await db.query(
        'SELECT id, provider, owner_id, started_at, ended_at FROM live_sessions WHERE id = $1',
        [liveSessionId]
    ).then(r => r.rows[0]);
    if (!session || !session.ended_at) return;

    const existing = await db.query(
        'SELECT 1 FROM live_usage_records WHERE live_session_id = $1 LIMIT 1',
        [liveSessionId]
    ).then(r => r.rows[0]);
    if (existing) return;

    const provider = PROVIDERS.includes(session.provider) ? session.provider : 'agora';
    const startedAt = session.started_at;
    const endedAt = session.ended_at;
    const teacherMinutes = Math.max(0, (new Date(endedAt) - new Date(startedAt)) / 60000);

    await db.query(
        `INSERT INTO live_usage_records (live_session_id, provider, user_id, role, minutes_used, session_started_at, session_ended_at)
         VALUES ($1, $2, $3, 'teacher', $4, $5, $6)`,
        [liveSessionId, provider, session.owner_id, teacherMinutes, startedAt, endedAt]
    );

    const students = await db.query(
        `SELECT student_id, SUM(watch_seconds)::int AS total_seconds
         FROM live_watch_records WHERE live_session_id = $1 GROUP BY student_id`,
        [liveSessionId]
    ).then(r => r.rows);

    for (const row of students) {
        const minutes = Math.max(0, (row.total_seconds || 0) / 60);
        if (minutes <= 0) continue;
        await db.query(
            `INSERT INTO live_usage_records (live_session_id, provider, user_id, role, minutes_used, session_started_at, session_ended_at)
             VALUES ($1, $2, $3, 'student', $4, $5, $6)`,
            [liveSessionId, provider, row.student_id, minutes, startedAt, endedAt]
        );
    }
}

/**
 * Total minutes used for a provider (all time).
 */
async function getUsedMinutesByProvider(provider) {
    const r = await db.query(
        'SELECT COALESCE(SUM(minutes_used), 0)::numeric AS total FROM live_usage_records WHERE provider = $1',
        [provider]
    );
    return Number(r.rows[0]?.total ?? 0);
}

/**
 * Remaining free minutes for a provider (cap - used). Fallback-only providers (e.g. aws_ivs) return 0 for "remaining".
 */
async function getRemainingMinutes(provider) {
    const pkg = await db.query(
        'SELECT free_minutes_cap, is_fallback_only FROM live_provider_packages WHERE provider = $1',
        [provider]
    ).then(r => r.rows[0]);
    if (!pkg || pkg.is_fallback_only) return 0;
    const used = await getUsedMinutesByProvider(provider);
    return Math.max(0, Number(pkg.free_minutes_cap) - used);
}

/**
 * Get provider to use for a new live class: first enabled provider with remaining free minutes (by display_order), else 'aws_ivs'.
 * Does not end or affect any ongoing class.
 * @param {object} liveSettings - from adminSettingsService.getLiveSettings(): { agoraEnabled, hundredMsEnabled, youtubeEnabled, awsIvsEnabled }
 * @returns {{ provider: string }}
 */
async function getProviderWithFreeMinutes(liveSettings = {}) {
    const enabled = (key) => liveSettings[key] === true;
    const packages = await db.query(
        `SELECT provider, free_minutes_cap, display_order, is_fallback_only
         FROM live_provider_packages
         WHERE is_fallback_only = false
         ORDER BY display_order ASC, provider ASC`
    ).then(r => r.rows);

    const providerEnabled = {
        agora: enabled('agoraEnabled'),
        '100ms': enabled('hundredMsEnabled'),
        youtube: enabled('youtubeEnabled'),
    };

    for (const pkg of packages) {
        if (!providerEnabled[pkg.provider]) continue;
        const remaining = await getRemainingMinutes(pkg.provider);
        if (remaining > 0) return { provider: pkg.provider };
    }

    return { provider: 'aws_ivs' };
}

/**
 * List provider packages (cap, used, remaining, is_fallback_only).
 */
async function getProviderPackages() {
    const rows = await db.query(
        `SELECT p.provider, p.free_minutes_cap, p.display_order, p.is_fallback_only
         FROM live_provider_packages p
         ORDER BY p.display_order, p.provider`
    ).then(r => r.rows);
    const used = await db.query(
        'SELECT provider, COALESCE(SUM(minutes_used), 0)::numeric AS total FROM live_usage_records GROUP BY provider'
    ).then(r => Object.fromEntries(r.rows.map(x => [x.provider, Number(x.total)])));
    return rows.map(p => ({
        provider: p.provider,
        freeMinutesCap: Number(p.free_minutes_cap),
        usedMinutes: used[p.provider] ?? 0,
        remainingMinutes: p.is_fallback_only ? 0 : Math.max(0, Number(p.free_minutes_cap) - (used[p.provider] ?? 0)),
        displayOrder: p.display_order,
        isFallbackOnly: p.is_fallback_only,
    }));
}

/**
 * Update a provider's free minute cap (admin).
 */
async function updateProviderPackage(provider, freeMinutesCap) {
    await db.query(
        'UPDATE live_provider_packages SET free_minutes_cap = $1, updated_at = NOW() WHERE provider = $2',
        [Math.max(0, Number(freeMinutesCap)), provider]
    );
}

/**
 * Usage report: by provider, by teacher, by student.
 */
async function getUsageReport() {
    const byProvider = await db.query(
        `SELECT provider, role, COUNT(DISTINCT user_id)::int AS participant_count, COALESCE(SUM(minutes_used), 0)::numeric AS total_minutes
         FROM live_usage_records GROUP BY provider, role`
    ).then(r => r.rows);
    const byTeacher = await db.query(
        `SELECT lur.user_id AS teacher_id, u.email AS teacher_email, lur.provider,
                COALESCE(SUM(lur.minutes_used), 0)::numeric AS total_minutes,
                COUNT(DISTINCT lur.live_session_id)::int AS session_count
         FROM live_usage_records lur
         LEFT JOIN users u ON u.id = lur.user_id
         WHERE lur.role = 'teacher' GROUP BY lur.user_id, u.email, lur.provider`
    ).then(r => r.rows);
    const byStudent = await db.query(
        `SELECT lur.user_id AS student_id, u.email AS student_email, lur.provider,
                COALESCE(SUM(lur.minutes_used), 0)::numeric AS total_minutes,
                COUNT(DISTINCT lur.live_session_id)::int AS session_count
         FROM live_usage_records lur
         LEFT JOIN users u ON u.id = lur.user_id
         WHERE lur.role = 'student' GROUP BY lur.user_id, u.email, lur.provider`
    ).then(r => r.rows);
    const totals = await db.query(
        `SELECT COALESCE(SUM(minutes_used), 0)::numeric AS total_minutes, COUNT(DISTINCT live_session_id)::int AS total_sessions
         FROM live_usage_records`
    ).then(r => r.rows[0] || {});

    return {
        byProvider: byProvider.map(r => ({
            provider: r.provider,
            role: r.role,
            participantCount: r.participant_count,
            totalMinutes: Number(r.total_minutes),
        })),
        byTeacher: byTeacher.map(r => ({
            teacherId: r.teacher_id,
            teacherEmail: r.teacher_email || null,
            provider: r.provider,
            totalMinutes: Number(r.total_minutes),
            sessionCount: r.session_count,
        })),
        byStudent: byStudent.map(r => ({
            studentId: r.student_id,
            studentEmail: r.student_email || null,
            provider: r.provider,
            totalMinutes: Number(r.total_minutes),
            sessionCount: r.session_count,
        })),
        totalMinutes: Number(totals.total_minutes || 0),
        totalSessions: Number(totals.total_sessions || 0),
    };
}

module.exports = {
    recordUsageForSession,
    getUsedMinutesByProvider,
    getRemainingMinutes,
    getProviderWithFreeMinutes,
    getProviderPackages,
    updateProviderPackage,
    getUsageReport,
    PROVIDERS,
};
