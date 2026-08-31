/**
 * Poll MediaMTX HLS output and upload segments to R2 for active r2_live sessions.
 * Mirrors origin → CDN edge (YouTube/FB live model).
 */
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const r2Storage = require('../services/r2StorageService');
const r2LiveStorage = require('../services/r2LiveStorageService');
const liveIngestService = require('../services/liveIngestService');
const liveDelivery = require('../config/liveDelivery');
const { publishLiveEvent } = require('../utils/liveEventBus');

const uploadedSegments = new Map(); // sessionId -> Set of filenames
const UPLOAD_CONCURRENCY = Math.max(1, Math.min(8, parseInt(process.env.LIVE_R2_UPLOAD_CONCURRENCY || '4', 10)));

async function markCdnReady(sessionId) {
  try {
    const { getRedisClient } = require('../utils/redisClient');
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(`live:cdn_ready:${sessionId}`, '1', { EX: 86400 });
    }
  } catch (_) {
    /* optional */
  }
}

async function clearCdnReady(sessionId) {
  try {
    const { getRedisClient } = require('../utils/redisClient');
    const redis = await getRedisClient();
    if (redis) await redis.del(`live:cdn_ready:${sessionId}`);
  } catch (_) {}
}

/** MediaMTX names segments seg1.ts, seg2.ts … seg10.ts — plain sort would misorder them. */
function compareSegmentNames(a, b) {
  const na = parseInt((a.match(/(\d+)/) || [])[1] ?? '0', 10);
  const nb = parseInt((b.match(/(\d+)/) || [])[1] ?? '0', 10);
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

function getHlsDirForSession(streamKey) {
  const pathName = r2LiveStorage.getMediamtxPathName(streamKey);
  return path.join(liveDelivery.mediamtxHlsDir, pathName);
}

/** Keep only files from the current MediaMTX generation (latest video init prefix). */
function filterCurrentStreamFiles(hlsDir, files) {
  const variantPath = path.join(hlsDir, 'video1_stream.m3u8');
  if (!fs.existsSync(variantPath)) return files;

  try {
    const content = fs.readFileSync(variantPath, 'utf8');
    const mapMatch = content.match(/#EXT-X-MAP:URI="([^"?]+)/);
    if (!mapMatch) return files;
    const initFile = mapMatch[1];
    const prefix = initFile.replace(/_video\d+_init\.mp4$/i, '');
    if (!prefix) return files;
    return files.filter((f) => f.startsWith(prefix));
  } catch (_) {
    return files;
  }
}

async function uploadSegment(sessionId, r2Prefix, localPath, fileName) {
  const r2Key = `${r2Prefix}/720p/${fileName}`;
  const body = fs.readFileSync(localPath);
  const lower = fileName.toLowerCase();
  const contentType = lower.endsWith('.m4s') || lower.endsWith('.mp4')
    ? 'video/iso.segment'
    : 'video/mp2t';
  await r2Storage.uploadFile(r2Key, body, contentType);
}

async function uploadSegmentsParallel(sessionId, r2Prefix, pending) {
  for (let i = 0; i < pending.length; i += UPLOAD_CONCURRENCY) {
    const batch = pending.slice(i, i + UPLOAD_CONCURRENCY);
    await Promise.all(
      batch.map(({ localPath, fileName }) => uploadSegment(sessionId, r2Prefix, localPath, fileName))
    );
  }
}

function readInitFromVariantPlaylist(hlsDir) {
  const variantPath = path.join(hlsDir, 'video1_stream.m3u8');
  if (!fs.existsSync(variantPath)) return null;
  try {
    const content = fs.readFileSync(variantPath, 'utf8');
    const mapMatch = content.match(/#EXT-X-MAP:URI="([^"?]+)/);
    return mapMatch ? mapMatch[1] : null;
  } catch (_) {
    return null;
  }
}

async function buildAndUploadPlaylists(sessionId, r2Prefix, segmentNames, hlsDir) {
  const targetDuration = liveDelivery.segmentSeconds;
  const initFile =
    segmentNames.find((f) => /_video\d+_init\.mp4$/i.test(f)) ||
    segmentNames.find((f) => /_init\.mp4$/i.test(f)) ||
    (hlsDir ? readInitFromVariantPlaylist(hlsDir) : null);
  const mediaSegments = segmentNames.filter((f) => {
    if (/_init\.mp4$/i.test(f)) return false;
    return /_seg\d+\./i.test(f) || /\.(ts|m4s|aac)$/i.test(f);
  });
  const mediaSequence = Math.max(0, mediaSegments.length - liveDelivery.playlistWindow);
  const windowSegments = mediaSegments.slice(-liveDelivery.playlistWindow);

  let playlistBody = '#EXTM3U\n#EXT-X-VERSION:7\n';
  playlistBody += `#EXT-X-TARGETDURATION:${Math.ceil(targetDuration)}\n`;
  playlistBody += `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}\n`;
  if (initFile) {
    playlistBody += `#EXT-X-MAP:URI="${initFile}"\n`;
  }
  for (const seg of windowSegments) {
    playlistBody += `#EXTINF:${targetDuration.toFixed(3)},\n${seg}\n`;
  }

  await r2Storage.uploadFile(
    `${r2Prefix}/720p/playlist.m3u8`,
    Buffer.from(playlistBody, 'utf8'),
    'application/vnd.apple.mpegurl'
  );

  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
    '720p/playlist.m3u8',
    '',
  ].join('\n');
  await r2Storage.uploadFile(
    `${r2Prefix}/master.m3u8`,
    Buffer.from(master, 'utf8'),
    'application/vnd.apple.mpegurl'
  );
}

async function processSession(session) {
  if (!session.ingest_stream_key || !r2Storage.isConfigured) return;

  const hlsDir = getHlsDirForSession(session.ingest_stream_key);
  if (!fs.existsSync(hlsDir)) return;

  const sessionId = session.id;
  if (!uploadedSegments.has(sessionId)) {
    uploadedSegments.set(sessionId, new Set());
  }
  const done = uploadedSegments.get(sessionId);
  const r2Prefix = r2LiveStorage.getLiveSessionPrefix(sessionId);

  const files = filterCurrentStreamFiles(
    hlsDir,
    fs.readdirSync(hlsDir)
      .filter((f) => {
        if (f.endsWith('.m3u8') || f.endsWith('.map')) return false;
        return /\.(ts|m4s|mp4|aac)$/i.test(f);
      })
      .sort(compareSegmentNames)
  );

  for (const name of [...done]) {
    if (!files.includes(name)) done.delete(name);
  }

  const pending = [];
  for (const fileName of files) {
    if (done.has(fileName)) continue;
    const localPath = path.join(hlsDir, fileName);
    try {
      const stat = fs.statSync(localPath);
      if (stat.size < 100) continue;
      pending.push({ localPath, fileName });
    } catch (_) {
      /* skip unreadable */
    }
  }

  if (pending.length === 0) return;

  try {
    await uploadSegmentsParallel(sessionId, r2Prefix, pending);
    for (const { fileName } of pending) {
      done.add(fileName);
    }

    const allSegments = [...done].sort(compareSegmentNames);
    await buildAndUploadPlaylists(sessionId, r2Prefix, allSegments, hlsDir);

    const minForCdn = liveDelivery.cdnMinSegments;
    const mediaCount = allSegments.filter((f) => !/_init\.mp4$/i.test(f)).length;

    if (!session.hls_ready_at) {
      const lessonRes = await db.query(
        'SELECT lesson_id FROM live_sessions WHERE id = $1',
        [sessionId]
      );
      const lessonId = lessonRes.rows[0]?.lesson_id;
      await liveIngestService.markHlsReady(sessionId);
      if (lessonId) {
        await publishLiveEvent({ type: 'hls_ready', lessonId, sessionId });
      }
    }

    if (mediaCount >= minForCdn) {
      await markCdnReady(sessionId);
    }
  } catch (err) {
    console.warn('[LiveUploader] batch upload failed:', sessionId, err.message);
  }
}

async function pollActiveSessions() {
  try {
    const result = await db.query(
      `SELECT id, lesson_id, ingest_stream_key, hls_ready_at
       FROM live_sessions
       WHERE status = 'active' AND provider = 'r2_live' AND ingest_stream_key IS NOT NULL`
    );
    await Promise.all(result.rows.map((session) => processSession(session)));

    const activeIds = new Set(result.rows.map((r) => r.id));
    for (const id of uploadedSegments.keys()) {
      if (!activeIds.has(id)) {
        uploadedSegments.delete(id);
        clearCdnReady(id);
      }
    }
  } catch (err) {
    console.error('[LiveUploader] poll error:', err.message);
  }
}

function startLiveSegmentUploader() {
  if (!r2Storage.isConfigured) {
    console.warn('[LiveUploader] R2 not configured — live segment uploader disabled');
    return;
  }
  const intervalMs = liveDelivery.uploaderPollMs;
  console.log(`[LiveUploader] Started (poll ${intervalMs}ms, concurrency ${UPLOAD_CONCURRENCY})`);
  setInterval(pollActiveSessions, intervalMs);
  pollActiveSessions();
}

module.exports = { startLiveSegmentUploader, pollActiveSessions, processSession };
