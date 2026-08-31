/**
 * Live HLS from MediaMTX shared volume (preferred) or internal HTTP.
 * Playlists carry ?session= on child URLs — proxied via the `mtx` query param.
 */
const fs = require('fs');
const path = require('path');
const liveDelivery = require('../config/liveDelivery');
const hlsDeliveryService = require('./hlsDeliveryService');

const MASTER_RESOURCE = 'index.m3u8';

function stripQuery(resource) {
  const q = String(resource || '').indexOf('?');
  return q === -1 ? String(resource || '') : String(resource).slice(0, q);
}

/** Keep the query string (MediaMTX session id) but block path traversal. */
function sanitizeResource(resource) {
  const raw = String(resource || MASTER_RESOURCE).replace(/^\/+/, '');
  return raw.replace(/\.\.\//g, '').replace(/\.\./g, '');
}

function isSegmentResource(resource) {
  return /\.(ts|m4s|mp4|aac)$/i.test(stripQuery(resource));
}

function isPlaylistResource(resource) {
  return /\.m3u8$/i.test(stripQuery(resource));
}

function contentTypeForResource(resource) {
  const p = stripQuery(resource).toLowerCase();
  if (p.endsWith('.ts')) return 'video/mp2t';
  if (p.endsWith('.m4s')) return 'video/iso.segment';
  if (p.endsWith('.mp4')) return 'video/mp4';
  if (p.endsWith('.aac')) return 'audio/aac';
  return 'application/vnd.apple.mpegurl';
}

function localResourcePath(pathName, resource) {
  const fileName = stripQuery(sanitizeResource(resource));
  return path.join(liveDelivery.mediamtxHlsDir, pathName, fileName);
}

async function readLocalFile(pathName, resource) {
  const filePath = localResourcePath(pathName, resource);
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size === 0) return null;
    return filePath;
  } catch {
    return null;
  }
}

async function fetchFromMediamtxHttp(pathName, resource) {
  const base = liveDelivery.mediamtxInternalUrl.replace(/\/$/, '');
  const url = `${base}/${pathName}/${sanitizeResource(resource)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const err = new Error(`MediaMTX fetch failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/** Point a MediaMTX resource (playlist or segment) back at this API via the `mtx` param. */
function rewriteMtxResourceUri(resource, apiStreamBase, accessToken) {
  const url = `${apiStreamBase}?mtx=${encodeURIComponent(sanitizeResource(resource))}`;
  return hlsDeliveryService.withAccessToken(url, accessToken);
}

/** Point every child playlist / segment back at this API via the `mtx` param. */
function rewriteMediamtxPlaylist(content, apiStreamBase, accessToken) {
  return String(content || '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
          if (!isPlaylistResource(uri) && !isSegmentResource(uri)) return `URI="${uri}"`;
          return `URI="${rewriteMtxResourceUri(uri, apiStreamBase, accessToken)}"`;
        });
      }

      if (!isPlaylistResource(trimmed) && !isSegmentResource(trimmed)) return line;
      return rewriteMtxResourceUri(trimmed, apiStreamBase, accessToken);
    })
    .join('\n');
}

async function readPlaylistText(pathName, resource) {
  const safeResource = resource || MASTER_RESOURCE;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const localPath = await readLocalFile(pathName, safeResource);
    if (localPath) {
      const text = await fs.promises.readFile(localPath, 'utf8');
      if (text.includes('#EXTM3U') && (text.includes('#EXTINF') || text.includes('#EXT-X-STREAM-INF'))) {
        return text;
      }
    } else {
      try {
        const res = await fetchFromMediamtxHttp(pathName, safeResource);
        const text = await res.text();
        if (text.includes('#EXTM3U')) return text;
      } catch (_) {
        /* retry */
      }
    }
    await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
  }
  const res = await fetchFromMediamtxHttp(pathName, safeResource);
  return res.text();
}

async function getPlaylistBody(pathName, resource, apiStreamBase, accessToken) {
  const text = await readPlaylistText(pathName, resource || MASTER_RESOURCE);
  return rewriteMediamtxPlaylist(text, apiStreamBase, accessToken);
}

async function getSegmentBody(pathName, resource) {
  const localPath = await readLocalFile(pathName, resource);
  if (localPath) {
    const body = await fs.promises.readFile(localPath);
    return { body, contentType: contentTypeForResource(resource) };
  }
  const res = await fetchFromMediamtxHttp(pathName, resource);
  const body = Buffer.from(await res.arrayBuffer());
  return { body, contentType: contentTypeForResource(resource) };
}

module.exports = {
  MASTER_RESOURCE,
  sanitizeResource,
  stripQuery,
  isSegmentResource,
  isPlaylistResource,
  contentTypeForResource,
  getPlaylistBody,
  getSegmentBody,
};
