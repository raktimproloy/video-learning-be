/**
 * Short-lived in-memory cache for live HLS endpoints.
 * Cuts repeated DB hits when many students poll playlists/segments.
 */
const TTL_MS = {
  activeSession: 2500,
  lessonRow: 5000,
  courseRow: 5000,
  enrolled: 60000,
};

const store = new Map();

function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function cached(key, ttlMs, loader) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
}

function invalidateLesson(lessonId) {
  for (const key of store.keys()) {
    if (key.includes(String(lessonId))) store.delete(key);
  }
}

module.exports = {
  TTL_MS,
  cacheGet,
  cacheSet,
  cached,
  invalidateLesson,
};
