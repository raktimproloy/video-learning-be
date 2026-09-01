/**
 * R2 live ingest: WHIP stream keys, playback URLs, MediaMTX auth.
 */
const crypto = require('crypto');
const db = require('../../db');
const liveDelivery = require('../config/liveDelivery');
const r2LiveStorage = require('./r2LiveStorageService');

function generateStreamKey() {
  return crypto.randomBytes(16).toString('hex');
}

async function setSessionStreamKey(sessionId, streamKey) {
  await db.query(
    `UPDATE live_sessions SET ingest_stream_key = $1, updated_at = NOW() WHERE id = $2`,
    [streamKey, sessionId]
  );
}

async function getSessionByStreamKey(streamKey) {
  if (!streamKey) return null;
  const result = await db.query(
    `SELECT * FROM live_sessions WHERE ingest_stream_key = $1 AND status = 'active' LIMIT 1`,
    [streamKey]
  );
  return result.rows[0] || null;
}

function getWhipUrl(streamKey) {
  const base = String(liveDelivery.mediamtxWhipPublicUrl || process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
  const pathName = r2LiveStorage.getMediamtxPathName(streamKey);
  return `${base}/${pathName}/whip`;
}

function getPlaylistApiUrl(lessonId, baseUrl) {
  const origin = String(baseUrl || process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
  return `${origin}/v1/lessons/${lessonId}/live/playlist`;
}

/**
 * Validate MediaMTX HTTP auth hook request.
 * @param {object} body - { path, action, ip, user, password, token, query }
 */
async function validateIngestAuth(body, headers = {}) {
  const secret = headers['x-live-ingest-secret'] || headers['X-Live-Ingest-Secret']
    || body?.secret || null;
  const expected = liveDelivery.ingestAuthSecret;
  if (secret && secret !== expected) {
    return { ok: false, reason: 'invalid_secret' };
  }
  // When secret not provided (MediaMTX hook), allow only if path matches active session

  const path = body?.path || body?.name || '';
  const match = String(path).match(/^live_(.+)$/);
  if (!match) return { ok: false, reason: 'invalid_path' };

  const streamKey = match[1];
  const session = await getSessionByStreamKey(streamKey);
  if (!session) return { ok: false, reason: 'session_not_found' };

  const action = body?.action || 'publish';
  if (action === 'publish' || action === 'read') {
    return { ok: true, session };
  }
  return { ok: false, reason: 'invalid_action' };
}

/**
 * Credentials for teacher (publisher) or student (subscriber).
 */
async function getCredentials(lessonId, liveSessionId, uid, role, baseUrl) {
  const sessionRes = await db.query('SELECT * FROM live_sessions WHERE id = $1', [liveSessionId]);
  const session = sessionRes.rows[0];
  if (!session || session.provider !== 'r2_live') return null;

  let streamKey = session.ingest_stream_key;
  if (!streamKey && role === 'publisher') {
    streamKey = generateStreamKey();
    await setSessionStreamKey(liveSessionId, streamKey);
  }

  const playlistUrl = getPlaylistApiUrl(lessonId, baseUrl);

  if (role === 'publisher') {
    if (!streamKey) return null;
    return {
      provider: 'r2_live',
      sessionId: liveSessionId,
      streamKey,
      whipUrl: getWhipUrl(streamKey),
      pathName: r2LiveStorage.getMediamtxPathName(streamKey),
      playbackUrl: playlistUrl,
      uid,
    };
  }

  return {
    provider: 'r2_live',
    sessionId: liveSessionId,
    playlistUrl,
    uid,
  };
}

async function markHlsReady(sessionId) {
  await db.query(
    `UPDATE live_sessions SET hls_ready_at = COALESCE(hls_ready_at, NOW()), updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
}

async function markPlaybackReady(sessionId) {
  try {
    await db.query(
      `UPDATE live_sessions SET playback_ready_at = COALESCE(playback_ready_at, NOW()), updated_at = NOW() WHERE id = $1`,
      [sessionId]
    );
  } catch (err) {
    if (!/playback_ready_at|column .* does not exist/i.test(err.message || '')) {
      throw err;
    }
  }
}

async function clearPlaybackReady(sessionId) {
  try {
    await db.query(
      `UPDATE live_sessions SET playback_ready_at = NULL, updated_at = NOW() WHERE id = $1`,
      [sessionId]
    );
  } catch (err) {
    if (!/playback_ready_at|column .* does not exist/i.test(err.message || '')) {
      throw err;
    }
  }
}

module.exports = {
  generateStreamKey,
  setSessionStreamKey,
  getSessionByStreamKey,
  getWhipUrl,
  getPlaylistApiUrl,
  validateIngestAuth,
  getCredentials,
  markHlsReady,
  markPlaybackReady,
  clearPlaybackReady,
};
