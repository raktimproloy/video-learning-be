const r2Storage = require('./r2StorageService');
const videoDelivery = require('../config/videoDelivery');

function isApiStreamUrl(url) {
  return typeof url === 'string' && url.includes('/v1/video/') && url.includes('/stream/');
}

function isPresignedOrCdnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('X-Amz-Signature=') || url.includes('X-Amz-Algorithm=')) return true;
  const cdnBase = videoDelivery.r2CdnPublicUrl;
  return !!(cdnBase && url.startsWith(cdnBase));
}

function playlistDirFromSubpath(playlistSubpath) {
  if (!playlistSubpath || !playlistSubpath.includes('/')) return '';
  return playlistSubpath.slice(0, playlistSubpath.lastIndexOf('/'));
}

function originFromBase(apiStreamBase) {
  try {
    return new URL(apiStreamBase).origin;
  } catch {
    return '';
  }
}

function withAccessToken(url, accessToken) {
  if (!accessToken || !url) return url;
  if (url.includes('token=')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(accessToken)}`;
}

/**
 * Make EXT-X-KEY URI absolute against API origin and attach access token (Safari / no Authorization header).
 */
function rewriteExtXKeyLine(line, apiOrigin, accessToken) {
  if (!apiOrigin || !/#EXT-X-KEY:/i.test(line)) return line;
  return line.replace(/URI="([^"]+)"/i, (_, uri) => {
    let absolute = uri;
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      absolute = uri;
    } else if (uri.startsWith('/')) {
      absolute = `${apiOrigin}${uri}`;
    } else {
      absolute = `${apiOrigin}/${uri}`;
    }
    return `URI="${withAccessToken(absolute, accessToken)}"`;
  });
}

/**
 * Build a direct segment URL after auth (presigned R2 or CDN public URL).
 */
async function buildSegmentDeliveryUrl(r2Key) {
  const { cdnSegmentDelivery, hlsSegmentPresignTtl, r2CdnPublicUrl } = videoDelivery;

  if (cdnSegmentDelivery === 'cdn' && r2CdnPublicUrl) {
    return `${r2CdnPublicUrl}/${r2Key}`;
  }

  if (cdnSegmentDelivery === 'presign' || cdnSegmentDelivery === 'cdn') {
    return r2Storage.getPresignedGetUrl(r2Key, hlsSegmentPresignTtl);
  }

  return null;
}

/**
 * Rewrite HLS playlist:
 * - child .m3u8 → absolute API stream URLs (+ token)
 * - EXT-X-KEY → absolute get-key URL (+ token)
 * - .ts → CDN/presign when enabled
 */
async function rewritePlaylistContent(content, videoR2Key, apiStreamBase, playlistSubpath, accessToken = null) {
  const { cdnSegmentDelivery } = videoDelivery;
  const rewriteSegments = cdnSegmentDelivery !== 'off';
  const apiOrigin = originFromBase(apiStreamBase);
  const playlistDir = playlistDirFromSubpath(playlistSubpath);
  const lines = content.split('\n');

  // Collect segment rewrite jobs so we can resolve them in parallel (presign mode).
  const segmentJobs = [];

  const prepared = lines.map((line) => {
    const trimmed = line.trim();

    if (!trimmed) return { type: 'raw', value: line };

    if (trimmed.startsWith('#')) {
      return {
        type: 'raw',
        value: rewriteExtXKeyLine(line, apiOrigin, accessToken),
      };
    }

    if (trimmed.endsWith('.m3u8')) {
      let url = trimmed;
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        url = `${apiStreamBase}/${trimmed.replace(/^\//, '')}`;
      }
      return { type: 'raw', value: withAccessToken(url, accessToken) };
    }

    if (trimmed.endsWith('.ts') && rewriteSegments) {
      const segmentRel = trimmed.includes('/')
        ? trimmed
        : (playlistDir ? `${playlistDir}/${trimmed}` : trimmed);
      const segmentKey = `${videoR2Key}/${segmentRel}`;
      const idx = segmentJobs.length;
      segmentJobs.push(segmentKey);
      return { type: 'segment', jobIndex: idx, fallback: line };
    }

    return { type: 'raw', value: line };
  });

  let segmentUrls = [];
  if (segmentJobs.length > 0) {
    segmentUrls = await Promise.all(
      segmentJobs.map((key) => buildSegmentDeliveryUrl(key).catch(() => null))
    );
  }

  return prepared
    .map((item) => {
      if (item.type === 'segment') {
        return segmentUrls[item.jobIndex] || item.fallback;
      }
      return item.value;
    })
    .join('\n');
}

/**
 * Read an R2 object body as UTF-8 text.
 */
async function readObjectAsString(key) {
  const stream = await r2Storage.getObjectStream(key);
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/**
 * Fetch playlist from R2, rewrite key/child URLs and optional CDN/presign segment URLs.
 */
async function getPlaylistBody(r2Key, videoR2Key, apiStreamBase, playlistSubpath, accessToken = null) {
  const content = await readObjectAsString(r2Key);
  return rewritePlaylistContent(content, videoR2Key, apiStreamBase, playlistSubpath, accessToken);
}

module.exports = {
  isApiStreamUrl,
  isPresignedOrCdnUrl,
  buildSegmentDeliveryUrl,
  rewritePlaylistContent,
  getPlaylistBody,
  withAccessToken,
};
