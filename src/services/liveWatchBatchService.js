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
                         SET watch_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER)
                         WHERE lesson_id = $1 AND student_id = $2 AND left_at IS NULL`,
                        [lessonId, studentId],
                    ),
                );
            }
            await Promise.all(queries);
        }, LIVE_HEARTBEAT_BATCH_MS);
    }
    return liveHeartbeatBatcher;
}

async function recordLiveHeartbeat(lessonId, studentId) {
    const batcher = getLiveHeartbeatBatcher();
    if (!batcher) {
        const r = await db.query(
            `UPDATE live_watch_records
             SET watch_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER)
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

async function shutdownLiveHeartbeatBatch() {
    if (liveHeartbeatBatcher) {
        await liveHeartbeatBatcher.flush().catch(() => {});
        liveHeartbeatBatcher.shutdown();
    }
}

module.exports = { recordLiveHeartbeat, shutdownLiveHeartbeatBatch };
