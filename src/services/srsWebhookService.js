/**
 * SRS RTMP → HLS webhooks.
 *
 * OBS publishes to rtmp://host:1935/live/<streamKey>
 * SRS packages HLS and calls on_publish / on_hls / on_unpublish.
 * We mirror segments + playlists to R2 for authenticated student playback.
 *
 * Skip-safe rules:
 * 1) Ack on_hls immediately (SRS blocks packaging until response)
 * 2) Upload .ts BEFORE updating any playlist that names it
 * 3) Retry R2 uploads; never advance playlist if segment upload failed
 * 4) Keep playback_ready across brief OBS reconnects
 */
const fs = require('fs');
const path = require('path');
const liveIngestService = require('./liveIngestService');
const r2LiveStorage = require('./r2LiveStorageService');
const r2Storage = require('./r2StorageService');
const liveDelivery = require('../config/liveDelivery');
const { publishLiveEvent } = require('../utils/liveEventBus');
const liveRecorderService = require('./liveRecorderService');


/** streamKey → { sessionId, lessonId, segments: [{ name, duration, seq }], playbackReady } */
const sessionState = new Map();

const HLS_ROOT = liveDelivery.mediamtxHlsDir || '/var/mediamtx/hls';
const MIN_SEGMENTS = Math.max(2, liveDelivery.cdnMinSegments || 3);
const PLAYLIST_WINDOW = Math.max(8, liveDelivery.playlistWindow || 20);
const FRAGMENT_SECONDS = Math.max(1, Math.ceil(liveDelivery.segmentSeconds || 2));
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_BACKOFF_MS = 250;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function emptyManifest() {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${FRAGMENT_SECONDS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '',
  ].join('\n');
}

/** Single-variant master — SRS has no transcoder in this stack. */
function masterManifest() {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080',
    'index.m3u8',
    '',
  ].join('\n');
}

function buildMediaPlaylist(segments, { endList = false } = {}) {
  if (!segments.length) return emptyManifest();
  const maxDur = Math.max(
    FRAGMENT_SECONDS,
    ...segments.map((s) => Math.ceil(Number(s.duration) || FRAGMENT_SECONDS))
  );
  const firstSeq = Number.isFinite(segments[0].seq) ? segments[0].seq : 0;
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${maxDur}`,
    `#EXT-X-MEDIA-SEQUENCE:${firstSeq}`,
  ];
  if (endList || liveDelivery.playlistType === 'event') lines.push('#EXT-X-PLAYLIST-TYPE:EVENT');
  for (const seg of segments) {
    if (seg.discontinuity) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${Number(seg.duration || FRAGMENT_SECONDS).toFixed(3)},`);
    lines.push(seg.name);
  }
  if (endList) lines.push('#EXT-X-ENDLIST');
  lines.push('');
  return lines.join('\n');
}

function resolveHlsFile(file, cwd) {
  if (!file) return null;
  const raw = String(file);
  if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw;

  if (cwd) {
    const fromCwd = path.resolve(String(cwd), raw);
    if (fs.existsSync(fromCwd)) return fromCwd;
  }

  const normalized = path.normalize(raw).replace(/\\/g, '/');
  const marker = '/var/mediamtx/hls/';
  const at = normalized.indexOf(marker);
  if (at !== -1) {
    const under = path.join(HLS_ROOT, normalized.slice(at + marker.length));
    if (fs.existsSync(under)) return under;
  }

  const base = path.basename(normalized);
  const candidates = [
    path.join(HLS_ROOT, raw),
    path.join(HLS_ROOT, normalized),
    path.join(HLS_ROOT, 'live', base),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return fs.existsSync(raw) ? raw : null;
}

async function uploadBytes(key, body, contentType) {
  let lastErr = null;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      await r2Storage.uploadFile(key, body, contentType);
      return true;
    } catch (err) {
      lastErr = err;
      if (attempt < UPLOAD_ATTEMPTS) await sleep(attempt * UPLOAD_BACKOFF_MS);
    }
  }
  console.error('[SRS] upload failed:', key, lastErr?.message || lastErr);
  return false;
}

async function uploadText(key, text) {
  return uploadBytes(key, Buffer.from(text, 'utf8'), 'application/vnd.apple.mpegurl');
}

async function emitReady(lessonId, sessionId, type) {
  if (!lessonId) return;
  publishLiveEvent({ type, lessonId: String(lessonId), sessionId }).catch(() => {});
}

async function handleOnPublish(req, res) {
  try {
    const body = req.body || {};
    const action = body.action;
    if (action && action !== 'on_publish') return res.send('0');

    const stream = String(body.stream || '').trim();
    if (!stream) {
      console.warn('[SRS] on_publish rejected: missing stream key');
      return res.status(403).send('1');
    }

    if (stream.endsWith('_720p') || stream.endsWith('_480p')) {
      return res.send('0');
    }

    const session = await liveIngestService.getSessionByStreamKey(stream);
    if (!session) {
      console.warn('[SRS] on_publish rejected: unknown stream key');
      return res.status(403).send('1');
    }

    const r2LivePrefix = r2LiveStorage.getLiveSessionPrefix(session.id);

    const prior = sessionState.get(stream);
    const isResume = (prior?.liveSegments?.length > 0) || !!session.playback_ready_at;

    // Seed playlists so early player polls never cache a 404.
    // On resume, keep existing R2 media playlist — blanking it would drop viewers.
    await uploadText(`${r2LivePrefix}/master.m3u8`, masterManifest());
    if (!isResume) {
      await uploadText(`${r2LivePrefix}/index.m3u8`, emptyManifest());
      await liveIngestService.clearPlaybackReady(session.id);
    }

    await liveIngestService.markHlsReady(session.id);
    
    // Start FFmpeg direct-to-R2 recorder
    liveRecorderService.startRecording(stream).catch(err => console.error('[SRS] Recorder start failed:', err));

    sessionState.set(stream, {
      sessionId: session.id,
      lessonId: session.lesson_id,
      liveSegments: isResume ? (prior?.liveSegments || []) : [],
      playbackReady: isResume,
      pendingDiscontinuity: isResume,
    });

    await emitReady(session.lesson_id, session.id, 'hls_ready');
    if (isResume || session.playback_ready_at) {
      await emitReady(session.lesson_id, session.id, 'playback_ready');
    }

    console.log(
      `[SRS] OBS connected: stream=${stream.slice(0, 8)}… session=${session.id} resume=${isResume}`
    );
    return res.send('0');
  } catch (err) {
    console.error('[SRS] on_publish error:', err.message);
    return res.status(500).send('1');
  }
}

async function handleOnUnpublish(req, res) {
  res.send('0');
  try {
    const stream = String(req.body?.stream || '').trim();
    if (!stream) return;
    
    // Stop FFmpeg recorder
    liveRecorderService.stopRecording(stream).catch(err => console.error('[SRS] Recorder stop failed:', err));

    const state = sessionState.get(stream);
    if (!state) return;

    // Keep playback_ready + recordingSegments so brief OBS reconnects don't drop students.
    state.liveSegments = [];
    console.log(`[SRS] OBS disconnected: session=${state.sessionId}`);
  } catch (err) {
    console.error('[SRS] on_unpublish error:', err.message);
  }
}

async function maybeMarkPlaybackReady(stream, state) {
  if (state.playbackReady) return;
  if (state.liveSegments.length < MIN_SEGMENTS) return;

  state.playbackReady = true;
  await liveIngestService.markPlaybackReady(state.sessionId);
  await emitReady(state.lessonId, state.sessionId, 'playback_ready');
  console.log(
    `[SRS] playback_ready session=${state.sessionId} segments=${state.liveSegments.length}`
  );
}

async function handleOnHls(req, res) {
  // Ack immediately — SRS blocks HLS packaging until this responds.
  res.send('0');

  const body = req.body || {};
  if (body.action && body.action !== 'on_hls') return;

  const stream = String(body.stream || '').trim();
  if (!stream || stream.endsWith('_720p') || stream.endsWith('_480p')) return;

  let state = sessionState.get(stream);
  if (!state) {
    const session = await liveIngestService.getSessionByStreamKey(stream);
    if (!session) return;
    state = {
      sessionId: session.id,
      lessonId: session.lesson_id,
      liveSegments: [],
      playbackReady: !!session.playback_ready_at,
      pendingDiscontinuity: false,
    };
    sessionState.set(stream, state);
  }

  const seq = Number(body.seq_no);
  const duration = Number(body.duration) || FRAGMENT_SECONDS;
  const tsName = `seg-${Date.now()}.ts`;

  const tsPath = resolveHlsFile(body.file, body.cwd);
  if (!tsPath) {
    console.error('[SRS] segment file missing:', body.file, 'cwd=', body.cwd);
    return;
  }

  let tsBuffer;
  try {
    tsBuffer = fs.readFileSync(tsPath);
  } catch (err) {
    console.error('[SRS] segment read failed:', tsPath, err.message);
    return;
  }

  const r2LivePrefix = r2LiveStorage.getLiveSessionPrefix(state.sessionId);

  try {
    // Segment MUST land in R2 before any playlist that names it (prevents player 404 skips).
    const liveOk = await uploadBytes(`${r2LivePrefix}/${tsName}`, tsBuffer, 'video/mp2t');
    if (!liveOk) return;

    const entry = {
      name: tsName,
      duration,
      seq: Number.isFinite(seq) ? seq : state.liveSegments.length,
      discontinuity: !!state.pendingDiscontinuity,
    };
    state.pendingDiscontinuity = false;

    if (!state.liveSegments.some((s) => s.name === tsName)) {
      state.liveSegments.push(entry);
      if (liveDelivery.playlistType !== 'event') {
        while (state.liveSegments.length > PLAYLIST_WINDOW) state.liveSegments.shift();
      }
    }

    const livePl = buildMediaPlaylist(state.liveSegments);

    const plOk = await uploadText(`${r2LivePrefix}/index.m3u8`, livePl);
    await uploadText(`${r2LivePrefix}/master.m3u8`, masterManifest());

    if (plOk) await maybeMarkPlaybackReady(stream, state);
  } catch (err) {
    console.error('[SRS] on_hls upload error:', err.message);
  }
}

module.exports = {
  handleOnPublish,
  handleOnUnpublish,
  handleOnHls,
  _buildMediaPlaylist: buildMediaPlaylist,
  _masterManifest: masterManifest,
  _resolveHlsFile: resolveHlsFile,
  _sessionState: sessionState,
};
