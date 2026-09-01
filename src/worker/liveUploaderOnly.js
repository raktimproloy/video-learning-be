const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { startLiveSegmentUploader } = require('./liveSegmentUploader');

/**
 * Dedicated live HLS → R2 mirror process (no FFmpeg video encoding).
 * Run separately from the main worker so multiple teacher lives stay smooth.
 */
console.log('[LiveUploader] Dedicated live-uploader process starting...');
startLiveSegmentUploader();

process.on('SIGTERM', () => {
  console.log('[LiveUploader] Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[LiveUploader] Received SIGINT, shutting down...');
  process.exit(0);
});
