const http = require('http');
const app = require('./src/app');
const { initSocket } = require('./src/socket');

const port = process.env.PORT || 3000;
const server = http.createServer(app);
const serverTimeoutMs = Math.max(60_000, parseInt(process.env.SERVER_TIMEOUT_MS || '900000', 10));

// Long uploads can exceed default infrastructure timeouts; keep these explicit.
server.requestTimeout = serverTimeoutMs;
server.headersTimeout = serverTimeoutMs + 5_000;
server.keepAliveTimeout = 65_000;

// Initialize Socket.io
initSocket(server);

// Start the video processing worker (unless RUN_WORKER=0, e.g. when running workers separately)
if (process.env.RUN_WORKER !== '0') {
    require('./src/worker/index');
}

// Force-end live sessions that hit time limit and weren't stopped within grace period (saves usage minutes)
const liveSessionForceEndJob = require('./src/jobs/liveSessionForceEndJob');
liveSessionForceEndJob.start();

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
