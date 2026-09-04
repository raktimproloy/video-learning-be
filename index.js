const http = require('http');
const app = require('./src/app');
const { initSocket, wireLiveEventBus } = require('./src/socket');
const { shutdownRedis } = require('./src/utils/redisClient');
const { shutdownAnalyticsBatch } = require('./src/services/analyticsBatchService');
const { shutdownLiveHeartbeatBatch } = require('./src/services/liveWatchBatchService');
const { shutdownProgressBatch } = require('./src/services/progressService');

const port = parseInt(process.env.PORT || '5000', 10);
const server = http.createServer(app);
// SERVER_TIMEOUT_MS controls how long the server waits for a request to complete.
// For large video upload finalization, this must be very high (default: 5h = 18000000ms).
// Set SERVER_TIMEOUT_MS=0 in .env to disable (not recommended in production behind a proxy).
const serverTimeoutMs = parseInt(process.env.SERVER_TIMEOUT_MS || '18000000', 10);

server.requestTimeout = serverTimeoutMs;
server.headersTimeout = serverTimeoutMs + 5_000;
server.keepAliveTimeout = 65_000;


async function start() {
    initSocket(server);
    wireLiveEventBus();

    if (process.env.RUN_WORKER !== '0') {
        require('./src/worker/index');
        console.log('In-process video worker started (set RUN_WORKER=0 on API-only instances)');
    } else {
        console.log('Video worker disabled on this process (RUN_WORKER=0)');
    }

    const liveSessionForceEndJob = require('./src/jobs/liveSessionForceEndJob');
    liveSessionForceEndJob.start();

    if (process.env.RUN_LIVE_UPLOADER !== '0') {
        const { startLiveSegmentUploader } = require('./src/worker/liveSegmentUploader');
        startLiveSegmentUploader();
        console.log('In-process live segment uploader started (set RUN_LIVE_UPLOADER=0 when using dedicated live-uploader container)');
    }

    await new Promise((resolve, reject) => {
        server.listen(port, (err) => {
            if (err) reject(err);
            else {
                console.log(`Server running on port ${port}`);
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
