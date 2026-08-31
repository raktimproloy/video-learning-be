/**
 * R2 live HLS ingest + delivery settings.
 */
require('dotenv').config();

const liveCdnRaw = (process.env.LIVE_CDN_DELIVERY || process.env.CDN_SEGMENT_DELIVERY || 'cdn').toLowerCase();
const liveCdnDelivery = ['off', 'presign', 'cdn'].includes(liveCdnRaw) ? liveCdnRaw : 'off';

module.exports = {
  segmentSeconds: Math.max(1, parseInt(process.env.LIVE_HLS_SEGMENT_SECONDS || '1', 10)),
  playlistWindow: Math.max(3, parseInt(process.env.LIVE_HLS_PLAYLIST_WINDOW || '6', 10)),
  mediamtxInternalUrl: (process.env.MEDIAMTX_INTERNAL_URL || 'http://mediamtx:8888').replace(/\/$/, ''),
  mediamtxWhipPublicUrl: (process.env.MEDIAMTX_WHIP_PUBLIC_URL || process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, ''),
  mediamtxHlsDir: process.env.MEDIAMTX_HLS_DIR || '/var/mediamtx/hls',
  streamKeySecret: process.env.LIVE_STREAM_KEY_SECRET || process.env.JWT_SECRET || 'live-stream-secret',
  ingestAuthSecret: process.env.LIVE_INGEST_AUTH_SECRET || process.env.JWT_SECRET || 'live-ingest-secret',
  forceProvider: process.env.LIVE_FORCE_PROVIDER || null,
  /** off | presign | cdn — live segment delivery (YouTube/FB CDN edge model) */
  cdnDelivery: liveCdnDelivery,
  /** Min mirrored segments before switching viewers to CDN (cold-start uses origin) */
  cdnMinSegments: Math.max(2, parseInt(process.env.LIVE_CDN_MIN_SEGMENTS || '3', 10)),
  uploaderPollMs: Math.max(200, parseInt(process.env.LIVE_UPLOADER_POLL_MS || '400', 10)),
  statsBroadcastMs: Math.max(3000, parseInt(process.env.LIVE_STATS_BROADCAST_MS || '8000', 10)),
  liveStatsCacheMs: Math.max(1000, parseInt(process.env.LIVE_STATS_CACHE_MS || '3000', 10)),
  viewerCountCacheMs: Math.max(2000, parseInt(process.env.LIVE_VIEWER_COUNT_CACHE_MS || '5000', 10)),
};
