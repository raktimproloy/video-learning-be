require('dotenv').config();
const db = require('../db');
const r2Storage = require('../src/services/r2StorageService');
const r2LiveStorage = require('../src/services/r2LiveStorageService');
const liveCdn = require('../src/services/liveCdnDeliveryService');
const fs = require('fs');
const path = require('path');
const liveDelivery = require('../src/config/liveDelivery');

async function main() {
  const lessonId = process.argv[2] || 'ceb57368-f627-48fd-bf14-acbcb19cb783';
  const sessions = await db.query(
    `SELECT id, broadcast_status, provider, ingest_stream_key, hls_ready_at, playback_ready_at, status, updated_at
     FROM live_sessions WHERE lesson_id = $1 ORDER BY created_at DESC LIMIT 3`,
    [lessonId]
  );
  console.log('sessions:', JSON.stringify(sessions.rows, null, 2));
  const active = sessions.rows.find((r) => r.status === 'active');
  if (!active) {
    console.log('No active session');
    process.exit(0);
  }
  const hlsDir = path.join(
    liveDelivery.mediamtxHlsDir,
    r2LiveStorage.getMediamtxPathName(active.ingest_stream_key)
  );
  console.log('hlsDir:', hlsDir, 'exists:', fs.existsSync(hlsDir));
  if (fs.existsSync(hlsDir)) {
    const files = fs.readdirSync(hlsDir).filter((f) => !f.endsWith('.m3u8'));
    console.log('local segment files:', files.length, files.slice(-5));
  }
  const prefix = `${r2LiveStorage.getLiveSessionPrefix(active.id)}/720p/`;
  if (r2Storage.isConfigured) {
    const keys = await r2Storage.listObjects(prefix);
    const media = keys.filter((k) => /\.(m4s|ts)$/i.test(k));
    console.log('R2 media segments:', media.length);
    console.log('readiness:', await liveCdn.getPlaybackReadiness(active));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
