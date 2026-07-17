const cache = require('./ttlCache');

function bootstrapCacheKey(userId) {
  return `user:${userId}:bootstrap`;
}

/** Invalidate cached /me/bootstrap after permission or profile changes. */
function invalidateUserBootstrap(userId) {
  if (!userId) return;
  cache.delete(bootstrapCacheKey(userId));
}

module.exports = {
  bootstrapCacheKey,
  invalidateUserBootstrap,
};
