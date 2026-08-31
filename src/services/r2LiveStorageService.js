/**
 * R2 path helpers and lifecycle for live HLS sessions.
 *
 * Active live:  live/sessions/{liveSessionId}/
 * Processing:    live/sessions/{id}/.processing/{taskId}/  (optional staging)
 * Final VOD:     teachers/{teacherId}/courses/{courseId}/lessons/{lessonId}/videos/{videoId}/
 */
const r2Storage = require('./r2StorageService');

function getLiveSessionPrefix(sessionId) {
  return `live/sessions/${sessionId}`;
}

function getLiveProcessingPrefix(sessionId, taskId) {
  return `${getLiveSessionPrefix(sessionId)}/.processing/${taskId}`;
}

function getMediamtxPathName(streamKey) {
  return `live_${streamKey}`;
}

async function cleanupLiveSession(sessionId) {
  if (!r2Storage.isConfigured || !sessionId) return;
  const prefix = getLiveSessionPrefix(sessionId);
  try {
    await r2Storage.deletePrefix(prefix);
    console.log('[R2Live] Cleaned up live session prefix:', prefix);
  } catch (err) {
    console.warn('[R2Live] cleanupLiveSession failed:', prefix, err.message);
  }
}

async function promoteLiveToVideo(liveSessionId, videoPrefix, taskId) {
  const processingPrefix = getLiveProcessingPrefix(liveSessionId, taskId);
  await r2Storage.promoteProcessingPrefix(processingPrefix, videoPrefix, ['720p', 'original']);
  await cleanupLiveSession(liveSessionId);
}

module.exports = {
  getLiveSessionPrefix,
  getLiveProcessingPrefix,
  getMediamtxPathName,
  cleanupLiveSession,
  promoteLiveToVideo,
};
