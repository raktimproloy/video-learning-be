require('dotenv').config();
const db = require('../db');
const r2Storage = require('../src/services/r2StorageService');
const r2LiveStorage = require('../src/services/r2LiveStorageService');
const liveCdn = require('../src/services/liveCdnDeliveryService');
const liveDelivery = require('../src/config/liveDelivery');

async function main() {
  const lessonId = process.argv[2] || 'ceb57368-f627-48fd-bf14-acbcb19cb783';
  const lesson = await db.query('SELECT current_live_session_id FROM lessons WHERE id = $1', [lessonId]);
  const sessionId = lesson.rows[0]?.current_live_session_id;
  if (!sessionId) {
    console.log('No current live session');
    process.exit(0);
  }
  const session = (await db.query('SELECT * FROM live_sessions WHERE id = $1', [sessionId])).rows[0];
  console.log('session:', {
    id: session.id,
    broadcast_status: session.broadcast_status,
    hls_ready_at: session.hls_ready_at,
    playback_ready_at: session.playback_ready_at,
    ingest_stream_key: session.ingest_stream_key,
  });

  const prefix = `${r2LiveStorage.getLiveSessionPrefix(session.id)}/720p/`;
  const keys = await r2Storage.listObjects(prefix);
  const media = keys.filter((k) => {
    const name = k.split('/').pop() || k;
    if (/_init\.mp4$/i.test(name)) return false;
    return /_seg\d+\./i.test(name) || /\.(m4s|ts)$/i.test(name);
  });
  const publishable = Math.max(0, media.length - liveDelivery.holdBackSegments);
  console.log('R2 total media:', media.length, 'publishable (after hold-back):', publishable);
  console.log('thresholds:', {
    cdnMinSegments: liveDelivery.cdnMinSegments,
    holdBack: liveDelivery.holdBackSegments,
    clientBuffer: liveDelivery.clientStartBufferSeconds,
  });

  const pk = `${r2LiveStorage.getLiveSessionPrefix(session.id)}/720p/playlist.m3u8`;
  if (await r2Storage.objectExists(pk)) {
    const stream = await r2Storage.getObjectStream(pk);
    let body = '';
    for await (const chunk of stream) body += chunk.toString();
    const segLines = body.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    console.log('playlist segment lines:', segLines.length);
    console.log('playlist preview:\n', body.slice(0, 800));
  } else {
    console.log('No playlist on R2 yet');
  }

  const readiness = await liveCdn.getPlaybackReadiness(session);
  console.log('readiness:', readiness);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
