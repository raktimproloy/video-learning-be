/**
 * Periodic job: force-end live sessions that hit the time limit and were not stopped by the teacher
 * within the grace period. Ensures usage (Agora/100ms minutes) is always recorded via endDiscarded.
 * Runs in the same process as the API; for scale, consider a dedicated worker or queue.
 */
const liveSessionService = require('../services/liveSessionService');

const GRACE_MINUTES = Number(process.env.LIVE_FORCE_END_GRACE_MINUTES) || 5;
const INTERVAL_MS = Math.max(60_000, (Number(process.env.LIVE_FORCE_END_JOB_INTERVAL_SECONDS) || 60) * 1000);

let intervalId = null;

function getIo() {
    try {
        return require('../socket').getIo();
    } catch (_) {
        return null;
    }
}

/**
 * Run one pass: find sessions past grace and force-end; emit socket so students see "live ended".
 */
async function run() {
    const io = getIo();
    const ended = await liveSessionService.forceEndExpiredLimitSessions(GRACE_MINUTES);
    for (const { lessonId } of ended) {
        try {
            if (io) {
                io.to(lessonId).emit('liveStatsUpdated', {
                    broadcast_status: 'ended',
                    live_session_id: null,
                    live_started_at: null,
                    live_name: null,
                    live_description: null,
                    viewerCount: 0,
                });
            }
        } catch (err) {
            console.error('liveSessionForceEndJob: emit failed for lesson', lessonId, err);
        }
    }
    if (ended.length > 0) {
        console.log('liveSessionForceEndJob: force-ended', ended.length, 'session(s)');
    }
}

function start() {
    if (intervalId != null) return;
    intervalId = setInterval(run, INTERVAL_MS);
    run().catch((err) => console.error('liveSessionForceEndJob: first run error', err));
}

function stop() {
    if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

module.exports = { start, stop, run };
