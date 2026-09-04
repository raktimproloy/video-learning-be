/**
 * Unit checks for SRS → R2 live webhook playlist builders (no Docker/R2 required).
 * Usage: node scripts/test-srs-webhook-unit.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const srs = require('../src/services/srsWebhookService');

function ok(name) {
  console.log(`  ✓ ${name}`);
}

const master = srs._masterManifest();
assert.ok(master.includes('#EXTM3U'));
assert.ok(master.includes('index.m3u8'));
assert.ok(!master.includes('_720p'));
assert.ok(!master.includes('_480p'));
ok('master is single-variant (no fake ABR)');

const empty = srs._buildMediaPlaylist([]);
assert.ok(empty.includes('#EXTM3U'));
assert.ok(!/#EXTINF:/i.test(empty));
ok('empty playlist has no EXTINF');

const segs = [
  { name: 'seg-0.ts', duration: 2.0, seq: 0 },
  { name: 'seg-1.ts', duration: 2.1, seq: 1 },
  { name: 'seg-2.ts', duration: 1.9, seq: 2 },
];
const live = srs._buildMediaPlaylist(segs);
assert.ok(/#EXTINF:2\.000/.test(live));
assert.ok(live.includes('seg-0.ts'));
assert.ok(live.includes('#EXT-X-MEDIA-SEQUENCE:0'));
assert.ok(!live.includes('#EXT-X-ENDLIST'));
ok('live playlist lists segments without ENDLIST');

const vod = srs._buildMediaPlaylist(segs, { endList: true });
assert.ok(vod.includes('#EXT-X-ENDLIST'));
assert.ok(vod.includes('#EXT-X-PLAYLIST-TYPE:EVENT'));
ok('recording playlist can end with ENDLIST');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-hls-'));
const abs = path.join(tmp, 'seg-9.ts');
fs.writeFileSync(abs, Buffer.from([0, 1, 2]));
assert.strictEqual(srs._resolveHlsFile(abs, null), abs);
ok('resolveHlsFile finds absolute path');

const relDir = path.join(tmp, 'cwd');
fs.mkdirSync(relDir);
const relFile = 'clip.ts';
fs.writeFileSync(path.join(relDir, relFile), Buffer.from([3]));
assert.strictEqual(srs._resolveHlsFile(relFile, relDir), path.join(relDir, relFile));
ok('resolveHlsFile finds cwd-relative path');

assert.strictEqual(srs._resolveHlsFile('missing-nope.ts', relDir), null);
ok('resolveHlsFile returns null for missing file');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nAll SRS webhook unit checks passed.');
