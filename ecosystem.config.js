/**
 * PM2 process layout for Shikkhabhumi VPS.
 *
 * API (no FFmpeg):  RUN_WORKER=0  → pm2 start ecosystem.config.js --only api
 * Worker (FFmpeg):  pm2 start ecosystem.config.js --only worker
 *
 * With Redis (REDIS_URL): Socket.io + cache shared across API instances.
 * nginx: ip_hash or sticky cookie for /socket.io/ when running api cluster.
 */
module.exports = {
  apps: [
    {
      name: 'shikkhabhumi-api',
      script: 'index.js',
      instances: parseInt(process.env.PM2_API_INSTANCES || '1', 10),
      exec_mode: process.env.PM2_API_INSTANCES > 1 ? 'cluster' : 'fork',
      env: {
        NODE_ENV: 'production',
        RUN_WORKER: '0',
        PORT: 3000,
      },
      max_memory_restart: '1G',
      listen_timeout: 10000,
      kill_timeout: 10000,
    },
    {
      name: 'shikkhabhumi-worker',
      script: 'src/worker/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '2G',
    },
  ],
};
