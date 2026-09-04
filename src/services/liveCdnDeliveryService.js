/**
 * CDN-edge live HLS delivery (YouTube / Facebook Live model).
 *
 * - Cold start: origin (MediaMTX) for first seconds
 * - Scale path: small authenticated playlists via API, video bytes from CDN/R2 edge
 */
const liveDelivery = require('../config/liveDelivery');
const videoDelivery = require('../config/videoDelivery');
const r2Storage = require('./r2StorageService');
const r2LiveStorage = require('./r2LiveStorageService');
const hlsDeliveryService = require('./hlsDeliveryService');

function countSegmentLines(content) {
  return String(content || '')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('#') && /\.(mp4|m4s|ts)$/i.test(t);
    }).length;
}

async function countMirroredMediaSegments(sessionId) {
  if (!r2Storage.isConfigured || !sessionId) return 0;
  try {
    const prefix = r2LiveStorage.getLiveSessionPrefix(sessionId);
    // SRS layout: live/sessions/{id}/seg-N.ts  (legacy MediaMTX also wrote under 720p/)
    const keys = await r2Storage.listObjects(`${prefix}/`);
    return keys.filter((k) => {
      const name = k.split('/').pop() || k;
      if (/_init\.mp4$/i.test(name)) return false;
      return /_video\d+_seg\d+\./i.test(name) || /^seg-\d+\.ts$/i.test(name) || /\.(m4s|ts)$/i.test(name);
    }).length;
  } catch (_) {
    return 0;
  }
}

async function countPublishableSegmentsOnR2(sessionId) {
  if (!r2Storage.isConfigured || !sessionId) return 0;
  try {
    const prefix = r2LiveStorage.getLiveSessionPrefix(sessionId);
    // Prefer SRS index.m3u8; fall back to legacy MediaMTX 720p/playlist.m3u8
    const candidates = [`${prefix}/index.m3u8`, `${prefix}/720p/playlist.m3u8`, `${prefix}/720p/index.m3u8`];
    for (const playlistKey of candidates) {
      if (!(await r2Storage.objectExists(playlistKey))) continue;
      const content = await hlsDeliveryService.readObjectAsString(playlistKey);
      const n = countSegmentLines(content);
      if (n > 0) return n;
    }
    return 0;
  } catch (_) {
    return 0;
  }
}

async function hasMinSegmentsOnR2(sessionId) {
  const publishable = await countPublishableSegmentsOnR2(sessionId);
  return publishable >= liveDelivery.cdnMinSegments;
}

async function getSessionTiming(sessionId) {
  try {
    const { getRedisClient } = require('../utils/redisClient');
    const redis = await getRedisClient();
    if (redis) {
      const raw = await redis.get(`live:timing:${sessionId}`);
      if (raw) return JSON.parse(raw);
    }
  } catch (_) {
    /* optional */
  }
  return null;
}

async function isCdnReadyForSession(sessionId) {
  try {
    const { getRedisClient } = require('../utils/redisClient');
    const redis = await getRedisClient();
    if (redis) {
      const flag = await redis.get(`live:cdn_ready:${sessionId}`);
      return flag === '1';
    }
  } catch (_) {
    /* fall through */
  }
  return false;
}

async function getPlaybackReadiness(activeSession) {
  if (!activeSession?.id) {
    return { hls_ready: false, cdn_ready: false, playback_ready: false };
  }
  const hlsReady = !!activeSession.hls_ready_at;
  if (!hlsReady) {
    return { hls_ready: false, cdn_ready: false, playback_ready: false };
  }
  const dbReady = !!activeSession.playback_ready_at;
  const redisReady = await isCdnReadyForSession(activeSession.id);
  const r2Ready = dbReady || redisReady ? true : await hasMinSegmentsOnR2(activeSession.id);
  const playbackReady = dbReady || redisReady || r2Ready;
  return {
    hls_ready: hlsReady,
    cdn_ready: playbackReady,
    playback_ready: playbackReady,
  };
}

function isCdnConfigured() {
  const mode = liveDelivery.cdnDelivery;
  if (mode === 'off') return false;
  if (mode === 'cdn') return !!videoDelivery.r2CdnPublicUrl;
  return r2Storage.isConfigured;
}

/** Session has enough mirrored content to serve via CDN edge. */
async function shouldServeViaCdn(activeSession) {
  if (!isCdnConfigured()) return false;
  if (!activeSession || activeSession.status !== 'active') return false;
  if (!activeSession.hls_ready_at) return false;
  if (activeSession.playback_ready_at) return true;
  if (await isCdnReadyForSession(activeSession.id)) return true;
  return hasMinSegmentsOnR2(activeSession.id);
}

function playlistDirFromSubpath(playlistSubpath) {
  if (!playlistSubpath || !playlistSubpath.includes('/')) return '';
  return playlistSubpath.slice(0, playlistSubpath.lastIndexOf('/'));
}

function isMediaSegmentLine(trimmed) {
  return /\.(ts|m4s|mp4|aac)$/i.test(trimmed);
}

function isChildPlaylistLine(trimmed) {
  return trimmed.endsWith('.m3u8');
}

function segmentR2Key(r2Prefix, playlistSubpath, fileName) {
  const playlistDir = playlistDirFromSubpath(playlistSubpath);
  const rel = fileName.includes('/')
    ? fileName
    : (playlistDir ? `${playlistDir}/${fileName}` : fileName);
  return `${r2Prefix}/${rel}`;
}

function buildLiveSegmentUrl(apiStreamBase, playlistSubpath, fileName, accessToken) {
  const playlistDir = playlistDirFromSubpath(playlistSubpath);
  const rel = fileName.includes('/')
    ? fileName
    : (playlistDir ? `${playlistDir}/${fileName}` : fileName);
  const url = `${apiStreamBase}?subpath=${encodeURIComponent(rel)}`;
  return hlsDeliveryService.withAccessToken(url, accessToken);
}

/**
 * Rewrite live fmp4 playlist: segments/init → CDN (or API proxy on localhost), child playlists → API subpath.
 */
async function rewriteLivePlaylistToCdn(content, r2Prefix, playlistSubpath, apiStreamBase, accessToken) {
  const useProxy = liveDelivery.useLocalSegmentProxy;
  const playlistDir = playlistDirFromSubpath(playlistSubpath);
  const segmentKeys = [];
  const lines = String(content || '').split('\n');

  const prepared = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'raw', value: line };

    if (trimmed.startsWith('#')) {
      if (/#EXT-X-MAP:/i.test(line)) {
        const mapMatch = line.match(/URI="([^"]+)"/i);
        if (mapMatch) {
          const uri = mapMatch[1];
          const file = uri.includes('/') ? uri.split('/').pop() : uri;
          if (useProxy) {
            const url = buildLiveSegmentUrl(apiStreamBase, playlistSubpath, file, accessToken);
            return { type: 'raw', value: line.replace(/URI="([^"]+)"/i, `URI="${url}"`) };
          }
          const r2Key = segmentR2Key(r2Prefix, playlistSubpath, file);
          const idx = segmentKeys.length;
          segmentKeys.push(r2Key);
          return { type: 'segment', jobIndex: idx, fallback: line, isMap: true };
        }
      }
      // Master AUDIO / SUBTITLES media playlists must go through API (auth), not raw R2 paths.
      if (/#EXT-X-MEDIA:/i.test(line) && /URI="/i.test(line)) {
        const mediaMatch = line.match(/URI="([^"]+)"/i);
        if (mediaMatch) {
          const uri = mediaMatch[1];
          const rel = uri.includes('/')
            ? uri.replace(/^\.\//, '')
            : (playlistDir ? `${playlistDir}/${uri}` : uri);
          const url = `${apiStreamBase}?subpath=${encodeURIComponent(rel)}`;
          const rewritten = line.replace(/URI="([^"]+)"/i, `URI="${hlsDeliveryService.withAccessToken(url, accessToken)}"`);
          return { type: 'raw', value: rewritten };
        }
      }
      return { type: 'raw', value: line };
    }

    if (isChildPlaylistLine(trimmed)) {
      const rel = trimmed.includes('/')
        ? trimmed
        : (playlistDir ? `${playlistDir}/${trimmed}` : trimmed);
      const url = `${apiStreamBase}?subpath=${encodeURIComponent(rel)}`;
      return { type: 'raw', value: hlsDeliveryService.withAccessToken(url, accessToken) };
    }

    if (isMediaSegmentLine(trimmed)) {
      const file = trimmed.includes('/') ? trimmed.split('/').pop() : trimmed;
      if (useProxy) {
        const url = buildLiveSegmentUrl(apiStreamBase, playlistSubpath, file, accessToken);
        return { type: 'raw', value: url };
      }
      const r2Key = segmentR2Key(r2Prefix, playlistSubpath, file);
      const idx = segmentKeys.length;
      segmentKeys.push(r2Key);
      return { type: 'segment', jobIndex: idx, fallback: line };
    }

    return { type: 'raw', value: line };
  });

  const segmentUrls = segmentKeys.length
    ? await Promise.all(segmentKeys.map((key) => hlsDeliveryService.buildSegmentDeliveryUrl(key).catch(() => null)))
    : [];

  return prepared
    .map((item) => {
      if (item.type === 'segment') {
        const url = segmentUrls[item.jobIndex];
        if (url) {
          if (item.isMap) {
            return item.fallback.replace(/URI="([^"]+)"/i, `URI="${url}"`);
          }
          return url;
        }
        return item.fallback;
      }
      return item.value;
    })
    .join('\n');
}

async function getLivePlaylistFromR2(r2Key, r2Prefix, playlistSubpath, apiStreamBase, accessToken) {
  const content = await hlsDeliveryService.readObjectAsString(r2Key);
  return rewriteLivePlaylistToCdn(content, r2Prefix, playlistSubpath, apiStreamBase, accessToken);
}

async function getCdnRedirectForSegment(r2Key) {
  if (!isCdnConfigured()) return null;
  return hlsDeliveryService.buildSegmentDeliveryUrl(r2Key);
}

module.exports = {
  isCdnConfigured,
  shouldServeViaCdn,
  isCdnReadyForSession,
  getPlaybackReadiness,
  getSessionTiming,
  rewriteLivePlaylistToCdn,
  getLivePlaylistFromR2,
  getCdnRedirectForSegment,
};
