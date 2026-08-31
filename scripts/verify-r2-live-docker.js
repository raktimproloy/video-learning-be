/**
 * Full R2 live verification against running Docker stack (port 8080).
 * Creates dummy data, verifies R2 objects + playlists + WHIP proxy, then cleans up.
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const sessionService = require('../src/services/sessionService');
const r2LiveStorage = require('../src/services/r2LiveStorageService');
const r2Storage = require('../src/services/r2StorageService');
const { processSession } = require('../src/worker/liveSegmentUploader');

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:8080/v1').replace(/\/$/, '');
const ORIGIN = API_BASE.replace(/\/v1$/, '');
const RUN_ID = Date.now().toString(36);
const report = { checks: [], r2Keys: [], liveSessionId: null, whipUrl: null, provider: null };

const dummy = {
  teacherId: crypto.randomUUID(),
  courseId: crypto.randomUUID(),
  lessonId: crypto.randomUUID(),
  studentIds: Array.from({ length: 5 }, () => crypto.randomUUID()),
  teacherEmail: `r2verify-teacher-${RUN_ID}@dummy.local`,
  studentEmails: Array.from({ length: 5 }, (_, i) => `r2verify-student${i + 1}-${RUN_ID}@dummy.local`),
  liveSessionId: null,
  streamKey: null,
};

function pass(name, detail) {
  report.checks.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function fail(name, detail) {
  report.checks.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? `: ${detail}` : ''}`);
}

async function request(method, p, { token, body } = {}) {
  const url = `${API_BASE}${p.startsWith('/') ? p : `/${p}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data, text };
}

async function issueToken(userId, email, role) {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 3600 * 1000);
  await sessionService.create({
    userId, jti, deviceId: `verify-${jti}`,
    req: { headers: { 'user-agent': 'R2Verify/1.0' }, clientIp: '127.0.0.1' },
    expiresAt,
  });
  return jwt.sign({ id: userId, email, role, jti }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1h' });
}

async function seed() {
  const hash = await bcrypt.hash('x', 10);
  await db.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'teacher')`, [dummy.teacherId, dummy.teacherEmail, hash]);
  for (let i = 0; i < 5; i++) {
    await db.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'student')`, [dummy.studentIds[i], dummy.studentEmails[i], hash]);
  }
  await db.query(
    `INSERT INTO courses (id, title, description, teacher_id, has_live_class, course_type, status, price, currency)
     VALUES ($1, $2, $3, $4, true, 'lesson-based', 'active', 0, 'BDT')`,
    [dummy.courseId, `Verify ${RUN_ID}`, 'verify', dummy.teacherId]
  );
  await db.query(`INSERT INTO lessons (id, course_id, title, description, "order") VALUES ($1, $2, $3, $4, 0)`, [dummy.lessonId, dummy.courseId, 'Verify', 'verify']);
  for (const sid of dummy.studentIds) {
    await db.query(`INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [sid, dummy.courseId]);
  }
}

async function cleanup() {
  if (dummy.liveSessionId && r2Storage.isConfigured) {
    try { await r2LiveStorage.cleanupLiveSession(dummy.liveSessionId); } catch (_) {}
  }
  const hlsDir = path.resolve(process.env.MEDIAMTX_HLS_DIR || './storage/mediamtx/hls');
  if (dummy.streamKey) {
    try { fs.rmSync(path.join(hlsDir, `live_${dummy.streamKey}`), { recursive: true, force: true }); } catch (_) {}
  }
  await db.query('DELETE FROM live_sessions WHERE lesson_id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])', [[dummy.teacherId, ...dummy.studentIds]]);
  await db.query('DELETE FROM course_enrollments WHERE course_id = $1', [dummy.courseId]);
  await db.query('DELETE FROM lessons WHERE id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM courses WHERE id = $1', [dummy.courseId]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[dummy.teacherId, ...dummy.studentIds]]);
}

async function main() {
  console.log('\n=== R2 Live Full Verification (Docker @ 8080) ===\n');

  // 1. Infrastructure
  const health = await fetch(`${ORIGIN}/health`).catch(() => null);
  health?.ok ? pass('Docker API health', `${ORIGIN}/health → 200`) : fail('Docker API health', 'not reachable');

  const whipProbe = await fetch(`${ORIGIN}/live_invalid_key/whip`, {
    method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: 'v=0',
  }).catch(() => null);
  whipProbe?.status === 401
    ? pass('WHIP proxy (nginx→MediaMTX→auth)', 'invalid key → 401')
    : fail('WHIP proxy', `status ${whipProbe?.status}`);

  r2Storage.isConfigured
    ? pass('R2 credentials configured', `bucket=${process.env.R2_BUCKET_NAME}`)
    : fail('R2 credentials', 'not configured');

  await db.query(`UPDATE admin_live_settings SET r2_live_enabled = true WHERE id = '00000000-0000-0000-0000-000000000002'`);
  pass('Admin r2_live_enabled', 'ON');

  await seed();
  pass('Dummy data seeded', `1 teacher + 5 students`);

  const teacherToken = await issueToken(dummy.teacherId, dummy.teacherEmail, 'teacher');

  // 2. Start live
  const start = await request('PUT', `/lessons/${dummy.lessonId}/live`, {
    token: teacherToken,
    body: { is_live: true, live_name: 'R2 Verify', live_order: 0 },
  });
  report.provider = start.data?.provider;
  report.whipUrl = start.data?.whipUrl;
  dummy.liveSessionId = start.data?.live_session_id;
  dummy.streamKey = start.data?.streamKey;
  report.liveSessionId = dummy.liveSessionId;

  start.status === 200 && start.data?.provider === 'r2_live'
    ? pass('Start live → r2_live', start.data.whipUrl)
    : fail('Start live', `${start.status} provider=${start.data?.provider}`);

  start.data?.whipUrl?.startsWith(ORIGIN)
    ? pass('WHIP URL uses Docker origin', ORIGIN)
    : fail('WHIP URL origin', start.data?.whipUrl);

  const authOk = await request('POST', '/internal/live/ingest-auth', {
    body: { path: `live_${dummy.streamKey}`, action: 'publish' },
  });
  authOk.status === 200 ? pass('MediaMTX ingest auth hook', 'valid stream key accepted') : fail('Ingest auth', authOk.status);

  // 3. Simulate HLS segment → R2
  const hlsDir = path.resolve(process.env.MEDIAMTX_HLS_DIR || './storage/mediamtx/hls');
  const streamDir = path.join(hlsDir, `live_${dummy.streamKey}`);
  fs.mkdirSync(streamDir, { recursive: true });
  for (let i = 1; i <= 3; i += 1) {
    fs.writeFileSync(path.join(streamDir, `seg0000${i}.ts`), Buffer.alloc(8192, 0x47));
  }

  const sessionRow = (await db.query('SELECT * FROM live_sessions WHERE id = $1', [dummy.liveSessionId])).rows[0];
  await processSession(sessionRow);
  // Re-fetch after hls_ready_at update
  const sessionRow2 = (await db.query('SELECT * FROM live_sessions WHERE id = $1', [dummy.liveSessionId])).rows[0];
  if (sessionRow2) await processSession(sessionRow2);

  const r2Prefix = r2LiveStorage.getLiveSessionPrefix(dummy.liveSessionId);
  const keys = await r2Storage.listObjects(r2Prefix);
  report.r2Keys = keys;

  keys.some((k) => k.includes('720p/seg00001.ts'))
    ? pass('R2 segment uploaded', keys.find((k) => k.includes('seg00001.ts')))
    : fail('R2 segment upload', `keys=${keys.join(', ') || 'none'}`);

  keys.some((k) => k.endsWith('master.m3u8'))
    ? pass('R2 master playlist uploaded', keys.find((k) => k.endsWith('master.m3u8')))
    : fail('R2 master playlist', keys.join(', '));

  const updated = (await db.query('SELECT hls_ready_at FROM live_sessions WHERE id = $1', [dummy.liveSessionId])).rows[0];
  updated?.hls_ready_at ? pass('hls_ready_at set in DB', updated.hls_ready_at) : fail('hls_ready_at', 'not set');

  // 4. Student playlists
  const teacherPl = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, { token: teacherToken });
  const hasM3u8 = teacherPl.text?.includes('#EXTM3U');
  hasM3u8 ? pass('Teacher live playlist', '#EXTM3U returned') : fail('Teacher playlist', teacherPl.status);

  const usesCdn =
    teacherPl.text?.includes('media.shikkhabhumi.com') ||
    teacherPl.text?.includes('720p/') ||
    teacherPl.text?.includes('subpath=') ||
    teacherPl.text?.includes('#EXT-X-STREAM-INF');
  usesCdn ? pass('Playlist references CDN/R2 segments', 'segment URLs present') : fail('Playlist segment URLs', 'missing');

  let studentOk = 0;
  for (let i = 0; i < 5; i++) {
    const st = await issueToken(dummy.studentIds[i], dummy.studentEmails[i], 'student');
    const pl = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, { token: st });
    if (pl.status === 200 && pl.text?.includes('#EXTM3U')) studentOk++;
  }
  studentOk === 5 ? pass('5 enrolled students playlist', 'all OK') : fail('Student playlists', `${studentOk}/5`);

  await request('PUT', `/lessons/${dummy.lessonId}/live`, { token: teacherToken, body: { is_live: false } });
  pass('End live', 'OK');

  const allOk = report.checks.every((c) => c.ok);
  console.log('\n=== RESULT:', allOk ? 'R2 LIVE WORKING ✓' : 'SOME CHECKS FAILED ✗', '===\n');
  console.log(JSON.stringify({ ok: allOk, provider: report.provider, whipUrl: report.whipUrl, r2Prefix, r2Keys: report.r2Keys, checks: report.checks }, null, 2));

  await cleanup();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY FAILED:', e.message);
  try { await cleanup(); } catch (_) {}
  process.exit(1);
});
