const fs = require('fs');
const db = require('../db');

(async () => {
  const { rows } = await db.query(
    "SELECT ingest_stream_key FROM live_sessions WHERE status='active' AND provider='r2_live' ORDER BY created_at DESC LIMIT 1"
  );
  if (!rows[0]?.ingest_stream_key) {
    console.error('NO_KEY');
    process.exit(2);
  }
  fs.writeFileSync('/tmp/sk.txt', rows[0].ingest_stream_key);
  console.log('WROTE_KEY_LEN=' + rows[0].ingest_stream_key.length);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
