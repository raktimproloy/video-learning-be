const fs = require('fs');
const path = require('path');
const db = require('../db');

const sql = fs.readFileSync(
  path.join(__dirname, '../migrations/138_video_processing_stage_downloading.sql'),
  'utf8'
);

db.query(sql)
  .then(() => {
    console.log('Migration 138 applied: processing_stage downloading');
    return db.pool.end();
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
