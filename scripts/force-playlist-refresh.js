require('dotenv').config();
const db = require('../db');
const { processSession } = require('../src/worker/liveSegmentUploader');
const r2Storage = require('../src/services/r2StorageService');
const r2LiveStorage = require('../src/services/r2LiveStorageService');

async function main() {
  const sessionId = process.argv[2] || '26fb09ca-3791-469e-acef-f49571d951cc';
  const res = await db.query(
    'SELECT id, lesson_id, ingest_stream_key, hls_ready_at FROM live_sessions WHERE id = $1',
    [sessionId]
  );
  if (!res.rows[0]) {
    console.log('Session not found');
    process.exit(1);
  }
  await processSession(res.rows[0]);
  const pk = `${r2LiveStorage.getLiveSessionPrefix(sessionId)}/720p/playlist.m3u8`;
  const stream = await r2Storage.getObjectStream(pk);
  let body = '';
  for await (const chunk of stream) body += chunk.toString();
  const segLines = body.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  console.log('playlist segment lines:', segLines.length);
  console.log(body.slice(0, 500));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
