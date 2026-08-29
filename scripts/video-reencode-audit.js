#!/usr/bin/env node
/**
 * Audit videos for re-encode eligibility (Category A/B/C).
 *
 * Usage:
 *   node scripts/video-reencode-audit.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../db');

async function main() {
  const categoryA = await db.query(`
    SELECT COUNT(*)::int AS count FROM videos
    WHERE status = 'active' AND storage_provider = 'r2' AND original_r2_key IS NOT NULL
  `);
  const categoryB = await db.query(`
    SELECT COUNT(*)::int AS count FROM videos
    WHERE status = 'active' AND storage_provider = 'r2' AND original_r2_key IS NULL
  `);
  const categoryC = await db.query(`
    SELECT COUNT(*)::int AS count FROM videos
    WHERE status IN ('processing', 'uploading')
  `);

  console.log('=== Video Re-encode Audit ===');
  console.log('Category A (has original_r2_key — auto re-encode eligible):', categoryA.rows[0].count);
  console.log('Category B (no original — manual re-upload or keep single quality):', categoryB.rows[0].count);
  console.log('Category C (processing/uploading — fix source first):', categoryC.rows[0].count);

  const sampleB = await db.query(`
    SELECT id, title, r2_key FROM videos
    WHERE status = 'active' AND storage_provider = 'r2' AND original_r2_key IS NULL
    ORDER BY created_at DESC LIMIT 10
  `);
  if (sampleB.rows.length > 0) {
    console.log('\nSample Category B videos (need re-upload for ladder):');
    sampleB.rows.forEach((r) => console.log(`  - ${r.id}  ${r.title}`));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
