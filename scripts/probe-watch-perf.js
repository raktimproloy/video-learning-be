#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../db');
const r2Storage = require('../src/services/r2StorageService');
const hlsDeliveryService = require('../src/services/hlsDeliveryService');

const videoId = process.argv[2] || '59dfd590-8425-4c05-b66f-ba7709a4273f';

async function main() {
  const v = await db.query(
    'SELECT id, title, duration_seconds, r2_key, storage_provider, playback_resolutions, size_bytes FROM videos WHERE id=$1',
    [videoId]
  );
  console.log('video:', v.rows[0]);
  const row = v.rows[0];
  if (!row) process.exit(1);

  const apiBase = `http://localhost:5000/v1/video/${videoId}/stream`;
  for (const sub of ['master.m3u8', '720p/playlist.m3u8', '360p/playlist.m3u8']) {
    const key = `${row.r2_key}/${sub}`;
    const t0 = Date.now();
    const exists = await r2Storage.objectExists(key);
    if (!exists) {
      console.log(sub, 'MISSING');
      continue;
    }
    const body = await hlsDeliveryService.getPlaylistBody(key, row.r2_key, apiBase, sub);
    const segs = body.split('\n').filter((l) => l.trim().endsWith('.ts')).length;
    console.log(sub, 'segments:', segs, 'ms:', Date.now() - t0, 'KB:', Math.round(body.length / 1024));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
