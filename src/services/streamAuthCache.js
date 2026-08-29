const videoService = require('./videoService');

const TTL_MS = 90_000;
const cache = new Map();

function key(videoId, userId, role) {
  return `${videoId}:${userId || 'guest'}:${role || 'guest'}`;
}

function getCached(videoId, userId, role) {
  const hit = cache.get(key(videoId, userId, role));
  if (!hit || hit.expires <= Date.now()) return null;
  return hit;
}

function setCached(videoId, userId, role, value) {
  cache.set(key(videoId, userId, role), { ...value, expires: Date.now() + TTL_MS });
  if (cache.size > 5000) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

async function authorizeStream(userId, role, video) {
  const cached = getCached(video.id, userId, role);
  if (cached) return cached;

  if (!userId) {
    if (!video.is_preview) {
      const denied = { allowed: false, status: 401, message: 'Authentication required' };
      setCached(video.id, userId, role, denied);
      return denied;
    }
    const ok = { allowed: true, isLocked: false };
    setCached(video.id, userId, role, ok);
    return ok;
  }

  try {
    const access = await videoService.assertPlaybackAccess(userId, video, role);
    const result = { allowed: true, isLocked: access.isLocked };
    setCached(video.id, userId, role, result);
    return result;
  } catch (e) {
    const msg = e.message || 'Access denied';
    const status = msg === 'Access denied' ? 403 : 403;
    const denied = { allowed: false, status, message: msg };
    setCached(video.id, userId, role, denied);
    return denied;
  }
}

module.exports = {
  authorizeStream,
};
