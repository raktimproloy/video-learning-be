const db = require('./db');

async function main() {
  const { rows } = await db.query(
    `SELECT id, ingest_stream_key FROM live_sessions WHERE status='active' AND provider='r2_live' ORDER BY created_at DESC LIMIT 1`
  );
  if (!rows[0]) {
    console.error('NO_ACTIVE_SESSION');
    process.exit(2);
  }
  console.log('SESSION=' + rows[0].id);
  console.log('KEY=' + rows[0].ingest_stream_key);

  // Probe on_publish with the real key (will upload placeholders to R2)
  const res = await fetch('http://127.0.0.1:3000/v1/internal/live/on_publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'on_publish', stream: rows[0].ingest_stream_key, app: 'live' }),
  });
  const text = await res.text();
  console.log('PUBLISH_STATUS=' + res.status);
  console.log('PUBLISH_BODY=' + text);
  process.exit(res.status === 200 && text.trim() === '0' ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
