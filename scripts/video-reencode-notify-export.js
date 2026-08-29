#!/usr/bin/env node
/**
 * Export teachers with Category B videos (no original_r2_key) for re-upload notification.
 *
 * Usage: node scripts/video-reencode-notify-export.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../db');

async function main() {
  const { rows } = await db.query(`
    SELECT u.email, u.name AS teacher_name, COUNT(v.id)::int AS videos_needing_reupload
    FROM videos v
    JOIN users u ON v.owner_id = u.id
    WHERE v.status = 'active'
      AND v.storage_provider = 'r2'
      AND v.original_r2_key IS NULL
    GROUP BY u.id, u.email, u.name
    ORDER BY videos_needing_reupload DESC
  `);

  console.log('teacher_email,teacher_name,videos_needing_reupload');
  for (const r of rows) {
    console.log(`${r.email},${JSON.stringify(r.teacher_name || '')},${r.videos_needing_reupload}`);
  }
  console.error(`\nTotal teachers to notify: ${rows.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
