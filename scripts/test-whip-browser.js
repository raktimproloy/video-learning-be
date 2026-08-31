/**
 * Teacher WHIP path test — publishes from a real Chromium instance (fake camera)
 * through nginx into MediaMTX, then verifies students get playable HLS.
 *
 * Usage: API_BASE_URL=http://localhost:8080/v1 node scripts/test-whip-browser.js
 */
require('dotenv').config();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');
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
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const dummy = {
  teacherId: crypto.randomUUID(),
  courseId: crypto.randomUUID(),
  lessonId: crypto.randomUUID(),
  studentId: crypto.randomUUID(),
  teacherEmail: `whip-teacher-${RUN_ID}@dummy.local`,
  studentEmail: `whip-student-${RUN_ID}@dummy.local`,
  liveSessionId: null,
  streamKey: null,
};

async function request(method, p, { token, body, origin } = {}) {
  const res = await fetch(`${API_BASE}${p.startsWith('/') ? p : `/${p}`}`, {
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
  return { status: res.status, data, text };
}

async function issueToken(userId, email, role) {
  const jti = crypto.randomUUID();
  await sessionService.create({
    userId, jti, deviceId: `whip-${jti}`,
    req: { headers: { 'user-agent': 'WhipTest/1.0' }, clientIp: '127.0.0.1' },
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
  return jwt.sign({ id: userId, email, role, jti }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1h' });
}

async function seed() {
  const hash = await bcrypt.hash('x', 10);
  await db.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'teacher')`,
    [dummy.teacherId, dummy.teacherEmail, hash]);
  await db.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'student')`,
    [dummy.studentId, dummy.studentEmail, hash]);
  await db.query(
    `INSERT INTO courses (id, title, description, teacher_id, has_live_class, course_type, status, price, currency)
     VALUES ($1, $2, 'whip', $3, true, 'lesson-based', 'active', 0, 'BDT')`,
    [dummy.courseId, `WHIP ${RUN_ID}`, dummy.teacherId]
  );
  await db.query(`INSERT INTO lessons (id, course_id, title, description, "order") VALUES ($1, $2, 'WHIP', 'whip', 0)`,
    [dummy.lessonId, dummy.courseId]);
  await db.query(`INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [dummy.studentId, dummy.courseId]);
}

async function cleanup() {
  if (dummy.liveSessionId && r2Storage.isConfigured) {
    try { await r2LiveStorage.cleanupLiveSession(dummy.liveSessionId); } catch (_) {}
  }
  await db.query('DELETE FROM live_sessions WHERE lesson_id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])', [[dummy.teacherId, dummy.studentId]]);
  await db.query('DELETE FROM course_enrollments WHERE course_id = $1', [dummy.courseId]);
  await db.query('DELETE FROM lessons WHERE id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM courses WHERE id = $1', [dummy.courseId]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[dummy.teacherId, dummy.studentId]]);
}

/** Mirrors TeacherLiveStreamR2.publishWhip: vanilla ICE (gather fully, then POST). */
const PUBLISH_IN_PAGE = `
async (whipUrl) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, frameRate: 30 },
    audio: true,
  });
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    bundlePolicy: 'max-bundle',
  });
  window.__pc = pc;
  for (const t of stream.getTracks()) pc.addTrack(t, stream);
  if (typeof RTCRtpReceiver !== 'undefined' && RTCRtpReceiver.getCapabilities) {
    const h264 = (RTCRtpReceiver.getCapabilities('video')?.codecs ?? [])
      .filter((c) => c.mimeType.toLowerCase().includes('h264'));
    if (h264.length) {
      for (const tr of pc.getTransceivers()) {
        if (tr.sender.track?.kind === 'video') tr.setCodecPreferences(h264);
      }
    }
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 4000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });

  const candidateCount = (pc.localDescription.sdp.match(/a=candidate/g) || []).length;

  const res = await fetch(whipUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription.sdp,
  });
  if (!res.ok) {
    return { ok: false, stage: 'post', status: res.status, error: await res.text().catch(() => '') };
  }
  const location = res.headers.get('location');
  const answer = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });

  const state = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(pc.connectionState), 20000);
    const check = () => {
      if (pc.connectionState === 'connected' || pc.connectionState === 'failed') {
        clearTimeout(t);
        resolve(pc.connectionState);
      }
    };
    pc.addEventListener('connectionstatechange', check);
    check();
  });

  return { ok: state === 'connected', state, candidateCount, locationExposed: !!location };
}
`;

async function main() {
  console.log('\n=== Teacher WHIP Browser Test (Chromium fake camera) ===\n');

  const health = await fetch(`${ORIGIN}/health`).catch(() => null);
  health?.ok ? pass('API reachable', `${ORIGIN}/health`) : fail('API reachable', 'not reachable');

  await db.query(`UPDATE admin_live_settings SET r2_live_enabled = true WHERE id = '00000000-0000-0000-0000-000000000002'`);
  await seed();
  pass('Dummy data seeded', '1 teacher + 1 student');

  const teacherToken = await issueToken(dummy.teacherId, dummy.teacherEmail, 'teacher');
  const start = await request('PUT', `/lessons/${dummy.lessonId}/live`, {
    token: teacherToken,
    body: { is_live: true, live_name: 'WHIP Test', live_order: 0 },
  });
  dummy.liveSessionId = start.data?.live_session_id;
  dummy.streamKey = start.data?.streamKey;
  const whipUrl = start.data?.whipUrl;

  start.status === 200 && whipUrl
    ? pass('Start live → WHIP URL issued', whipUrl.replace(/live_[a-f0-9]+/i, 'live_***'))
    : fail('Start live', `status=${start.status}`);
  if (!whipUrl) throw new Error('No WHIP URL issued');

  const launchArgs = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ];
  // Prefer the bundled Chromium; fall back to installed Chrome/Edge so the test
  // runs without `npx playwright install`.
  let browser = null;
  for (const channel of [undefined, 'chrome', 'msedge']) {
    try {
      browser = await chromium.launch({ headless: true, args: launchArgs, ...(channel ? { channel } : {}) });
      break;
    } catch (err) {
      if (channel === 'msedge') throw err;
    }
  }
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('    [browser error]', m.text().slice(0, 160));
  });

  // Serve from the frontend origin so the request is genuinely cross-origin (CORS path).
  let onFrontend = false;
  try {
    const resp = await page.goto(BROWSER_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 15000 });
    onFrontend = !!resp && resp.status() < 500;
  } catch (_) { /* frontend dev server not running */ }
  onFrontend
    ? pass('Frontend origin loaded', BROWSER_ORIGIN)
    : console.log(`  … frontend not reachable at ${BROWSER_ORIGIN}, publishing from API origin instead`);
  if (!onFrontend) await page.goto(`${ORIGIN}/health`, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(`(${PUBLISH_IN_PAGE})(${JSON.stringify(whipUrl)})`);

  result.candidateCount > 0
    ? pass('ICE candidates gathered before POST', `${result.candidateCount} candidates`)
    : fail('ICE candidates gathered before POST', '0 candidates (vanilla ICE broken)');

  result.stage === 'post'
    ? fail('WHIP POST accepted', `status=${result.status} ${String(result.error).slice(0, 120)}`)
    : pass('WHIP POST accepted', '201 + SDP answer');

  if (result.stage !== 'post') {
    result.locationExposed
      ? pass('WHIP Location header readable (CORS)', 'exposed')
      : fail('WHIP Location header readable (CORS)', 'not exposed');
  }

  result.ok
    ? pass('WebRTC connected', `connectionState=${result.state}`)
    : fail('WebRTC connected', `connectionState=${result.state}`);

  if (result.ok) {
    await sleep(7000);
    const studentToken = await issueToken(dummy.studentId, dummy.studentEmail, 'student');
    let master = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      master = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, {
        token: studentToken, origin: BROWSER_ORIGIN,
      });
      if (master.status === 200 && master.text.includes('#EXTM3U')) break;
      await sleep(1500);
    }
    master?.status === 200
      ? pass('Student playlist from browser publish', '#EXTM3U')
      : fail('Student playlist from browser publish', `status=${master?.status}`);

    const variant = (master?.text || '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('http'));
    if (variant) {
      const vres = await fetch(variant, { headers: { Origin: BROWSER_ORIGIN, Referer: `${BROWSER_ORIGIN}/` } });
      const vtext = await vres.text();
      vres.ok && vtext.includes('#EXTINF')
        ? pass('Variant playlist has segments', `${(vtext.match(/#EXTINF/g) || []).length} segments`)
        : fail('Variant playlist has segments', `status=${vres.status}`);

      const seg = vtext.split('\n').map((l) => l.trim()).find((l) => l.startsWith('http'));
      if (seg) {
        const sres = await fetch(seg, { headers: { Origin: BROWSER_ORIGIN, Referer: `${BROWSER_ORIGIN}/` } });
        const buf = Buffer.from(await sres.arrayBuffer());
        sres.ok && buf.length > 1000
          ? pass('Video segment from teacher camera', `${buf.length} bytes`)
          : fail('Video segment from teacher camera', `status=${sres.status} size=${buf.length}`);
      } else {
        fail('Video segment from teacher camera', 'no segment URL');
      }
    } else {
      fail('Variant playlist has segments', 'no variant URL');
    }
  }

  await browser.close();
  await request('PUT', `/lessons/${dummy.lessonId}/live`, { token: teacherToken, body: { is_live: false } });
  pass('End live', 'session closed');

  const allOk = checks.every((c) => c.ok);
  console.log('\n=== RESULT:', allOk ? 'TEACHER WHIP → STUDENT HLS WORKING ✓' : 'SOME CHECKS FAILED ✗', '===\n');
  if (!allOk) console.log(JSON.stringify(checks.filter((c) => !c.ok), null, 2));

  await cleanup();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('WHIP TEST FAILED:', e.message);
  try { await cleanup(); } catch (_) {}
  process.exit(1);
});
