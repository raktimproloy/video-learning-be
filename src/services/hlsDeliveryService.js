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
 * Rewrite relative segment lines in an HLS playlist to presigned/CDN URLs.
 */
async function rewritePlaylistContent(content, videoR2Key, apiStreamBase, playlistSubpath) {
  const { cdnSegmentDelivery } = videoDelivery;
  if (cdnSegmentDelivery === 'off') return content;

  const playlistDir = playlistDirFromSubpath(playlistSubpath);
  const lines = content.split('\n');
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }

    if (trimmed.endsWith('.m3u8')) {
      out.push(`${apiStreamBase}/${trimmed}`);
      continue;
    }

    if (trimmed.endsWith('.ts')) {
      const segmentRel = trimmed.includes('/')
        ? trimmed
        : (playlistDir ? `${playlistDir}/${trimmed}` : trimmed);
      const segmentKey = `${videoR2Key}/${segmentRel}`;
      const directUrl = await buildSegmentDeliveryUrl(segmentKey);
      out.push(directUrl || line);
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
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
 * Fetch playlist from R2, optionally rewrite segment URLs for CDN/presign delivery.
 */
async function getPlaylistBody(r2Key, videoR2Key, apiStreamBase, playlistSubpath) {
  const content = await readObjectAsString(r2Key);
  return rewritePlaylistContent(content, videoR2Key, apiStreamBase, playlistSubpath);
}

module.exports = {
  isApiStreamUrl,
  isPresignedOrCdnUrl,
  buildSegmentDeliveryUrl,
  rewritePlaylistContent,
  getPlaylistBody,
};
