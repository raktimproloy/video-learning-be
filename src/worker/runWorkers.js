/**
 * Run N worker processes. Use when you want multiple workers (e.g. 2) to process
 * video tasks in parallel. Each worker claims a different pending task (DB uses FOR UPDATE SKIP LOCKED).
 *
 * Usage: node src/worker/runWorkers.js [count]
 * Default count: 2
 * Example: node src/worker/runWorkers.js 2
 *
 * To run exactly 2 workers: start the server with RUN_WORKER=0 (no in-process worker),
 * then run "npm run worker:2" in a separate terminal.
 */

const path = require('path');
const { spawn } = require('child_process');

const count = Math.max(1, parseInt(process.argv[2], 10) || 2);
const workerPath = path.join(__dirname, 'index.js');

console.log(`Starting ${count} worker(s)...`);

const children = [];
for (let i = 0; i < count; i++) {
    const child = spawn(process.execPath, [workerPath], {
        stdio: 'inherit',
        env: { ...process.env, WORKER_INDEX: String(i + 1) },
        cwd: path.join(__dirname, '../..'),
    });
    child.on('error', (err) => {
        console.error(`Worker ${i + 1} error:`, err);
    });
    child.on('exit', (code, signal) => {
        console.log(`Worker ${i + 1} exited (code=${code}, signal=${signal})`);
    });
    children.push(child);
}

process.on('SIGINT', () => {
    console.log('Shutting down workers...');
    children.forEach(c => c.kill('SIGINT'));
    process.exit(0);
});
process.on('SIGTERM', () => {
    children.forEach(c => c.kill('SIGTERM'));
    process.exit(0);
});
