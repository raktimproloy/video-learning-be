const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const db = require('../../db');
const videoProcessor = require('./videoProcessor');

// Worker runs in the same process as the API. videoProcessor uses a fast FFmpeg preset
// and limits encoder threads so the API stays responsive during encoding.

const workerIndex = process.env.WORKER_INDEX || '1';

async function startWorker() {
    console.log(`Video Processing Worker #${workerIndex} started...`);
    
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
                await videoProcessor.processTask(task);
                // Yield after heavy work so API can process any queued requests
                await new Promise(r => setImmediate(r));
            } else {
                // Sleep for 5 seconds if no tasks
                // console.log('No pending tasks, sleeping...');
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
