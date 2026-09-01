const fs = require('fs');
const path = require('path');
const db = require('../db');

const sql = fs.readFileSync(
  path.join(__dirname, '../migrations/136_r2_live_provider.sql'),
  'utf8'
);

db.query(sql)
  .then(() => {
    console.log('Migration 136 applied: r2_live provider');
    return db.pool.end();
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
