const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const db = require('../../db');
const videoProcessor = require('./videoProcessor');

async function startWorker() {
    console.log('Video Processing Worker started...');
    
    while (true) {
        try {
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
                console.log(`Picked up task ${task.id}`);
                await videoProcessor.processTask(task);
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
