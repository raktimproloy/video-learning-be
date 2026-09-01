/**
 * Poll MediaMTX HLS output and upload segments to R2 for active r2_live sessions.
 * Mirrors origin → CDN edge (YouTube/FB live model).
 *
 * MediaMTX fmp4 emits separate video + audio playlists; we mirror both and publish
 * a master with an AUDIO group so students get A/V together.
 */
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const r2Storage = require('../services/r2StorageService');
const r2LiveStorage = require('../services/r2LiveStorageService');
const liveIngestService = require('../services/liveIngestService');
const liveDelivery = require('../config/liveDelivery');
const liveDiagnosticsService = require('../services/liveDiagnosticsService');
const { publishLiveEvent } = require('../utils/liveEventBus');

const uploadedSegments = new Map(); // sessionId -> Set of filenames
const segmentDurations = new Map(); // sessionId -> Map(fileName -> durationSec)
const r2SyncedSessions = new Set();
const lastPlaylistWrite = new Map(); // sessionId -> { at, count }
const playbackReadyEmitted = new Set();
const PLAYLIST_WRITE_MIN_MS = Math.max(1000, parseInt(process.env.LIVE_PLAYLIST_WRITE_MIN_MS || '1000', 10));
const UPLOAD_CONCURRENCY = Math.max(1, Math.min(4, parseInt(process.env.LIVE_R2_UPLOAD_CONCURRENCY || '4', 10)));

async function markCdnReady(sessionId, lessonId) {
  try {
    await liveIngestService.markPlaybackReady(sessionId);
  } catch (err) {
    console.warn('[LiveUploader] markPlaybackReady failed:', sessionId, err.message);
  }
  try {
    const { getRedisClient } = require('../utils/redisClient');
    const redis = await getRedisClient();
    if (redis) {
      const already = await redis.get(`live:cdn_ready:${sessionId}`);
      await redis.set(`live:cdn_ready:${sessionId}`, '1', { EX: 86400 });
      if (!already && lessonId && !playbackReadyEmitted.has(sessionId)) {
        playbackReadyEmitted.add(sessionId);
        await publishLiveEvent({ type: 'playback_ready', lessonId, sessionId });
        liveDiagnosticsService.append({
          type: 'playback_ready',
          lessonId,
          sessionId,
          message: 'CDN/R2 playback ready',
          data: { lessonId, sessionId },
        });
      }
    } else if (lessonId && !playbackReadyEmitted.has(sessionId)) {
      playbackReadyEmitted.add(sessionId);
      await publishLiveEvent({ type: 'playback_ready', lessonId, sessionId });
      liveDiagnosticsService.append({
        type: 'playback_ready',
        lessonId,
        sessionId,
        message: 'CDN/R2 playback ready',
        data: { lessonId, sessionId },
      });
    }
  } catch (_) {
    /* optional */
  }
}

async function clearCdnReady(sessionId) {
  playbackReadyEmitted.delete(sessionId);
  try {
    await liveIngestService.clearPlaybackReady(sessionId);
  } catch (_) {}
  try {
    const { getRedisClient } = require('../utils/redisClient');
    const redis = await getRedisClient();
    if (redis) {
      await redis.del(`live:cdn_ready:${sessionId}`);
      await redis.del(`live:timing:${sessionId}`);
    }
  } catch (_) {}
}

function compareSegmentNames(a, b) {
  const segRe = /_seg(\d+)\./i;
  const ma = a.match(segRe);
  const mb = b.match(segRe);
  if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10);
  const na = parseInt((a.match(/(\d+)/) || [])[1] ?? '0', 10);
  const nb = parseInt((b.match(/(\d+)/) || [])[1] ?? '0', 10);
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

function segmentIndex(name) {
  const m = String(name).match(/_seg(\d+)\./i);
  return m ? parseInt(m[1], 10) : -1;
}

function isInitFile(name) {
  return /_init\.mp4$/i.test(name);
}

function isVideoSegmentFile(name) {
  if (isInitFile(name)) return false;
  return /_video\d+_seg\d+\./i.test(name);
}

function isAudioSegmentFile(name) {
  if (isInitFile(name)) return false;
  return /_audio\d+_seg\d+\./i.test(name);
}

/** Any uploadable media segment (video or audio). */
function isTrackSegmentFile(name) {
  return isVideoSegmentFile(name) || isAudioSegmentFile(name);
}

function avgSegmentDuration(entries) {
  if (!entries?.length) return liveDelivery.segmentSeconds || 2;
  const sum = entries.reduce((s, e) => s + (e.duration || 2), 0);
  return sum / entries.length;
}

/** Time-based hold-back (Live Tester model): ~20s delay regardless of segment duration variance. */
function holdBackCountForEntries(entries) {
  const avg = avgSegmentDuration(entries);
  return Math.max(2, Math.ceil(liveDelivery.holdBackTargetSeconds / avg));
}

async function storeSessionTiming(sessionId, timing) {
  try {
    const { getRedisClient } = require('../utils/redisClient');
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(`live:timing:${sessionId}`, JSON.stringify(timing), { EX: 86400 });
    }
  } catch (_) {
    /* optional */
  }
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

function durationFor(sessionId, fileName, fallback = 2) {
  const map = segmentDurations.get(sessionId);
  const d = map?.get(fileName);
  if (typeof d === 'number' && d > 0.1) return d;
  return Math.max(0.5, liveDelivery.segmentSeconds || fallback);
}

function rememberDurations(sessionId, entries) {
  if (!segmentDurations.has(sessionId)) segmentDurations.set(sessionId, new Map());
  const map = segmentDurations.get(sessionId);
  for (const { name, duration } of entries) {
    if (name && duration > 0) map.set(name, duration);
  }
}

function parseMediamtxVariant(hlsDir, variantFile) {
  const variantPath = path.join(hlsDir, variantFile);
  if (!fs.existsSync(variantPath)) return { init: null, segments: [] };
  try {
    const content = fs.readFileSync(variantPath, 'utf8');
    const mapMatch = content.match(/#EXT-X-MAP:URI="([^"?]+)/);
    const init = mapMatch ? mapMatch[1] : null;
    const segments = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const inf = lines[i].match(/#EXTINF:([\d.]+)/i);
      if (!inf) continue;
      const next = (lines[i + 1] || '').trim();
      if (!next || next.startsWith('#')) continue;
      segments.push({ name: next, duration: parseFloat(inf[1]) });
    }
    return { init, segments };
  } catch (_) {
    return { init: null, segments: [] };
  }
}

function discoverVariantFiles(hlsDir) {
  try {
    const files = fs.readdirSync(hlsDir);
    const video = files.find((f) => /^video\d+_stream\.m3u8$/i.test(f)) || 'video1_stream.m3u8';
    const audio = files.find((f) => /^audio\d+_stream\.m3u8$/i.test(f)) || null;
    return { video, audio };
  } catch (_) {
    return { video: 'video1_stream.m3u8', audio: null };
  }
}

function getStreamPrefix(hlsDir) {
  const { video } = discoverVariantFiles(hlsDir);
  const parsed = parseMediamtxVariant(hlsDir, video);
  if (!parsed.init) return null;
  return parsed.init.replace(/_video\d+_init\.mp4$/i, '').replace(/_audio\d+_init\.mp4$/i, '');
}

async function syncDoneFromR2(sessionId, r2Prefix, done) {
  if (r2SyncedSessions.has(sessionId)) return;
  try {
    const dir = `${r2Prefix}/720p/`;
    const keys = await r2Storage.listObjects(dir);
    for (const k of keys) {
      const name = k.startsWith(dir) ? k.slice(dir.length) : k.split('/').pop();
      if (name && (isTrackSegmentFile(name) || isInitFile(name))) done.add(name);
    }
    r2SyncedSessions.add(sessionId);
  } catch (err) {
    console.warn('[LiveUploader] R2 sync failed:', sessionId, err.message);
  }
}

function shouldWritePlaylist(sessionId, publishableCount) {
  const prev = lastPlaylistWrite.get(sessionId);
  const now = Date.now();
  if (!prev) return true;
  if (publishableCount !== prev.count) return true;
  return (now - prev.at) >= PLAYLIST_WRITE_MIN_MS;
}

function getHlsDirForSession(streamKey) {
  const pathName = r2LiveStorage.getMediamtxPathName(streamKey);
  return path.join(liveDelivery.mediamtxHlsDir, pathName);
}

function filterCurrentStreamFiles(hlsDir, files) {
  const prefix = getStreamPrefix(hlsDir);
  if (!prefix) return files;
  return files.filter((f) => f.startsWith(prefix));
}

async function uploadSegment(sessionId, r2Prefix, localPath, fileName) {
  const r2Key = `${r2Prefix}/720p/${fileName}`;
  let body;
  try {
    body = fs.readFileSync(localPath);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  const lower = fileName.toLowerCase();
  const contentType = lower.endsWith('.m4s') || lower.endsWith('.mp4')
    ? 'video/iso.segment'
    : 'video/mp2t';
  await r2Storage.uploadFile(r2Key, body, contentType);
  return true;
}

async function uploadSegmentsParallel(sessionId, r2Prefix, pending) {
  for (let i = 0; i < pending.length; i += UPLOAD_CONCURRENCY) {
    const batch = pending.slice(i, i + UPLOAD_CONCURRENCY);
    const results = await Promise.all(
      batch.map(({ localPath, fileName }) => uploadSegment(sessionId, r2Prefix, localPath, fileName))
    );
    for (let j = 0; j < batch.length; j += 1) {
      if (results[j]) batch[j].uploaded = true;
    }
  }
}

/**
 * Build a media playlist (video or audio) with hold-back + sliding window for stable live edge.
 * Returns { body, publishableCount } or null.
 */
function buildTrackPlaylistBody(sessionId, segmentNames, initFile, opts = {}) {
  const entries = (opts.entries || segmentNames.map((name) => ({
    name,
    duration: durationFor(sessionId, name),
  }))).filter((e) => !isInitFile(e.name));
  const holdBack = opts.holdBack != null
    ? opts.holdBack
    : (entries.length > 0 ? holdBackCountForEntries(entries) : liveDelivery.holdBackSegments);
  const windowSize = liveDelivery.playlistWindow;
  const useEvent = opts.forceEvent === true;

  if (entries.length <= holdBack) return null;

  let publishable = entries.slice(0, entries.length - holdBack);
  let mediaSequence = 0;

  if (useEvent) {
    mediaSequence = 0;
  } else {
    if (publishable.length > windowSize) {
      publishable = publishable.slice(-windowSize);
    }
    const firstIdx = segmentIndex(publishable[0].name);
    mediaSequence = firstIdx >= 0 ? firstIdx : Math.max(0, entries.length - holdBack - publishable.length);
  }

  let maxDur = liveDelivery.segmentSeconds || 2;
  for (const seg of publishable) {
    maxDur = Math.max(maxDur, seg.duration || durationFor(sessionId, seg.name));
  }

  let body = '#EXTM3U\n#EXT-X-VERSION:7\n';
  body += `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(maxDur))}\n`;
  body += '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES\n';
  if (useEvent) {
    body += '#EXT-X-PLAYLIST-TYPE:EVENT\n';
  }
  body += `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}\n`;
  if (initFile) {
    body += `#EXT-X-MAP:URI="${initFile}"\n`;
  }
  for (const seg of publishable) {
    const dur = seg.duration || durationFor(sessionId, seg.name);
    body += `#EXTINF:${dur.toFixed(5)},\n${seg.name}\n`;
  }
  return {
    body,
    publishableCount: publishable.length,
    indices: publishable.map((s) => segmentIndex(s.name)),
    holdBack,
    avgSegmentSec: avgSegmentDuration(entries),
  };
}

function buildMasterPlaylist(hasAudio) {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  if (hasAudio) {
    lines.push(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="720p/audio.m3u8"'
    );
    lines.push(
      '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.42E01E,opus",AUDIO="audio"'
    );
  } else {
    lines.push('#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.42E01E"');
  }
  lines.push('720p/playlist.m3u8');
  lines.push('');
  return lines.join('\n');
}

async function uploadText(key, text) {
  await r2Storage.uploadFile(key, Buffer.from(text, 'utf8'), 'application/vnd.apple.mpegurl');
}

async function buildAndUploadPlaylists(sessionId, r2Prefix, allNames, hlsDir) {
  const { video: videoVariant, audio: audioVariant } = discoverVariantFiles(hlsDir);
  const videoParsed = parseMediamtxVariant(hlsDir, videoVariant);
  const audioParsed = audioVariant ? parseMediamtxVariant(hlsDir, audioVariant) : { init: null, segments: [] };

  rememberDurations(sessionId, videoParsed.segments);
  rememberDurations(sessionId, audioParsed.segments);

  const videoInit =
    videoParsed.init ||
    allNames.find((f) => /_video\d+_init\.mp4$/i.test(f)) ||
    null;
  const audioInit =
    audioParsed.init ||
    allNames.find((f) => /_audio\d+_init\.mp4$/i.test(f)) ||
    null;

  const videoSegs = allNames.filter(isVideoSegmentFile).sort(compareSegmentNames);
  const audioSegs = allNames.filter(isAudioSegmentFile).sort(compareSegmentNames);

  const videoPl = buildTrackPlaylistBody(sessionId, videoSegs, videoInit, {
    entries: videoParsed.segments,
  });
  if (!videoPl) return false;

  await storeSessionTiming(sessionId, {
    holdBackSegments: videoPl.holdBack,
    holdBackSeconds: Math.round(videoPl.holdBack * videoPl.avgSegmentSec),
    avgSegmentSec: Math.round(videoPl.avgSegmentSec * 10) / 10,
  });

  // Align audio to the same segment indices as published video (prevents A/V desync).
  let audioPl = null;
  if (audioSegs.length > 0 && audioInit) {
    const indexSet = new Set(videoPl.indices.filter((i) => i >= 0));
    const alignedAudio = audioSegs.filter((s) => indexSet.has(segmentIndex(s)));
    if (alignedAudio.length > 0) {
      let maxDur = liveDelivery.segmentSeconds || 2;
      for (const seg of alignedAudio) maxDur = Math.max(maxDur, durationFor(sessionId, seg));
      const firstIdx = segmentIndex(alignedAudio[0]);
      let body = '#EXTM3U\n#EXT-X-VERSION:7\n';
      body += `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(maxDur))}\n`;
      body += '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES\n';
      body += `#EXT-X-MEDIA-SEQUENCE:${firstIdx >= 0 ? firstIdx : videoPl.indices[0] || 0}\n`;
      body += `#EXT-X-MAP:URI="${audioInit}"\n`;
      for (const seg of alignedAudio) {
        body += `#EXTINF:${durationFor(sessionId, seg).toFixed(5)},\n${seg}\n`;
      }
      audioPl = { body, publishableCount: alignedAudio.length };
    }
  }

  const master = buildMasterPlaylist(!!audioPl);
  const playlistKey = `${r2Prefix}/720p/playlist.m3u8`;
  const audioKey = `${r2Prefix}/720p/audio.m3u8`;
  const masterKey = `${r2Prefix}/master.m3u8`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await uploadText(playlistKey, videoPl.body);
      if (audioPl) await uploadText(audioKey, audioPl.body);
      await uploadText(masterKey, master);
      return true;
    } catch (err) {
      const retryable = /concurrent request rate|SlowDown|503|429/i.test(String(err.message));
      if (!retryable || attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return false;
}

/** Test helper — video-only body (legacy signature). */
function buildPlaylistBody(segmentNames, hlsDir) {
  const sessionId = '_test';
  if (hlsDir) {
    const { video } = discoverVariantFiles(hlsDir);
    const parsed = parseMediamtxVariant(hlsDir, video);
    rememberDurations(sessionId, parsed.segments);
  }
  const init =
    segmentNames.find((f) => /_video\d+_init\.mp4$/i.test(f)) ||
    segmentNames.find((f) => /_init\.mp4$/i.test(f)) ||
    null;
  const result = buildTrackPlaylistBody(
    sessionId,
    segmentNames.filter((n) => isVideoSegmentFile(n) || (!isAudioSegmentFile(n) && /_seg\d+\./i.test(n))),
    init
  );
  return result ? result.body : null;
}

function countPublishableVideoSegments(videoParsed) {
  const entries = videoParsed?.segments || [];
  if (!entries.length) return 0;
  const holdBack = holdBackCountForEntries(entries);
  return entries.length > holdBack ? entries.length - holdBack : 0;
}

/** Collect segment filenames MediaMTX has finished writing (listed in variant playlists). */
function collectListedSegments(videoParsed, audioParsed) {
  const listed = new Set();
  if (videoParsed?.init) listed.add(videoParsed.init);
  for (const e of videoParsed?.segments || []) listed.add(e.name);
  if (audioParsed?.init) listed.add(audioParsed.init);
  for (const e of audioParsed?.segments || []) listed.add(e.name);
  return listed;
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
  await syncDoneFromR2(sessionId, r2Prefix, done);

  // Refresh durations from live MediaMTX playlists every poll.
  const { video: videoVariant, audio: audioVariant } = discoverVariantFiles(hlsDir);
  const videoParsed = parseMediamtxVariant(hlsDir, videoVariant);
  const audioParsed = audioVariant ? parseMediamtxVariant(hlsDir, audioVariant) : { init: null, segments: [] };
  rememberDurations(sessionId, videoParsed.segments);
  rememberDurations(sessionId, audioParsed.segments);

  const files = filterCurrentStreamFiles(
    hlsDir,
    fs.readdirSync(hlsDir)
      .filter((f) => {
        if (f.endsWith('.m3u8') || f.endsWith('.map')) return false;
        return /\.(ts|m4s|mp4|aac)$/i.test(f);
      })
      .sort(compareSegmentNames)
  );

  const currentPrefix = getStreamPrefix(hlsDir);
  for (const name of [...done]) {
    if (!isTrackSegmentFile(name) && !isInitFile(name)) {
      done.delete(name);
      continue;
    }
    if (currentPrefix && !name.startsWith(currentPrefix)) done.delete(name);
  }

  const pending = [];
  const listed = collectListedSegments(videoParsed, audioParsed);
  for (const fileName of files) {
    if (done.has(fileName)) continue;
    // Only upload segments MediaMTX already listed (finished). Avoids partial-file uploads.
    if (!listed.has(fileName)) continue;
    const localPath = path.join(hlsDir, fileName);
    try {
      const stat = fs.statSync(localPath);
      if (stat.size < 100) continue;
      pending.push({ localPath, fileName, uploaded: false });
    } catch (_) {
      /* skip unreadable */
    }
  }

  try {
    if (pending.length > 0) {
      await uploadSegmentsParallel(sessionId, r2Prefix, pending);
      for (const item of pending) {
        if (item.uploaded) done.add(item.fileName);
      }
    }

    if (videoParsed.init) done.add(videoParsed.init);
    if (audioParsed.init) done.add(audioParsed.init);

    const allNames = [...done];
    const publishableCount = countPublishableVideoSegments(videoParsed);
    if (publishableCount === 0) return;

    let lessonId = session.lesson_id;
    if (!lessonId) {
      const lessonRes = await db.query(
        'SELECT lesson_id FROM live_sessions WHERE id = $1',
        [sessionId]
      );
      lessonId = lessonRes.rows[0]?.lesson_id;
    }

    let playlistWritten = false;
    if (shouldWritePlaylist(sessionId, publishableCount)) {
      playlistWritten = await buildAndUploadPlaylists(sessionId, r2Prefix, allNames, hlsDir);
      if (playlistWritten) {
        lastPlaylistWrite.set(sessionId, { at: Date.now(), count: publishableCount });
        const prevLogged = session._lastLoggedPublishable;
        if (prevLogged !== publishableCount) {
          session._lastLoggedPublishable = publishableCount;
          liveDiagnosticsService.append({
            type: 'playlist_built',
            lessonId,
            sessionId,
            data: {
              videoSegs: publishableCount,
              holdBackSeconds: (await getSessionTiming(sessionId))?.holdBackSeconds,
            },
          });
        }
      }
    }

    const minPublishable = Math.max(3, liveDelivery.cdnMinSegments);

    if (!session.hls_ready_at && playlistWritten) {
      await liveIngestService.markHlsReady(sessionId);
      if (lessonId) {
        await publishLiveEvent({ type: 'hls_ready', lessonId, sessionId });
      }
    }

    if (publishableCount >= minPublishable && playlistWritten) {
      await markCdnReady(sessionId, lessonId);
    }
  } catch (err) {
    console.warn('[LiveUploader] session processing failed:', sessionId, err.message);
  }
}

async function runWithConcurrency(items, limit, fn) {
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item)).finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

async function pollActiveSessions() {
  try {
    const result = await db.query(
      `SELECT id, lesson_id, ingest_stream_key, hls_ready_at
       FROM live_sessions
       WHERE status = 'active' AND provider = 'r2_live' AND ingest_stream_key IS NOT NULL`
    );
    const limit = liveDelivery.uploaderSessionConcurrency;
    await runWithConcurrency(result.rows, limit, processSession);

    const activeIds = new Set(result.rows.map((r) => r.id));
    for (const id of uploadedSegments.keys()) {
      if (!activeIds.has(id)) {
        uploadedSegments.delete(id);
        segmentDurations.delete(id);
        r2SyncedSessions.delete(id);
        lastPlaylistWrite.delete(id);
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
  console.log(
    `[LiveUploader] Started (poll ${intervalMs}ms, upload concurrency ${UPLOAD_CONCURRENCY}, ` +
    `session concurrency ${liveDelivery.uploaderSessionConcurrency}, hold-back target ${liveDelivery.holdBackTargetSeconds}s, window ${liveDelivery.playlistWindow})`
  );
  setInterval(pollActiveSessions, intervalMs);
  pollActiveSessions();
}

module.exports = {
  startLiveSegmentUploader,
  pollActiveSessions,
  processSession,
  buildPlaylistBody,
  buildTrackPlaylistBody,
  getSessionTiming,
};
