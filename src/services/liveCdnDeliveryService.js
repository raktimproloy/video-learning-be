/**
 * CDN-edge live HLS delivery (YouTube / Facebook Live model).
 *
 * - Cold start: origin (MediaMTX) for first seconds
 * - Scale path: small authenticated playlists via API, video bytes from CDN/R2 edge
 */
const liveDelivery = require('../config/liveDelivery');
const videoDelivery = require('../config/videoDelivery');
const r2Storage = require('./r2StorageService');
const hlsDeliveryService = require('./hlsDeliveryService');

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
  return isCdnReadyForSession(activeSession.id);
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

/**
 * Rewrite live fmp4 playlist: segments/init → CDN, child playlists → API subpath.
 */
async function rewriteLivePlaylistToCdn(content, r2Prefix, playlistSubpath, apiStreamBase, accessToken) {
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
          const r2Key = segmentR2Key(r2Prefix, playlistSubpath, file);
          const idx = segmentKeys.length;
          segmentKeys.push(r2Key);
          return { type: 'segment', jobIndex: idx, fallback: line, isMap: true };
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
  rewriteLivePlaylistToCdn,
  getLivePlaylistFromR2,
  getCdnRedirectForSegment,
};
