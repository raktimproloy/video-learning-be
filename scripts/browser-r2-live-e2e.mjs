/**
 * Browser E2E: teacher WHIP live → student HLS view → save recording.
 * Opens visible Chromium windows. Requires Docker stack @8080 + frontend @3000.
 *
 * Usage: node scripts/browser-r2-live-e2e.mjs
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const db = require('../db');
const r2LiveStorage = require('../src/services/r2LiveStorageService');
const r2Storage = require('../src/services/r2StorageService');

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';
const API_ORIGIN = (process.env.API_BASE_URL || 'http://localhost:8080/v1').replace(/\/v1$/, '');
const PASSWORD = 'BrowserLiveTest1!';
const RUN_ID = Date.now().toString(36);
const REPORT_PATH = path.join(__dirname, `r2-live-browser-report-${RUN_ID}.json`);

const dummy = {
  teacherId: crypto.randomUUID(),
  studentId: crypto.randomUUID(),
  courseId: crypto.randomUUID(),
  lessonId: crypto.randomUUID(),
  teacherEmail: `browser-teacher-${RUN_ID}@dummy.local`,
  studentEmail: `browser-student-${RUN_ID}@dummy.local`,
  liveSessionId: null,
};

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  frontend: FRONTEND,
  api: API_ORIGIN,
  provider: 'r2_live',
  metrics: {},
  timeline: [],
  checks: [],
  save: null,
};

function log(event, detail) {
  const entry = { t: Date.now(), event, detail };
  report.timeline.push(entry);
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${event}${detail ? `: ${detail}` : ''}`);
}

function check(name, ok, detail) {
  report.checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function seed() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  await db.query(
    `INSERT INTO users (id, email, password_hash, role, core_member, name)
     VALUES ($1, $2, $3, 'teacher', true, $4)`,
    [dummy.teacherId, dummy.teacherEmail, hash, `Browser Teacher ${RUN_ID}`]
  );
  await db.query(
    `INSERT INTO users (id, email, password_hash, role, name)
     VALUES ($1, $2, $3, 'student', $4)`,
    [dummy.studentId, dummy.studentEmail, hash, `Browser Student ${RUN_ID}`]
  );
  await db.query(
    `INSERT INTO courses (id, title, description, teacher_id, has_live_class, course_type, status, price, currency)
     VALUES ($1, $2, $3, $4, true, 'lesson-based', 'active', 0, 'BDT')`,
    [dummy.courseId, `Browser Live Course ${RUN_ID}`, 'E2E browser test', dummy.teacherId]
  );
  await db.query(
    `INSERT INTO lessons (id, course_id, title, description, "order")
     VALUES ($1, $2, $3, $4, 0)`,
    [dummy.lessonId, dummy.courseId, `Browser Live Lesson ${RUN_ID}`, 'Browser E2E']
  );
  await db.query(
    `INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [dummy.studentId, dummy.courseId]
  );
  await db.query(
    `UPDATE admin_live_settings SET r2_live_enabled = true WHERE id = '00000000-0000-0000-0000-000000000002'`
  );
}

async function cleanup() {
  if (dummy.liveSessionId && r2Storage.isConfigured) {
    try { await r2LiveStorage.cleanupLiveSession(dummy.liveSessionId); } catch (_) {}
  }
  await db.query('DELETE FROM video_processing_tasks WHERE video_id = $1', [dummy.liveSessionId]).catch(() => {});
  await db.query('DELETE FROM videos WHERE id = $1', [dummy.liveSessionId]).catch(() => {});
  await db.query('DELETE FROM live_sessions WHERE lesson_id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])', [[dummy.teacherId, dummy.studentId]]);
  await db.query('DELETE FROM course_enrollments WHERE course_id = $1', [dummy.courseId]);
  await db.query('DELETE FROM lessons WHERE id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM courses WHERE id = $1', [dummy.courseId]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[dummy.teacherId, dummy.studentId]]);
}

async function login(page, email) {
  await page.goto(`${FRONTEND}/auth`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: /log in|login|sign in/i }).click();
  await page.waitForURL(/teacher|student|dashboard|courses|auth\/complete-profile/, { timeout: 30000 });
  if (page.url().includes('complete-profile')) {
    await page.fill('#name, input[name="name"]', email.split('@')[0]).catch(() => {});
    const saveBtn = page.getByRole('button', { name: /save|continue|complete/i }).first();
    if (await saveBtn.isVisible().catch(() => false)) await saveBtn.click();
    await page.waitForURL(/teacher|student|dashboard|courses/, { timeout: 20000 }).catch(() => {});
  }
}

async function getVideoMetrics(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    const buffered = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : null;
    return {
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      readyState: v.readyState,
      paused: v.paused,
      currentTime: v.currentTime,
      playbackRate: v.playbackRate,
      bufferAheadSec: buffered != null ? Math.round(buffered * 100) / 100 : null,
    };
  });
}

async function getTeacherWebRtcStats(page) {
  return page.evaluate(async () => {
    const pcs = [];
    // @ts-ignore
    if (window.__r2LivePc) pcs.push(window.__r2LivePc);
    const result = { outboundFps: null, outboundBitrateKbps: null, rttMs: null, packetsLost: null };
    for (const pc of pcs) {
      const stats = await pc.getStats();
      stats.forEach((s) => {
        if (s.type === 'outbound-rtp' && s.kind === 'video') {
          if (s.framesPerSecond != null) result.outboundFps = Math.round(s.framesPerSecond * 10) / 10;
          if (s.bytesSent && s.timestamp) result.outboundBitrateKbps = Math.round((s.bytesSent * 8) / 1000);
        }
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null) {
          result.rttMs = Math.round(s.currentRoundTripTime * 1000);
        }
        if (s.type === 'remote-inbound-rtp' && s.packetsLost != null) {
          result.packetsLost = s.packetsLost;
        }
      });
    }
    return result;
  });
}

async function injectPcHook(page) {
  await page.addInitScript(() => {
    const Orig = window.RTCPeerConnection;
    if (!Orig) return;
    // @ts-ignore
    window.RTCPeerConnection = function (...args) {
      const pc = new Orig(...args);
      // @ts-ignore
      window.__r2LivePc = pc;
      return pc;
    };
    window.RTCPeerConnection.prototype = Orig.prototype;
  });
}

async function waitForHlsReady(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (dummy.liveSessionId) {
      const r = await db.query('SELECT hls_ready_at FROM live_sessions WHERE id = $1', [dummy.liveSessionId]);
      if (r.rows[0]?.hls_ready_at) return r.rows[0].hls_ready_at;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function countR2Segments(sessionId) {
  const prefix = r2LiveStorage.getLiveSessionPrefix(sessionId);
  const keys = await r2Storage.listObjects(prefix);
  return keys.filter((k) => k.endsWith('.ts') || k.endsWith('.m4s')).length;
}

async function main() {
  log('seed', 'dummy teacher + student');
  await seed();

  const teacherLiveUrl = `${FRONTEND}/teacher/courses/${dummy.courseId}/lessons/${dummy.lessonId}/live`;
  const studentLiveUrl = `${FRONTEND}/student/courses/${dummy.courseId}/lessons/${dummy.lessonId}/live`;

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-insecure-localhost',
    ],
  });

  const teacherCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['camera', 'microphone'],
  });
  const studentCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  const teacherPage = await teacherCtx.newPage();
  const studentPage = await studentCtx.newPage();
  await injectPcHook(teacherPage);

  try {
    // --- TEACHER LOGIN + GO LIVE ---
    log('teacher', 'login');
    const tLoginStart = Date.now();
    await login(teacherPage, dummy.teacherEmail);
    report.metrics.teacherLoginMs = Date.now() - tLoginStart;

    log('teacher', `navigate ${teacherLiveUrl}`);
    await teacherPage.goto(teacherLiveUrl, { waitUntil: 'networkidle', timeout: 60000 });

    const goLiveBtn = teacherPage.getByRole('button', { name: /go live/i });
    await goLiveBtn.waitFor({ state: 'visible', timeout: 30000 });
    const goLiveStart = Date.now();
    await goLiveBtn.click();
    log('teacher', 'clicked Go Live');

    await teacherPage.waitForURL(/\/live\//, { timeout: 45000 });
    const sessionMatch = teacherPage.url().match(/\/live\/([0-9a-f-]{36})/i);
    dummy.liveSessionId = sessionMatch?.[1] || null;
    report.metrics.goLiveMs = Date.now() - goLiveStart;
    log('teacher', `session ${dummy.liveSessionId}`);

    const startLiveBtn = teacherPage.getByRole('button', { name: /^start live$/i });
    await startLiveBtn.waitFor({ state: 'visible', timeout: 30000 });
    const whipStart = Date.now();
    await startLiveBtn.click();
    log('teacher', 'clicked Start Live (WHIP publish)');

    await teacherPage.getByText('ONGOING').waitFor({ timeout: 60000 });
    await teacherPage.getByText('R2 Live (HLS)').waitFor({ timeout: 15000 }).catch(() => {});

    // Wait for WHIP + local preview
    await teacherPage.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2 && v.videoWidth > 0;
      },
      { timeout: 45000 }
    );
    report.metrics.whipConnectMs = Date.now() - whipStart;
    log('teacher', `WHIP connected in ${report.metrics.whipConnectMs}ms`);

    // Stream for segments
    log('live', 'streaming 25s for HLS segments → R2');
    await teacherPage.waitForTimeout(25000);

    const teacherVideo = await getVideoMetrics(teacherPage);
    report.metrics.teacherPreview = teacherVideo;
    const webrtcStats = await getTeacherWebRtcStats(teacherPage);
    report.metrics.teacherWebRtc = webrtcStats;

    const hlsReadyAt = await waitForHlsReady(60000);
    report.metrics.hlsReadyWaitMs = hlsReadyAt ? 'ready' : 'timeout';
    const segCount = dummy.liveSessionId ? await countR2Segments(dummy.liveSessionId) : 0;
    report.metrics.r2SegmentCount = segCount;
    log('r2', `${segCount} segments in bucket`);

    // --- STUDENT JOIN ---
    log('student', 'login');
    const sLoginStart = Date.now();
    await login(studentPage, dummy.studentEmail);
    report.metrics.studentLoginMs = Date.now() - sLoginStart;

    log('student', `join ${studentLiveUrl}`);
    const studentJoinStart = Date.now();
    await studentPage.goto(studentLiveUrl, { waitUntil: 'networkidle', timeout: 60000 });

    await studentPage.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && !v.paused && v.readyState >= 2 && v.currentTime > 0;
      },
      { timeout: 120000 }
    );
    report.metrics.studentFirstFrameMs = Date.now() - studentJoinStart;

    // Collect student metrics over 10s
    await studentPage.waitForTimeout(10000);
    const studentVideo = await getVideoMetrics(studentPage);
    report.metrics.studentPlayback = studentVideo;

    const studentLive = await studentPage.locator('text=/live|streaming|watching/i').first().isVisible().catch(() => false);
    check('Teacher WHIP connected', report.metrics.whipConnectMs < 45000, `${report.metrics.whipConnectMs}ms`);
    check('Teacher preview resolution', teacherVideo?.videoWidth >= 640, `${teacherVideo?.videoWidth}x${teacherVideo?.videoHeight}`);
    check('Teacher outbound FPS', webrtcStats?.outboundFps != null, `${webrtcStats?.outboundFps ?? 'n/a'} fps`);
    check('Teacher RTT', webrtcStats?.rttMs != null, `${webrtcStats?.rttMs ?? 'n/a'} ms`);
    check('R2 segments uploaded', segCount >= 1, `${segCount} segments`);
    check('HLS ready in DB', !!hlsReadyAt, hlsReadyAt ? String(hlsReadyAt) : 'timeout');
    check('Student first frame', report.metrics.studentFirstFrameMs < 120000, `${report.metrics.studentFirstFrameMs}ms`);
    check('Student playback resolution', (studentVideo?.videoWidth || 0) > 0, `${studentVideo?.videoWidth}x${studentVideo?.videoHeight}`);
    check('Student buffer/latency', studentVideo?.bufferAheadSec != null, `~${studentVideo?.bufferAheadSec}s ahead`);
    check('Student live UI', studentLive || (studentVideo?.currentTime || 0) > 0, 'playing');

    // --- SAVE RECORDING ---
    log('teacher', 'Stop Live → Save recording');
    await teacherPage.getByRole('button', { name: /stop live/i }).click();
    await teacherPage.getByRole('button', { name: /save recording/i }).waitFor({ timeout: 15000 });
    const saveStart = Date.now();
    await teacherPage.getByRole('button', { name: /save recording/i }).click();

    await teacherPage.waitForURL(/\/teacher\/courses\//, { timeout: 60000 }).catch(() => {});
    report.metrics.saveClickMs = Date.now() - saveStart;

    // Poll DB for video + task
    let saveOk = false;
    for (let i = 0; i < 20; i++) {
      const vid = await db.query('SELECT id, title, storage_provider FROM videos WHERE id = $1', [dummy.liveSessionId]);
      const task = await db.query(
        `SELECT id, status, task_type FROM video_processing_tasks WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [dummy.liveSessionId]
      );
      if (vid.rows[0] && task.rows[0]) {
        report.save = { video: vid.rows[0], task: task.rows[0] };
        saveOk = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    check('Save → video row created', !!report.save?.video, report.save?.video?.title);
    check('Save → encrypt task queued', report.save?.task?.task_type === 'live_hls_encrypt', report.save?.task?.status);

    report.finishedAt = new Date().toISOString();
    report.ok = report.checks.every((c) => c.ok);

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log('report', REPORT_PATH);

    console.log('\n========== R2 LIVE BROWSER REPORT ==========');
    console.log(`Provider:     r2_live`);
    console.log(`Teacher WHIP: ${report.metrics.whipConnectMs}ms`);
    console.log(`Teacher FPS:    ${webrtcStats?.outboundFps ?? 'n/a'}`);
    console.log(`Teacher RTT:    ${webrtcStats?.rttMs ?? 'n/a'} ms`);
    console.log(`Quality:        ${teacherVideo?.videoWidth}x${teacherVideo?.videoHeight} (teacher preview)`);
    console.log(`Student join:   ${report.metrics.studentFirstFrameMs}ms to first frame`);
    console.log(`Student qual:   ${studentVideo?.videoWidth}x${studentVideo?.videoHeight}`);
    console.log(`Latency buffer: ~${studentVideo?.bufferAheadSec}s`);
    console.log(`R2 segments:    ${segCount}`);
    console.log(`Save:           ${saveOk ? report.save?.task?.status : 'FAILED'}`);
    console.log(`Overall:        ${report.ok ? 'PASS ✓' : 'PARTIAL/FAIL ✗'}`);
    console.log(`Report file:    ${REPORT_PATH}`);
    console.log('============================================\n');

    await teacherPage.waitForTimeout(5000);
  } finally {
    await browser.close();
    await cleanup();
    process.exit(report.ok ? 0 : 1);
  }
}

main().catch(async (e) => {
  console.error('BROWSER E2E FAILED:', e.message);
  try { await cleanup(); } catch (_) {}
  process.exit(1);
});
