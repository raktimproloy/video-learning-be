const fs = require('fs');
const path = require('path');
const db = require('../db');

const sql = fs.readFileSync(
  path.join(__dirname, '../migrations/137_live_playback_ready_at.sql'),
  'utf8'
);

db.query(sql)
  .then(() => {
    console.log('Migration 137 applied: playback_ready_at');
    return db.pool.end();
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
