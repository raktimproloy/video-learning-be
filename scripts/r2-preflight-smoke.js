#!/usr/bin/env node
/**
 * Phase 0 preflight: sample R2 keys from DB + smoke-test custom domain URLs.
 *
 * Usage:
 *   node scripts/r2-preflight-smoke.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const db = require('../db');
const r2Storage = require('../src/services/r2StorageService');

const CDN_BASE = (process.env.R2_CDN_PUBLIC_URL || process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

function headUrl(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', timeout: 15000 }, (res) => {
      resolve({ url, status: res.statusCode });
    });
    req.on('error', (err) => resolve({ url, status: null, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ url, status: null, error: 'timeout' });
    });
    req.end();
  });
}

async function smokeTestVideo(label, row) {
  if (!row?.r2_key) {
    console.log(`[${label}] No r2_key — skip`);
    return { label, skipped: true };
  }

  const paths = [
    `${row.r2_key}/master.m3u8`,
    `${row.r2_key}/720p/playlist.m3u8`,
  ];

  const r2Checks = [];
  for (const p of paths) {
    const exists = await r2Storage.objectExists(p);
    r2Checks.push({ path: p, exists });
  }

  let tsPath = null;
  if (r2Checks[1].exists) {
    const keys = await r2Storage.listObjects(`${row.r2_key}/720p/`);
    tsPath = keys.find((k) => k.endsWith('.ts')) || null;
  }

  const cdnChecks = [];
  if (CDN_BASE) {
    for (const p of paths) {
      cdnChecks.push(await headUrl(`${CDN_BASE}/${p}`));
    }
    if (tsPath) {
      cdnChecks.push(await headUrl(`${CDN_BASE}/${tsPath}`));
    }
  }

  return {
    label,
    videoId: row.id,
    title: row.title,
    r2_key: row.r2_key,
    created_at: row.created_at,
    r2Checks,
    tsSample: tsPath,
    cdnChecks,
  };
}

async function main() {
  console.log('=== R2 Preflight Smoke Test ===');
  console.log('CDN base:', CDN_BASE || '(not set)');
  console.log('CDN_SEGMENT_DELIVERY:', process.env.CDN_SEGMENT_DELIVERY || 'off');
  console.log('R2 bucket:', process.env.R2_BUCKET_NAME || '(default)');
  console.log('R2 configured:', r2Storage.isConfigured);
  console.log('');

  const counts = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE storage_provider = 'r2' AND status = 'active')::int AS active_r2,
      COUNT(*) FILTER (WHERE storage_provider = 'r2' AND status = 'active' AND storage_path = 'r2_only')::int AS r2_only
    FROM videos
  `);
  console.log('DB active R2 videos:', counts.rows[0].active_r2);
  console.log('DB r2_only (encoded):', counts.rows[0].r2_only);
  console.log('');

  const oldest = await db.query(`
    SELECT id, title, r2_key, storage_path, status, created_at
    FROM videos
    WHERE storage_provider = 'r2' AND r2_key IS NOT NULL AND status = 'active'
    ORDER BY created_at ASC LIMIT 1
  `);
  const newest = await db.query(`
    SELECT id, title, r2_key, storage_path, status, created_at
    FROM videos
    WHERE storage_provider = 'r2' AND r2_key IS NOT NULL AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `);

  const results = [];
  if (oldest.rows[0]) results.push(await smokeTestVideo('oldest', oldest.rows[0]));
  if (newest.rows[0] && newest.rows[0].id !== oldest.rows[0]?.id) {
    results.push(await smokeTestVideo('newest', newest.rows[0]));
  }

  for (const r of results) {
    if (r.skipped) continue;
    console.log(`--- ${r.label} ---`);
    console.log(`  id: ${r.videoId}`);
    console.log(`  title: ${r.title}`);
    console.log(`  r2_key: ${r.r2_key}`);
    console.log(`  created_at: ${r.created_at}`);
    for (const c of r.r2Checks) {
      console.log(`  R2 Head ${c.path}: ${c.exists ? 'OK' : 'MISSING'}`);
    }
    if (r.tsSample) console.log(`  sample .ts: ${r.tsSample}`);
    for (const c of r.cdnChecks || []) {
      const msg = c.error ? `ERROR (${c.error})` : `HTTP ${c.status}`;
      console.log(`  CDN ${c.url.replace(CDN_BASE + '/', '')}: ${msg}`);
    }
    console.log('');
  }

  const allCdnOk = results.every((r) =>
    r.skipped ||
    (r.cdnChecks || []).filter((c) => !c.url.endsWith('.ts')).every((c) => c.status === 200)
  );
  console.log(allCdnOk ? 'Preflight: PASS (CDN paths reachable)' : 'Preflight: REVIEW (some CDN checks failed — verify custom domain in Cloudflare dashboard)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
