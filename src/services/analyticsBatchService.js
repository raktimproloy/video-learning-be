const db = require('../../db');
const WriteBatcher = require('../utils/writeBatcher');

const ANALYTICS_BATCH_MS = parseInt(process.env.ANALYTICS_BATCH_MS || '30000', 10);

/** @type {WriteBatcher | null} */
let heartbeatBatcher = null;

function getHeartbeatBatcher() {
    if (ANALYTICS_BATCH_MS <= 0) return null;
    if (!heartbeatBatcher) {
        heartbeatBatcher = new WriteBatcher(async (batch) => {
            const queries = [];
            for (const [viewId, duration] of batch) {
                if (!viewId || !duration) continue;
                queries.push(
                    db.query(
                        `UPDATE page_views
                         SET duration_seconds = duration_seconds + $2, updated_at = NOW()
                         WHERE id = $1`,
                        [viewId, duration],
                    ),
                );
            }
            await Promise.all(queries);
        }, ANALYTICS_BATCH_MS);
    }
    return heartbeatBatcher;
}

/**
 * Queue heartbeat duration update (batched) or write immediately when batching disabled.
 * @param {string} viewId
 * @param {number} durationSec
 */
async function recordHeartbeat(viewId, durationSec) {
    const batcher = getHeartbeatBatcher();
    if (!batcher) {
        await db.query(
            `UPDATE page_views
             SET duration_seconds = duration_seconds + $2, updated_at = NOW()
             WHERE id = $1`,
            [viewId, durationSec],
        );
        return;
    }
    batcher.enqueue(
        viewId,
        0,
        (existing, incoming) => (Number(existing) || 0) + (Number(incoming) || 0),
        durationSec,
    );
}

async function shutdownAnalyticsBatch() {
    if (heartbeatBatcher) {
        await heartbeatBatcher.flush().catch(() => {});
        heartbeatBatcher.shutdown();
    }
}

module.exports = { recordHeartbeat, shutdownAnalyticsBatch, getHeartbeatBatcher };
