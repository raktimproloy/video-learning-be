/**
 * End-to-end R2 live pipeline test against the running Docker stack.
 *
 * Publishes a real video stream into MediaMTX (ffmpeg inside the worker container),
 * then verifies the student playlist API serves a playable HLS ladder — first from
 * the MediaMTX fallback, then from R2 once the uploader worker catches up.
 *
 * Usage: API_BASE_URL=http://localhost:8080/v1 node scripts/test-r2-live-pipeline.js
 */
require('dotenv').config();
const { spawn } = require('child_process');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const sessionService = require('../src/services/sessionService');
const r2LiveStorage = require('../src/services/r2LiveStorageService');
const r2Storage = require('../src/services/r2StorageService');

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:8080/v1').replace(/\/$/, '');
const ORIGIN = API_BASE.replace(/\/v1$/, '');
const BROWSER_ORIGIN = process.env.TEST_BROWSER_ORIGIN || 'http://localhost:3000';
const RUN_ID = Date.now().toString(36);

const checks = [];
function pass(name, detail) {
  checks.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function fail(name, detail) {
  checks.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? `: ${detail}` : ''}`);
}

const dummy = {
  teacherId: crypto.randomUUID(),
  courseId: crypto.randomUUID(),
  lessonId: crypto.randomUUID(),
  studentIds: Array.from({ length: 3 }, () => crypto.randomUUID()),
  teacherEmail: `r2pipe-teacher-${RUN_ID}@dummy.local`,
  studentEmails: Array.from({ length: 3 }, (_, i) => `r2pipe-student${i + 1}-${RUN_ID}@dummy.local`),
  liveSessionId: null,
  streamKey: null,
};

async function request(method, p, { token, body, origin } = {}) {
  const url = `${API_BASE}${p.startsWith('/') ? p : `/${p}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin, Referer: `${origin}/` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  return { status: res.status, data, text, headers: res.headers };
}

async function issueToken(userId, email, role) {
  const jti = crypto.randomUUID();
  await sessionService.create({
    userId, jti, deviceId: `pipe-${jti}`,
    req: { headers: { 'user-agent': 'R2Pipeline/1.0' }, clientIp: '127.0.0.1' },
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
  return jwt.sign({ id: userId, email, role, jti }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1h' });
}

async function seed() {
  const hash = await bcrypt.hash('x', 10);
  await db.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'teacher')`,
    [dummy.teacherId, dummy.teacherEmail, hash]);
  for (let i = 0; i < dummy.studentIds.length; i++) {
    await db.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'student')`,
      [dummy.studentIds[i], dummy.studentEmails[i], hash]);
  }
  await db.query(
    `INSERT INTO courses (id, title, description, teacher_id, has_live_class, course_type, status, price, currency)
     VALUES ($1, $2, 'pipeline', $3, true, 'lesson-based', 'active', 0, 'BDT')`,
    [dummy.courseId, `Pipeline ${RUN_ID}`, dummy.teacherId]
  );
  await db.query(`INSERT INTO lessons (id, course_id, title, description, "order") VALUES ($1, $2, 'Pipeline', 'pipeline', 0)`,
    [dummy.lessonId, dummy.courseId]);
  for (const sid of dummy.studentIds) {
    await db.query(`INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [sid, dummy.courseId]);
  }
}

async function cleanup() {
  if (dummy.liveSessionId && r2Storage.isConfigured) {
    try { await r2LiveStorage.cleanupLiveSession(dummy.liveSessionId); } catch (_) {}
  }
  await db.query('DELETE FROM live_sessions WHERE lesson_id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])', [[dummy.teacherId, ...dummy.studentIds]]);
  await db.query('DELETE FROM course_enrollments WHERE course_id = $1', [dummy.courseId]);
  await db.query('DELETE FROM lessons WHERE id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM courses WHERE id = $1', [dummy.courseId]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[dummy.teacherId, ...dummy.studentIds]]);
}

/** ffmpeg runs inside the worker container so it can reach mediamtx over the compose network. */
function startPublisher(streamKey) {
  const args = [
    'compose', 'exec', '-T', 'worker', 'ffmpeg',
    '-hide_banner', '-loglevel', 'error', '-re',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-g', '30', '-b:v', '2000k',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-f', 'rtsp', '-rtsp_transport', 'tcp',
    `rtsp://mediamtx:8554/live_${streamKey}`,
  ];
  const proc = spawn('docker', args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.on('error', (e) => { stderr += e.message; });
  return { proc, getStderr: () => stderr };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollPlaylist(token, { timeoutMs = 45000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, {
      token, origin: BROWSER_ORIGIN,
    });
    last = res;
    if (res.status === 200 && res.text.includes('#EXTM3U')) return res;
    await sleep(intervalMs);
  }
  return last;
}

async function main() {
  console.log('\n=== R2 Live Pipeline Test (real video through MediaMTX) ===\n');

  const health = await fetch(`${ORIGIN}/health`).catch(() => null);
  health?.ok ? pass('API reachable', `${ORIGIN}/health`) : fail('API reachable', 'not reachable');

  await db.query(`UPDATE admin_live_settings SET r2_live_enabled = true WHERE id = '00000000-0000-0000-0000-000000000002'`);
  await seed();
  pass('Dummy data seeded', '1 teacher + 3 students');

  const teacherToken = await issueToken(dummy.teacherId, dummy.teacherEmail, 'teacher');
  const start = await request('PUT', `/lessons/${dummy.lessonId}/live`, {
    token: teacherToken,
    body: { is_live: true, live_name: 'Pipeline Test', live_order: 0 },
  });
  dummy.liveSessionId = start.data?.live_session_id;
  dummy.streamKey = start.data?.streamKey;

  start.status === 200 && start.data?.provider === 'r2_live' && dummy.streamKey
    ? pass('Start live → r2_live', 'WHIP credentials issued')
    : fail('Start live', `status=${start.status} provider=${start.data?.provider}`);

  if (!dummy.streamKey) throw new Error('No stream key issued — cannot publish');

  console.log('\n  … publishing test video into MediaMTX (ffmpeg)\n');
  const publisher = startPublisher(dummy.streamKey);
  await sleep(6000);

  if (publisher.proc.exitCode !== null) {
    fail('ffmpeg publish', `exited early: ${publisher.getStderr().slice(0, 300)}`);
  } else {
    pass('ffmpeg publish', 'RTSP ingest running');
  }

  const studentToken = await issueToken(dummy.studentIds[0], dummy.studentEmails[0], 'student');
  const master = await pollPlaylist(studentToken);

  master?.status === 200 && master.text.includes('#EXTM3U')
    ? pass('Student master playlist', `${master.status} #EXTM3U`)
    : fail('Student master playlist', `status=${master?.status} body=${(master?.text || '').slice(0, 120)}`);

  const redact = (s) => String(s || '').replace(/token=[^&\s]+/g, 'token=***');
  console.log('\n--- master.m3u8 ---\n' + redact(master?.text).trim() + '\n-------------------\n');

  const variantLine = (master?.text || '').split('\n').find((l) => l.trim().startsWith('http'));
  variantLine
    ? pass('Master references variant playlist', 'absolute URL present')
    : fail('Master references variant playlist', 'no variant URL');

  let mediaText = '';
  if (variantLine) {
    const res = await fetch(variantLine.trim(), { headers: { Origin: BROWSER_ORIGIN, Referer: `${BROWSER_ORIGIN}/` } });
    mediaText = await res.text();
    res.ok && mediaText.includes('#EXTINF')
      ? pass('Variant playlist has segments', `${(mediaText.match(/#EXTINF/g) || []).length} segments`)
      : fail('Variant playlist has segments', `status=${res.status} body=${mediaText.slice(0, 120)}`);
  }

  const segmentUrl = mediaText.split('\n').map((l) => l.trim()).find((l) => l.startsWith('http'));
  if (segmentUrl) {
    const segRes = await fetch(segmentUrl, { headers: { Origin: BROWSER_ORIGIN, Referer: `${BROWSER_ORIGIN}/` } });
    const buf = Buffer.from(await segRes.arrayBuffer());
    segRes.ok && buf.length > 1000
      ? pass('Segment downloadable', `${buf.length} bytes, ${segRes.headers.get('content-type')}`)
      : fail('Segment downloadable', `status=${segRes.status} size=${buf.length}`);

    segRes.headers.get('access-control-allow-origin') === BROWSER_ORIGIN
      ? pass('Segment CORS header', BROWSER_ORIGIN)
      : fail('Segment CORS header', segRes.headers.get('access-control-allow-origin') || 'missing');
  } else {
    fail('Segment downloadable', 'no segment URL in variant playlist');
  }

  // Docker worker should be mirroring MediaMTX output into R2 by now.
  let r2Keys = [];
  const r2Deadline = Date.now() + 20000;
  while (Date.now() < r2Deadline) {
    r2Keys = await r2Storage.listObjects(r2LiveStorage.getLiveSessionPrefix(dummy.liveSessionId));
    if (r2Keys.some((k) => /\.ts$/.test(k)) && r2Keys.some((k) => k.endsWith('master.m3u8'))) break;
    await sleep(1500);
  }
  r2Keys.some((k) => /\.ts$/.test(k))
    ? pass('Worker uploaded segments to R2', `${r2Keys.filter((k) => /\.ts$/.test(k)).length} segments`)
    : fail('Worker uploaded segments to R2', `keys=${r2Keys.length}`);
  r2Keys.some((k) => k.endsWith('master.m3u8'))
    ? pass('R2 master playlist present', 'master.m3u8')
    : fail('R2 master playlist present', 'missing');

  const readyRow = (await db.query('SELECT hls_ready_at FROM live_sessions WHERE id = $1', [dummy.liveSessionId])).rows[0];
  readyRow?.hls_ready_at ? pass('hls_ready_at set', String(readyRow.hls_ready_at)) : fail('hls_ready_at set', 'not set');

  let studentsOk = 0;
  for (let i = 1; i < dummy.studentIds.length; i++) {
    const t = await issueToken(dummy.studentIds[i], dummy.studentEmails[i], 'student');
    const r = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, { token: t, origin: BROWSER_ORIGIN });
    if (r.status === 200 && r.text.includes('#EXTM3U')) studentsOk++;
  }
  studentsOk === dummy.studentIds.length - 1
    ? pass('Other enrolled students can watch', `${studentsOk}/${dummy.studentIds.length - 1}`)
    : fail('Other enrolled students can watch', `${studentsOk}/${dummy.studentIds.length - 1}`);

  const outsiderId = crypto.randomUUID();
  await db.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'student')`,
    [outsiderId, `r2pipe-outsider-${RUN_ID}@dummy.local`, await bcrypt.hash('x', 10)]);
  const outsiderToken = await issueToken(outsiderId, `r2pipe-outsider-${RUN_ID}@dummy.local`, 'student');
  const outsider = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, { token: outsiderToken });
  outsider.status === 403
    ? pass('Unenrolled student blocked', '403')
    : fail('Unenrolled student blocked', `status=${outsider.status}`);
  await db.query('DELETE FROM user_sessions WHERE user_id = $1', [outsiderId]);
  await db.query('DELETE FROM users WHERE id = $1', [outsiderId]);

  try { publisher.proc.kill(); } catch (_) {}
  await request('PUT', `/lessons/${dummy.lessonId}/live`, { token: teacherToken, body: { is_live: false } });
  pass('End live', 'session closed');

  const allOk = checks.every((c) => c.ok);
  console.log('\n=== RESULT:', allOk ? 'LIVE PIPELINE WORKING ✓' : 'SOME CHECKS FAILED ✗', '===\n');
  if (!allOk) {
    console.log(JSON.stringify(checks.filter((c) => !c.ok), null, 2));
  }

  await cleanup();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('PIPELINE TEST FAILED:', e.message);
  try { await cleanup(); } catch (_) {}
  process.exit(1);
});
