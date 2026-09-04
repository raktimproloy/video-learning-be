/**
 * R2 path helpers and lifecycle for live HLS sessions.
 *
 * Active live (students):  live/sessions/{liveSessionId}/   — sliding window only
 * Append-only recording:   live/recordings/{liveSessionId}/ — full VOD source (never windowed)
 * Final VOD:               teachers/.../videos/{videoId}/
 */
const r2Storage = require('./r2StorageService');

function getLiveSessionPrefix(sessionId) {
  return `live/sessions/${sessionId}`;
}

function getLiveRecordingPrefix(sessionId) {
  return `live/recordings/${sessionId}`;
}

function getLiveProcessingPrefix(sessionId, taskId) {
  return `${getLiveSessionPrefix(sessionId)}/.processing/${taskId}`;
}

function getMediamtxPathName(streamKey) {
  return `live/${streamKey}`;
}

async function cleanupPrefixSafe(prefix) {
  try {
    await r2Storage.deletePrefix(prefix);
    console.log('[R2Live] Cleaned up prefix:', prefix);
  } catch (err) {
    console.warn('[R2Live] cleanup failed:', prefix, err.message);
  }
}

/** Delete both live playback window and append-only recording prefixes. */
async function cleanupLiveSession(sessionId) {
  if (!r2Storage.isConfigured || !sessionId) return;
  await cleanupPrefixSafe(getLiveSessionPrefix(sessionId));
  await cleanupPrefixSafe(getLiveRecordingPrefix(sessionId));
}

async function promoteLiveToVideo(liveSessionId, videoPrefix, taskId) {
  const processingPrefix = getLiveProcessingPrefix(liveSessionId, taskId);
  await r2Storage.promoteProcessingPrefix(processingPrefix, videoPrefix, ['720p', 'original']);
  await cleanupLiveSession(liveSessionId);
}

module.exports = {
  getLiveSessionPrefix,
  getLiveRecordingPrefix,
  getLiveProcessingPrefix,
  getMediamtxPathName,
  cleanupLiveSession,
  promoteLiveToVideo,
};
