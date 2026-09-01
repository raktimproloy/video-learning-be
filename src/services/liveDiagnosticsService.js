/**
 * R2 live pipeline diagnostics — server + client events for debugging playback.
 * Writes async to logs/live-diag.jsonl and logs/live-diag-latest.json.
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
const JSONL = path.join(LOG_DIR, 'live-diag.jsonl');
const LATEST = path.join(LOG_DIR, 'live-diag-latest.json');

const queue = [];
let draining = false;
let latestMem = null;

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function sessionKey(lessonId, sessionId) {
  return sessionId || lessonId || 'unknown';
}

function applyToLatest(row) {
  let latest = latestMem || {
    updatedAt: now(),
    events: [],
    sessions: {},
    summary: {},
  };
  latest.updatedAt = row.ts;
  latest.events = [...(latest.events || []).slice(-300), row];

  const key = sessionKey(row.lessonId, row.sessionId);
  if (row.lessonId || row.sessionId) {
    if (!latest.sessions[key]) {
      latest.sessions[key] = {
        lessonId: row.lessonId || null,
        sessionId: row.sessionId || null,
        timeline: [],
      };
    }
    const sess = latest.sessions[key];
    sess.timeline = [...(sess.timeline || []).slice(-120), row];
    if (row.type) sess.lastType = row.type;
    if (row.role) sess.role = row.role;
    Object.assign(sess, row.data && typeof row.data === 'object' ? row.data : {});
  }

  const summary = latest.summary || {};
  const d = row.data || {};

  if (row.type === 'playback_sample') {
    if (d.buffering || d.status === 'buffering') summary.sawBuffering = true;
    if (typeof d.latencyMs === 'number' && d.latencyMs >= 60000) summary.sawHighLatency60s = true;
    if (typeof d.latencySec === 'number' && d.latencySec >= 60) summary.sawHighLatency60s = true;
    if (d.timeJump) summary.sawTimeJump = true;
    if (d.hlsFatal) summary.sawHlsFatal = true;
    if (d.hlsError) summary.lastHlsError = d.hlsError;
    summary.lastPlayback = {
      status: d.status,
      latencyMs: d.latencyMs,
      bufferMs: d.bufferMs,
      at: row.ts,
    };
  }

  if (row.type === 'playlist_built' || row.type === 'playlist_served') {
    summary.lastPlaylist = {
      source: d.source || row.type,
      videoSegs: d.videoSegs ?? d.segCount,
      hasAudio: d.hasAudio,
      holdBackSeconds: d.holdBackSeconds,
      at: row.ts,
    };
  }

  if (row.type === 'playback_ready') {
    summary.playbackReadyAt = row.ts;
    summary.playbackReady = d;
  }

  if (row.type === 'whip_publish') {
    summary.lastWhip = { ok: d.ok !== false, at: row.ts, ...(d.ok === false ? { error: d.error } : {}) };
  }

  if (row.type === 'error' || row.level === 'error') {
    summary.lastError = row.message || d.message || d.error || row.data;
  }

  latest.summary = summary;
  latestMem = latest;
  return latest;
}

function drain() {
  if (draining || !queue.length) return;
  draining = true;
  setImmediate(() => {
    try {
      ensureDir();
      const batch = queue.splice(0, 80);
      if (!batch.length) {
        draining = false;
        return;
      }
      const lines = batch.map((row) => JSON.stringify(row)).join('\n') + '\n';
      fs.appendFileSync(JSONL, lines, 'utf8');
      if (latestMem) {
        fs.writeFileSync(LATEST, JSON.stringify(latestMem, null, 2), 'utf8');
      }
    } catch (err) {
      console.warn('[LiveDiag] write failed:', err.message);
    }
    draining = false;
    if (queue.length) drain();
  });
}

function append(event) {
  const row = { ts: now(), ...event };
  applyToLatest(row);
  queue.push(row);
  drain();

  const tag = row.type || 'event';
  const noisy = ['playback_sample', 'playlist_served'];
  if (!noisy.includes(tag)) {
    const sid = row.sessionId ? row.sessionId.slice(0, 8) : '';
    const msg = row.message || '';
    console.log(`[LiveDiag] ${tag}${sid ? ` session=${sid}` : ''} ${msg}`.trim());
  }
  return row;
}

function readLatest() {
  ensureDir();
  if (latestMem) return latestMem;
  if (!fs.existsSync(LATEST)) {
    return { updatedAt: null, events: [], sessions: {}, summary: {} };
  }
  try {
    latestMem = JSON.parse(fs.readFileSync(LATEST, 'utf8'));
    return latestMem;
  } catch (_) {
    return { updatedAt: null, events: [], sessions: {}, summary: {} };
  }
}

function getSessionReport(lessonId, sessionId) {
  const latest = readLatest();
  const key = sessionKey(lessonId, sessionId);
  const sess = latest.sessions?.[key] || null;
  return {
    updatedAt: latest.updatedAt,
    summary: latest.summary || {},
    session: sess,
    issueChecklist: buildIssueChecklist(latest.summary || {}),
  };
}

function buildIssueChecklist(summary) {
  return {
    buffering: !!summary.sawBuffering,
    delayOver60s: !!summary.sawHighLatency60s,
    timeJump: !!summary.sawTimeJump,
    hlsFatal: !!summary.sawHlsFatal,
    whipFailed: summary.lastWhip?.ok === false,
    lastError: summary.lastError || null,
    lastHlsError: summary.lastHlsError || null,
    lastPlaylist: summary.lastPlaylist || null,
    lastPlayback: summary.lastPlayback || null,
    playbackReady: summary.playbackReady || null,
  };
}

function getGlobalReport() {
  const latest = readLatest();
  const sessions = Object.values(latest.sessions || {}).map((s) => ({
    lessonId: s.lessonId,
    sessionId: s.sessionId,
    role: s.role,
    lastType: s.lastType,
    eventCount: (s.timeline || []).length,
  }));
  return {
    updatedAt: latest.updatedAt,
    logFile: JSONL,
    latestFile: LATEST,
    summary: latest.summary || {},
    issueChecklist: buildIssueChecklist(latest.summary || {}),
    recentEvents: (latest.events || []).slice(-40),
    sessions,
  };
}

module.exports = {
  append,
  readLatest,
  getSessionReport,
  getGlobalReport,
  buildIssueChecklist,
  LOG_DIR,
  LATEST,
  JSONL,
};
