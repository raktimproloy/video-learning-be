#!/usr/bin/env node
/**
 * Queue re-encode tasks for videos with preserved original_r2_key (Category A).
 *
 * Usage:
 *   node scripts/reencode-queue.js --dry-run
 *   node scripts/reencode-queue.js --limit=20
 *   node scripts/reencode-queue.js --course=<uuid> --limit=5
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../db');
const adminService = require('../src/services/adminService');
const videoService = require('../src/services/videoService');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, limit: 10, courseId: null };
  for (const arg of args) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--limit=')) opts.limit = parseInt(arg.split('=')[1], 10) || 10;
    else if (arg.startsWith('--course=')) opts.courseId = arg.split('=')[1];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  let query = `
    SELECT v.id, v.title, v.owner_id, v.lesson_id
    FROM videos v
    LEFT JOIN lessons l ON v.lesson_id = l.id
    WHERE v.status = 'active'
      AND v.storage_provider = 'r2'
      AND v.original_r2_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM video_processing_tasks t
        WHERE t.video_id = v.id AND t.status IN ('pending', 'processing')
      )
  `;
  const params = [];
  if (opts.courseId) {
    params.push(opts.courseId);
    query += ` AND l.course_id = $${params.length}`;
  }
  params.push(opts.limit);
  query += ` ORDER BY v.created_at ASC LIMIT $${params.length}`;

  const { rows } = await db.query(query, params);
  console.log(`Found ${rows.length} video(s) eligible for re-encode (limit=${opts.limit})`);

  if (opts.dryRun) {
    rows.forEach((r) => console.log(`  [dry-run] would queue: ${r.id} — ${r.title}`));
    process.exit(0);
  }

  let queued = 0;
  for (const video of rows) {
    try {
      await videoService.saveVideoVersion(video.id, video.owner_id, 'system');
      const task = await adminService.createProcessingTask(
        video.owner_id,
        video.id,
        'h264',
        ['360p', '720p', '1080p'],
        28,
        false,
        'reencode'
      );
      console.log(`Queued task ${task.id} for video ${video.id} (${video.title})`);
      queued++;
    } catch (err) {
      console.error(`Failed to queue ${video.id}:`, err.message);
    }
  }

  console.log(`Done. Queued ${queued} re-encode task(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
