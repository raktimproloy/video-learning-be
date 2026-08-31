/**
 * R2 live HLS ingest + delivery settings.
 */
require('dotenv').config();

module.exports = {
  segmentSeconds: Math.max(1, parseInt(process.env.LIVE_HLS_SEGMENT_SECONDS || '1', 10)),
  playlistWindow: Math.max(3, parseInt(process.env.LIVE_HLS_PLAYLIST_WINDOW || '6', 10)),
  mediamtxInternalUrl: (process.env.MEDIAMTX_INTERNAL_URL || 'http://mediamtx:8888').replace(/\/$/, ''),
  mediamtxWhipPublicUrl: (process.env.MEDIAMTX_WHIP_PUBLIC_URL || process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, ''),
  mediamtxHlsDir: process.env.MEDIAMTX_HLS_DIR || '/var/mediamtx/hls',
  streamKeySecret: process.env.LIVE_STREAM_KEY_SECRET || process.env.JWT_SECRET || 'live-stream-secret',
  ingestAuthSecret: process.env.LIVE_INGEST_AUTH_SECRET || process.env.JWT_SECRET || 'live-ingest-secret',
  forceProvider: process.env.LIVE_FORCE_PROVIDER || null,
};
