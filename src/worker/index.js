const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const db = require('../../db');
const videoProcessor = require('./videoProcessor');
const errorLogService = require('../services/errorLogService');

// Worker runs in the same process as the API. videoProcessor uses a fast FFmpeg preset
// and limits encoder threads so the API stays responsive during encoding.

const workerIndex = process.env.WORKER_INDEX || '1';

/**
 * Watchdog: On worker startup, reset any tasks that are stuck in 'processing' state
 * for more than 2 hours. This handles server restarts and FFmpeg crashes.
 */
async function resetStuckTasks() {
    try {
        const result = await db.query(`
            UPDATE video_processing_tasks
            SET status = 'failed',
                error_message = 'Processing timed out (server restart or crash). Please retry.',
                processing_stage = NULL,
                updated_at = NOW()
            WHERE status = 'processing'
              AND started_at IS NOT NULL
              AND started_at < NOW() - INTERVAL '2 hours'
            RETURNING id, video_id
        `);
        if (result.rows.length > 0) {
            console.log(`[Worker #${workerIndex}] [Watchdog] Reset ${result.rows.length} stuck task(s):`, result.rows.map(r => r.id).join(', '));
            // Log each stuck task failure to error logs
            for (const row of result.rows) {
                await errorLogService.logSystemError(
                    `Video Processing: Stuck Task Reset`,
                    new Error(`Task was stuck in 'processing' state for >2h (video_id: ${row.video_id})`),
                    { taskId: row.id, videoId: row.video_id, reason: 'watchdog_reset' }
                ).catch(() => {});
            }
        } else {
            console.log(`[Worker #${workerIndex}] [Watchdog] No stuck tasks found.`);
        }

        // Also handle tasks stuck WITHOUT started_at (status=processing but started_at is null)
        // These were picked up by an old worker before started_at column existed
        const oldResult = await db.query(`
            UPDATE video_processing_tasks
            SET status = 'failed',
                error_message = 'Processing timed out (legacy stuck task). Please retry.',
                processing_stage = NULL,
                updated_at = NOW()
            WHERE status = 'processing'
              AND started_at IS NULL
              AND updated_at < NOW() - INTERVAL '2 hours'
            RETURNING id, video_id
        `);
        if (oldResult.rows.length > 0) {
            console.log(`[Worker #${workerIndex}] [Watchdog] Reset ${oldResult.rows.length} legacy stuck task(s)`);
        }
    } catch (err) {
        console.error(`[Worker #${workerIndex}] [Watchdog] Error resetting stuck tasks:`, err.message);
    }
}

async function startWorker() {
    console.log(`Video Processing Worker #${workerIndex} started...`);

    // Run watchdog on startup to clean up any tasks stuck from previous runs
    await resetStuckTasks();

    while (true) {
        try {
            // Yield to event loop so API can handle requests (worker runs in same process as server)
            await new Promise(r => setImmediate(r));

            // 1. Fetch pending task
            // Use FOR UPDATE SKIP LOCKED to allow multiple workers
            const result = await db.query(
                `UPDATE video_processing_tasks 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = (
                     SELECT id FROM video_processing_tasks 
                     WHERE status = 'pending' 
                     ORDER BY created_at ASC 
                     LIMIT 1 
                     FOR UPDATE SKIP LOCKED
                 ) 
                 RETURNING *`
            );

            if (result.rows.length > 0) {
                const task = result.rows[0];
                console.log(`[Worker #${workerIndex}] Picked up task ${task.id}`);
                try {
                    await videoProcessor.processTask(task);
                } catch (taskErr) {
                    // If processTask throws (shouldn't happen — it has its own catch), mark task failed
                    console.error(`[Worker #${workerIndex}] Unexpected error processing task ${task.id}:`, taskErr.message);
                    await db.query(
                        `UPDATE video_processing_tasks
                         SET status = 'failed', error_message = $1, processing_stage = NULL, updated_at = NOW()
                         WHERE id = $2 AND status != 'completed' AND status != 'failed'`,
                        [`Unexpected worker error: ${taskErr.message}`, task.id]
                    ).catch(() => {});
                    await errorLogService.logWorkerError(taskErr, {
                        taskId: task.id,
                        videoId: task.video_id,
                        stage: 'worker-loop',
                    }).catch(() => {});
                }
                // Yield after heavy work so API can process any queued requests
                await new Promise(r => setImmediate(r));
            } else {
                // Sleep for 5 seconds if no tasks
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } catch (error) {
            console.error('Worker loop error:', error);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('Worker received SIGTERM, shutting down...');
    process.exit(0);
});

startWorker();
