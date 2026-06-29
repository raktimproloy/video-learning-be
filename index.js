const http = require('http');
const app = require('./src/app');
const { initSocket } = require('./src/socket');
const { shutdownRedis } = require('./src/utils/redisClient');
const { shutdownAnalyticsBatch } = require('./src/services/analyticsBatchService');
const { shutdownLiveHeartbeatBatch } = require('./src/services/liveWatchBatchService');
const { shutdownProgressBatch } = require('./src/services/progressService');

const port = parseInt(process.env.PORT || '5000', 10);
const server = http.createServer(app);
const serverTimeoutMs = Math.max(60_000, parseInt(process.env.SERVER_TIMEOUT_MS || '900000', 10));

server.requestTimeout = serverTimeoutMs;
server.headersTimeout = serverTimeoutMs + 5_000;
server.keepAliveTimeout = 65_000;

async function start() {
    initSocket(server);

    if (process.env.RUN_WORKER !== '0') {
        require('./src/worker/index');
        console.log('In-process video worker started (set RUN_WORKER=0 on API-only instances)');
    } else {
        console.log('Video worker disabled on this process (RUN_WORKER=0)');
    }

    const liveSessionForceEndJob = require('./src/jobs/liveSessionForceEndJob');
    liveSessionForceEndJob.start();

    await new Promise((resolve, reject) => {
        server.listen(port, '0.0.0.0', (err) => {
            if (err) reject(err);
            else {
                console.log(`Server running on 0.0.0.0:${port}`);
                resolve();
            }
        });
    });
}

async function shutdown() {
    await shutdownAnalyticsBatch();
    await shutdownLiveHeartbeatBatch();
    await shutdownProgressBatch();
    await shutdownRedis();
    server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
