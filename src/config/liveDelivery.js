/**
 * R2 live HLS ingest + delivery settings.
 */
require('dotenv').config();

const liveCdnRaw = (process.env.LIVE_CDN_DELIVERY || process.env.CDN_SEGMENT_DELIVERY || 'cdn').toLowerCase();
const liveCdnDelivery = ['off', 'presign', 'cdn'].includes(liveCdnRaw) ? liveCdnRaw : 'off';

/** Time-based hold-back target (Live Tester model) — converted to segment count from actual EXTINF. */
const holdBackTargetSeconds = Math.max(10, parseInt(process.env.LIVE_HOLD_BACK_SECONDS || '20', 10));
/** Legacy segment-count fallback when playlist durations not yet known. */
const holdBackSegments = Math.max(4, parseInt(process.env.LIVE_PLAYBACK_HOLD_BACK_SEGMENTS || '10', 10));
const clientStartBufferSeconds = Math.max(2, parseInt(process.env.LIVE_CLIENT_START_BUFFER_SECONDS || '4', 10));
/** Min publishable segments in playlist before playback_ready (Live Tester uses 3). */
const cdnMinSegmentsDefault = Math.max(3, parseInt(process.env.LIVE_CDN_MIN_SEGMENTS || '3', 10));

const playlistTypeRaw = (process.env.LIVE_HLS_PLAYLIST_TYPE || 'window').toLowerCase();
const playlistType = playlistTypeRaw === 'event' ? 'event' : 'window';

module.exports = {
  /** Fallback when MediaMTX EXTINF not yet known (~2s typical for WHIP fmp4). */
  segmentSeconds: Math.max(1, parseFloat(process.env.LIVE_HLS_SEGMENT_SECONDS || '2')),
  /** Sliding live window size (segments) after hold-back — YouTube-like stable edge. */
  playlistWindow: Math.max(8, parseInt(process.env.LIVE_HLS_PLAYLIST_WINDOW || '20', 10)),
  /** Target hold-back delay in seconds (dynamic segment count derived from EXTINF). */
  holdBackTargetSeconds,
  /** Segments held back from playlist edge (fallback when durations unknown). */
  holdBackSegments,
  /** Client pre-roll buffer before first play (seconds) */
  clientStartBufferSeconds,
  /** event kept for VOD finalize; live uploader uses sliding window regardless */
  playlistType,
  /** Students never receive MediaMTX cold-start — R2/CDN only */
  studentR2Only: process.env.LIVE_STUDENT_R2_ONLY !== 'false',
  mediamtxInternalUrl: (process.env.MEDIAMTX_INTERNAL_URL || 'http://mediamtx:8888').replace(/\/$/, ''),
  mediamtxWhipPublicUrl: (process.env.MEDIAMTX_WHIP_PUBLIC_URL || process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, ''),
  mediamtxHlsDir: process.env.MEDIAMTX_HLS_DIR || '/var/mediamtx/hls',
  streamKeySecret: process.env.LIVE_STREAM_KEY_SECRET || process.env.JWT_SECRET || 'live-stream-secret',
  ingestAuthSecret: process.env.LIVE_INGEST_AUTH_SECRET || process.env.JWT_SECRET || 'live-ingest-secret',
  forceProvider: process.env.LIVE_FORCE_PROVIDER || null,
  /** off | presign | cdn — live segment delivery (YouTube/FB CDN edge model) */
  cdnDelivery: liveCdnDelivery,
  /** Min publishable segments in playlist before student playback_ready */
  cdnMinSegments: cdnMinSegmentsDefault,
  /**
   * Local dev: proxy live segments via API (avoids CDN CORS fragLoadError).
   * Production: direct CDN. Override with LIVE_SEGMENT_DELIVERY=cdn|proxy.
   */
  useLocalSegmentProxy: (() => {
    const mode = (process.env.LIVE_SEGMENT_DELIVERY || '').toLowerCase();
    if (mode === 'cdn') return false;
    if (mode === 'proxy') return true;
    const base = process.env.BASE_URL || process.env.MEDIAMTX_WHIP_PUBLIC_URL || '';
    return /localhost|127\.0\.0\.1/i.test(base);
  })(),
  uploaderPollMs: Math.max(200, parseInt(process.env.LIVE_UPLOADER_POLL_MS || '400', 10)),
  uploaderSessionConcurrency: Math.max(
    1,
    Math.min(32, parseInt(process.env.LIVE_UPLOADER_SESSION_CONCURRENCY || '8', 10))
  ),
  statsBroadcastMs: Math.max(3000, parseInt(process.env.LIVE_STATS_BROADCAST_MS || '8000', 10)),
  liveStatsCacheMs: Math.max(1000, parseInt(process.env.LIVE_STATS_CACHE_MS || '3000', 10)),
  viewerCountCacheMs: Math.max(2000, parseInt(process.env.LIVE_VIEWER_COUNT_CACHE_MS || '5000', 10)),
};
