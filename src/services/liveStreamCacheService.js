/**
 * Short-lived cache for live HLS endpoints (Redis-backed when REDIS_URL is set).
 */
const ttlCache = require('../utils/ttlCache');

const TTL_MS = {
  activeSession: 2500,
  lessonRow: 5000,
  courseRow: 5000,
  courseMeta: 60000,
  enrolled: 60000,
  liveStats: 3000,
  viewerCount: 5000,
};

async function cached(key, ttlMs, loader) {
  return ttlCache.getOrSet(key, ttlMs, loader);
}

function cacheGet(key) {
  return ttlCache.get(key);
}

function cacheSet(key, value, ttlMs) {
  ttlCache.set(key, value, ttlMs);
}

function invalidateLesson(lessonId) {
  const id = String(lessonId);
  ttlCache.delete(`lesson:${id}`);
  ttlCache.delete(`activeSession:${id}`);
  ttlCache.delete(`liveStats:${id}`);
}

module.exports = {
  TTL_MS,
  cacheGet,
  cacheSet,
  cached,
  invalidateLesson,
};
