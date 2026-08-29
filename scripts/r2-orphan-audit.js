#!/usr/bin/env node
/**
 * Phase 3: Read-only R2 orphan prefix audit.
 * Scans staging/, .processing/ prefixes and compares active r2_only videos.
 *
 * Usage:
 *   node scripts/r2-orphan-audit.js
 *   node scripts/r2-orphan-audit.js --json   # machine-readable output
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../db');
const r2Storage = require('../src/services/r2StorageService');

const jsonOut = process.argv.includes('--json');

function log(...args) {
  if (!jsonOut) console.log(...args);
}

async function listAllUnderPrefix(prefix) {
  return r2Storage.listObjects(prefix);
}

async function findOrphanStaging(activeR2Keys) {
  const activeSet = new Set(activeR2Keys.map((k) => `${k}/staging/`));
  const allStaging = await listAllUnderPrefix('teachers/');
  const stagingKeys = allStaging.filter((k) => k.includes('/staging/'));

  const byPrefix = new Map();
  for (const key of stagingKeys) {
    const idx = key.indexOf('/staging/');
    const prefix = key.slice(0, idx + '/staging/'.length);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(key);
  }

  const orphans = [];
  for (const [prefix, keys] of byPrefix) {
    if (!activeSet.has(prefix)) {
      orphans.push({ prefix, objectCount: keys.length, sampleKeys: keys.slice(0, 3) });
    }
  }

  const activeWithStaging = [];
  for (const r2Key of activeR2Keys) {
    const stagingPrefix = `${r2Key}/staging/`;
    const keys = stagingKeys.filter((k) => k.startsWith(stagingPrefix));
    if (keys.length > 0) {
      activeWithStaging.push({ r2_key: r2Key, objectCount: keys.length, sampleKeys: keys.slice(0, 3) });
    }
  }

  return { orphanPrefixes: orphans, activeVideosWithStaging: activeWithStaging, totalStagingObjects: stagingKeys.length };
}

async function findProcessingOrphans() {
  const all = await listAllUnderPrefix('teachers/');
  const processingKeys = all.filter((k) => k.includes('/.processing/'));

  const byPrefix = new Map();
  for (const key of processingKeys) {
    const match = key.match(/^(.+\/\.processing\/[^/]+)\//);
    const prefix = match ? match[1] : key;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(key);
  }

  const pendingTasks = await db.query(`
    SELECT id, video_id, status, processing_stage, updated_at
    FROM video_processing_tasks
    WHERE status IN ('pending', 'processing')
  `);

  const activeProcessingIds = new Set(
    pendingTasks.rows.map((t) => String(t.id))
  );

  const orphanProcessing = [];
  for (const [prefix, keys] of byPrefix) {
    const taskId = prefix.split('/.processing/')[1];
    if (!activeProcessingIds.has(taskId)) {
      orphanProcessing.push({ prefix, taskId, objectCount: keys.length, sampleKeys: keys.slice(0, 3) });
    }
  }

  return {
    totalProcessingObjects: processingKeys.length,
    orphanProcessingPrefixes: orphanProcessing,
    activeTasks: pendingTasks.rows.length,
  };
}

async function findMissingMaster(activeVideos) {
  const missing = [];
  for (const row of activeVideos.slice(0, 100)) {
    const masterKey = `${row.r2_key}/master.m3u8`;
    const exists = await r2Storage.objectExists(masterKey);
    if (!exists) {
      missing.push({ id: row.id, title: row.title, r2_key: row.r2_key, expected: masterKey });
    }
  }
  if (activeVideos.length > 100) {
    log(`(Checked first 100 of ${activeVideos.length} active videos for master.m3u8)`);
  }
  return missing;
}

async function main() {
  if (!r2Storage.isConfigured) {
    console.error('R2 is not configured.');
    process.exit(1);
  }

  const activeRes = await db.query(`
    SELECT id, title, r2_key, storage_path, status
    FROM videos
    WHERE storage_provider = 'r2' AND r2_key IS NOT NULL AND status = 'active'
    ORDER BY created_at ASC
  `);

  const r2OnlyKeys = activeRes.rows
    .filter((r) => r.storage_path === 'r2_only')
    .map((r) => r.r2_key);

  log('=== R2 Orphan Audit ===');
  log(`Active R2 videos: ${activeRes.rows.length}`);
  log(`r2_only (should have no staging): ${r2OnlyKeys.length}`);
  log('');

  log('Scanning staging/ prefixes...');
  const staging = await findOrphanStaging(r2OnlyKeys);

  log('Scanning .processing/ prefixes...');
  const processing = await findProcessingOrphans();

  log('Checking master.m3u8 on active videos (sample)...');
  const missingMaster = await findMissingMaster(activeRes.rows);

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      activeR2Videos: activeRes.rows.length,
      r2OnlyVideos: r2OnlyKeys.length,
      totalStagingObjects: staging.totalStagingObjects,
      orphanStagingPrefixes: staging.orphanPrefixes.length,
      activeVideosWithLeftoverStaging: staging.activeVideosWithStaging.length,
      totalProcessingObjects: processing.totalProcessingObjects,
      orphanProcessingPrefixes: processing.orphanProcessingPrefixes.length,
      activeProcessingTasks: processing.activeTasks,
      missingMasterM3u8: missingMaster.length,
    },
    staging,
    processing,
    missingMaster,
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  console.log('--- Staging ---');
  console.log(`Total staging objects: ${staging.totalStagingObjects}`);
  console.log(`Orphan staging prefixes (no active r2_only match): ${staging.orphanPrefixes.length}`);
  staging.orphanPrefixes.slice(0, 10).forEach((o) => {
    console.log(`  ORPHAN ${o.prefix} (${o.objectCount} objects)`);
  });
  console.log(`Active r2_only videos with leftover staging/: ${staging.activeVideosWithStaging.length}`);
  staging.activeVideosWithStaging.slice(0, 10).forEach((o) => {
    console.log(`  LEAK ${o.r2_key} (${o.objectCount} objects)`);
  });

  console.log('');
  console.log('--- Processing ---');
  console.log(`Total .processing objects: ${processing.totalProcessingObjects}`);
  console.log(`Active processing tasks: ${processing.activeTasks}`);
  console.log(`Orphan .processing prefixes: ${processing.orphanProcessingPrefixes.length}`);
  processing.orphanProcessingPrefixes.slice(0, 10).forEach((o) => {
    console.log(`  ORPHAN ${o.prefix} task=${o.taskId} (${o.objectCount} objects)`);
  });

  console.log('');
  console.log('--- Missing master.m3u8 (broken references) ---');
  if (missingMaster.length === 0) {
    console.log('  None in sampled active videos.');
  } else {
    missingMaster.forEach((m) => console.log(`  ${m.id}  ${m.title}  ${m.r2_key}`));
  }

  console.log('');
  console.log('Recommendations:');
  if (staging.orphanPrefixes.length > 0 || processing.orphanProcessingPrefixes.length > 0) {
    console.log('  - Enable Cloudflare lifecycle rules (see docs/R2-COST-OPTIMIZATION.md)');
    console.log('  - Or manually deletePrefix on reported orphan prefixes after review');
  } else {
    console.log('  - No orphan prefixes detected. Lifecycle rules still recommended as safety net.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
