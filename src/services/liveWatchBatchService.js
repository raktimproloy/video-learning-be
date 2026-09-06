const db = require('../../db');
const WriteBatcher = require('../utils/writeBatcher');

const LIVE_HEARTBEAT_BATCH_MS = parseInt(process.env.LIVE_HEARTBEAT_BATCH_MS || '15000', 10);

/** @type {WriteBatcher | null} */
let liveHeartbeatBatcher = null;

function getLiveHeartbeatBatcher() {
    if (LIVE_HEARTBEAT_BATCH_MS <= 0) return null;
    if (!liveHeartbeatBatcher) {
        liveHeartbeatBatcher = new WriteBatcher(async (batch) => {
            const queries = [];
            for (const [key, entry] of batch) {
                const { lessonId, studentId } = entry;
                queries.push(
                    db.query(
                        `UPDATE live_watch_records
                         SET watch_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER),
                             last_heartbeat_at = NOW()
                         WHERE lesson_id = $1 AND student_id = $2 AND left_at IS NULL`,
                        [lessonId, studentId],
                    ),
                );
            }
            await Promise.all(queries);
            // After batch update, clean up dead watchers
            await cleanupDeadWatchers();
        }, LIVE_HEARTBEAT_BATCH_MS);
    }
    return liveHeartbeatBatcher;
}

async function recordLiveHeartbeat(lessonId, studentId) {
    const batcher = getLiveHeartbeatBatcher();
    if (!batcher) {
        const r = await db.query(
            `UPDATE live_watch_records
             SET watch_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER),
                 last_heartbeat_at = NOW()
             WHERE lesson_id = $1 AND student_id = $2 AND left_at IS NULL
             RETURNING *`,
            [lessonId, studentId],
        );
        return r.rows[0];
    }
    const key = `${lessonId}:${studentId}`;
    batcher.enqueue(key, { lessonId, studentId }, (_e, incoming) => incoming, { lessonId, studentId });
    return { ok: true, batched: true };
}

async function cleanupDeadWatchers() {
    try {
        const result = await db.query(
            `UPDATE live_watch_records
             SET left_at = NOW()
             WHERE left_at IS NULL AND last_heartbeat_at < NOW() - INTERVAL '45 seconds'
             RETURNING lesson_id, live_session_id`
        );
        if (result.rows.length > 0) {
            // Group by lesson_id to broadcast stats
            const updatedLessons = [...new Set(result.rows.map(r => r.lesson_id))];
            const liveStatsBroadcast = require('./liveStatsBroadcastService');
            const liveWatchService = require('./liveWatchService');
            const liveSessionService = require('./liveSessionService');
            
            for (const lessonId of updatedLessons) {
                try {
                    const session = await liveSessionService.getActiveByLesson(lessonId);
                    const viewerCount = await liveWatchService.getViewerCount(lessonId, null, session?.id);
                    // Broadcast updated viewer count to the room
                    liveStatsBroadcast.broadcastLiveStats(lessonId, { viewerCount }, { force: true });
                } catch (err) {
                    console.error('Failed to broadcast after cleanup:', err);
                }
            }
        }
    } catch (err) {
        console.error('cleanupDeadWatchers error:', err);
    }
}

// Run cleanup periodically even if no heartbeats are coming in
setInterval(cleanupDeadWatchers, 30000).unref?.();

async function shutdownLiveHeartbeatBatch() {
    if (liveHeartbeatBatcher) {
        await liveHeartbeatBatcher.flush().catch(() => {});
        liveHeartbeatBatcher.shutdown();
    }
}

module.exports = { recordLiveHeartbeat, shutdownLiveHeartbeatBatch };
