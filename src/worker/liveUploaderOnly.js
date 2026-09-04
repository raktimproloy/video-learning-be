const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { startLiveSegmentUploader } = require('./liveSegmentUploader');

/**
 * Live HLS uploading is now handled via SRS webhooks in the main API server.
 * This process is no longer required and will just sleep.
 */
console.log('[LiveUploader] Polling disabled. SRS webhooks handle uploads.');
setInterval(() => {}, 60000);

process.on('SIGTERM', () => {
  console.log('[LiveUploader] Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[LiveUploader] Received SIGINT, shutting down...');
  process.exit(0);
});
