/**
 * Throttled live stats socket broadcasts (YouTube/FB style).
 * Viewer count updates are coalesced — not emitted on every heartbeat.
 */
const liveDelivery = require('../config/liveDelivery');

/** @type {Map<string, { at: number, pending: object | null }>} */
const lastEmit = new Map();

function getThrottleMs() {
  return liveDelivery.statsBroadcastMs;
}

function emitToRoom(lessonId, payload) {
  try {
    const getIo = require('../socket').getIo;
    getIo().to(String(lessonId)).emit('liveStatsUpdated', payload);
  } catch (_) {
    /* socket not ready */
  }
}

/**
 * Broadcast live stats to everyone in the lesson room.
 * @param {string} lessonId
 * @param {object} payload
 * @param {{ force?: boolean }} [opts] force=true skips throttle (join/leave/status change)
 */
function broadcastLiveStats(lessonId, payload, opts = {}) {
  const force = opts.force === true;
  const key = String(lessonId);
  const now = Date.now();
  const throttle = getThrottleMs();
  const prev = lastEmit.get(key);

  if (!force && prev && now - prev.at < throttle) {
    lastEmit.set(key, { at: prev.at, pending: { ...prev.pending, ...payload } });
    return false;
  }

  const merged = prev?.pending ? { ...prev.pending, ...payload } : payload;
  emitToRoom(key, merged);
  lastEmit.set(key, { at: now, pending: null });
  return true;
}

/** Emit to a single socket only (joinRoom — avoids room-wide DB-driven storms). */
function emitLiveStatsToSocket(socket, payload) {
  if (!socket) return;
  socket.emit('liveStatsUpdated', payload);
}

function flushPending() {
  const now = Date.now();
  const throttle = getThrottleMs();
  for (const [lessonId, entry] of lastEmit.entries()) {
    if (!entry.pending) continue;
    if (now - entry.at < throttle) continue;
    emitToRoom(lessonId, entry.pending);
    lastEmit.set(lessonId, { at: now, pending: null });
  }
}

// Flush coalesced viewer-count updates periodically.
setInterval(flushPending, Math.max(2000, Math.floor(getThrottleMs() / 2))).unref?.();

module.exports = {
  broadcastLiveStats,
  emitLiveStatsToSocket,
  flushPending,
};
