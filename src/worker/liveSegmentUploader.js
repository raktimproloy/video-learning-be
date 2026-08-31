/**
 * Poll MediaMTX HLS output and upload segments to R2 for active r2_live sessions.
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

  // Drop stale segments from a previous WHIP reconnect with a different init prefix.
  for (const name of [...done]) {
    if (!files.includes(name)) done.delete(name);
  }

  let newUpload = false;
  for (const fileName of files) {
    if (done.has(fileName)) continue;
    const localPath = path.join(hlsDir, fileName);
    try {
      const stat = fs.statSync(localPath);
      if (stat.size < 100) continue;
      await uploadSegment(sessionId, r2Prefix, localPath, fileName);
      done.add(fileName);
      newUpload = true;
    } catch (err) {
      console.warn('[LiveUploader] segment upload failed:', fileName, err.message);
    }
  }

  if (newUpload) {
    const allSegments = [...done].sort(compareSegmentNames);
    await buildAndUploadPlaylists(sessionId, r2Prefix, allSegments, hlsDir);

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
  }
}

async function pollActiveSessions() {
  try {
    const result = await db.query(
      `SELECT id, lesson_id, ingest_stream_key, hls_ready_at
       FROM live_sessions
       WHERE status = 'active' AND provider = 'r2_live' AND ingest_stream_key IS NOT NULL`
    );
    for (const session of result.rows) {
      await processSession(session);
    }

    // Cleanup map for ended sessions
    const activeIds = new Set(result.rows.map((r) => r.id));
    for (const id of uploadedSegments.keys()) {
      if (!activeIds.has(id)) uploadedSegments.delete(id);
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
  console.log('[LiveUploader] Started (poll interval 800ms)');
  setInterval(pollActiveSessions, 800);
  pollActiveSessions();
}

module.exports = { startLiveSegmentUploader, pollActiveSessions, processSession };
