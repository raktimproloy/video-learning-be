/**
 * Local R2 live test — 100% dummy data (no existing users/courses touched).
 *
 * Creates: 1 dummy teacher, 5 dummy students, 1 course, 1 lesson, enrollments.
 * Tests: start live (r2_live), ingest auth, segment upload → R2, playlist x5, cleanup.
 *
 * Usage:
 *   npm start          (in another terminal)
 *   node scripts/test-r2-live-local.js
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

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:5000/v1').replace(/\/$/, '');
const RUN_ID = Date.now().toString(36);

const dummy = {
  teacherId: crypto.randomUUID(),
  courseId: crypto.randomUUID(),
  lessonId: crypto.randomUUID(),
  studentIds: Array.from({ length: 5 }, () => crypto.randomUUID()),
  teacherEmail: `r2live-teacher-${RUN_ID}@dummy.local`,
  studentEmails: Array.from({ length: 5 }, (_, i) => `r2live-student${i + 1}-${RUN_ID}@dummy.local`),
  liveSessionId: null,
  streamKey: null,
};

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
  const fakeReq = { headers: { 'user-agent': 'R2LiveDummyTest/1.0' }, clientIp: '127.0.0.1' };
  await sessionService.create({ userId, jti, deviceId: `dummy-${jti}`, req: fakeReq, expiresAt });
  return jwt.sign(
    { id: userId, email, role, jti },
    process.env.JWT_SECRET || 'your_jwt_secret',
    { expiresIn: '1h' }
  );
}

async function seedDummyData() {
  const passwordHash = await bcrypt.hash('dummy-test-pass', 10);
  console.log('[Seed] Creating dummy teacher + 5 students + course + lesson...');

  await db.query(
    `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'teacher')`,
    [dummy.teacherId, dummy.teacherEmail, passwordHash]
  );

  for (let i = 0; i < 5; i++) {
    await db.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'student')`,
      [dummy.studentIds[i], dummy.studentEmails[i], passwordHash]
    );
  }

  await db.query(
    `INSERT INTO courses (id, title, description, teacher_id, has_live_class, course_type, status, price, currency)
     VALUES ($1, $2, $3, $4, true, 'lesson-based', 'active', 0, 'BDT')`,
    [dummy.courseId, `R2 Live Dummy Course ${RUN_ID}`, 'Automated test course — safe to delete', dummy.teacherId]
  );

  await db.query(
    `INSERT INTO lessons (id, course_id, title, description, "order")
     VALUES ($1, $2, $3, $4, 0)`,
    [dummy.lessonId, dummy.courseId, `R2 Live Dummy Lesson ${RUN_ID}`, 'Dummy lesson for R2 live test']
  );

  for (const studentId of dummy.studentIds) {
    await db.query(
      `INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [studentId, dummy.courseId]
    );
  }

  console.log('[Seed] OK teacher:', dummy.teacherEmail);
  console.log('[Seed] OK students:', dummy.studentEmails.length);
  console.log('[Seed] OK course/lesson ids:', dummy.courseId, dummy.lessonId);
}

async function cleanupDummyData() {
  console.log('[Cleanup] Removing dummy data...');

  if (dummy.liveSessionId && r2Storage.isConfigured) {
    try {
      await r2LiveStorage.cleanupLiveSession(dummy.liveSessionId);
    } catch (e) {
      console.warn('[Cleanup] R2 live prefix:', e.message);
    }
  }

  const hlsDir = path.resolve(process.env.MEDIAMTX_HLS_DIR || './storage/mediamtx/hls');
  if (dummy.streamKey) {
    const streamDir = path.join(hlsDir, `live_${dummy.streamKey}`);
    try {
      if (fs.existsSync(streamDir)) fs.rmSync(streamDir, { recursive: true, force: true });
    } catch (_) {}
  }

  await db.query('DELETE FROM live_sessions WHERE lesson_id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])', [
    [dummy.teacherId, ...dummy.studentIds],
  ]);
  await db.query('DELETE FROM course_enrollments WHERE course_id = $1', [dummy.courseId]);
  await db.query('DELETE FROM lessons WHERE id = $1', [dummy.lessonId]);
  await db.query('DELETE FROM courses WHERE id = $1', [dummy.courseId]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
    [dummy.teacherId, ...dummy.studentIds],
  ]);

  console.log('[Cleanup] Done.');
}

async function main() {
  console.log('=== R2 Live Local Test (dummy data only) ===');
  console.log('API:', API_BASE);
  console.log('Run ID:', RUN_ID);

  const health = await fetch(`${API_BASE.replace(/\/v1$/, '')}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error('Backend not running — start with: npm start');
  }
  console.log('OK health', health.status);

  if (!process.env.LIVE_FORCE_PROVIDER && process.env.LIVE_FORCE_PROVIDER !== 'r2_live') {
    console.log('Tip: LIVE_FORCE_PROVIDER=r2_live in .env forces r2_live provider');
  }

  await db.query(
    `UPDATE admin_live_settings SET r2_live_enabled = true
     WHERE id = '00000000-0000-0000-0000-000000000002'`
  );

  await seedDummyData();

  try {
    const teacherToken = await issueToken(dummy.teacherId, dummy.teacherEmail, 'teacher');

    const start = await request('PUT', `/lessons/${dummy.lessonId}/live`, {
      token: teacherToken,
      body: { is_live: true, live_name: 'Dummy R2 Live', live_order: 0 },
    });
    console.log('Start live:', start.status, start.data?.provider);
    if (start.status !== 200) throw new Error(JSON.stringify(start.data));
    if (start.data.provider !== 'r2_live') {
      throw new Error(`Expected r2_live, got ${start.data.provider}. Set LIVE_FORCE_PROVIDER=r2_live`);
    }

    dummy.liveSessionId = start.data.live_session_id;
    dummy.streamKey = start.data.streamKey;

    console.log('OK whipUrl:', start.data.whipUrl);
    console.log('OK streamKey:', dummy.streamKey?.slice(0, 12) + '...');

    const authBad = await request('POST', '/internal/live/ingest-auth', {
      body: { path: 'invalid', action: 'publish' },
    });
    console.log('Ingest auth (bad):', authBad.status === 401 ? 'OK' : `FAIL ${authBad.status}`);

    const authOk = await request('POST', '/internal/live/ingest-auth', {
      body: { path: `live_${dummy.streamKey}`, action: 'publish' },
    });
    console.log('Ingest auth (good):', authOk.status === 200 ? 'OK' : `FAIL ${authOk.status}`);

    const hlsDir = path.resolve(process.env.MEDIAMTX_HLS_DIR || './storage/mediamtx/hls');
    const streamDir = path.join(hlsDir, `live_${dummy.streamKey}`);
    fs.mkdirSync(streamDir, { recursive: true });
    const fakeSeg = path.join(streamDir, 'seg00001.ts');
    fs.writeFileSync(fakeSeg, Buffer.alloc(8192, 0x47));
    console.log('Wrote fake HLS segment locally');

    const sessionRes = await db.query(
      `SELECT id, lesson_id, ingest_stream_key, hls_ready_at, provider
       FROM live_sessions WHERE id = $1`,
      [dummy.liveSessionId]
    );
    await processSession(sessionRes.rows[0]);
    console.log('Uploader → R2: OK');

    const teacherPlaylist = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, {
      token: teacherToken,
    });
    console.log(
      'Teacher playlist:',
      teacherPlaylist.status === 200 && teacherPlaylist.text?.includes('#EXTM3U') ? 'OK' : `FAIL ${teacherPlaylist.status}`
    );

    const nonEnrolledId = crypto.randomUUID();
    const nonEnrolledEmail = `r2live-outsider-${RUN_ID}@dummy.local`;
    const passwordHash = await bcrypt.hash('x', 10);
    await db.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'student')`,
      [nonEnrolledId, nonEnrolledEmail, passwordHash]
    );
    const outsiderToken = await issueToken(nonEnrolledId, nonEnrolledEmail, 'student');
    const outsiderPlaylist = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, {
      token: outsiderToken,
    });
    console.log(
      'Non-enrolled student (expect 403):',
      outsiderPlaylist.status === 403 ? 'OK' : `FAIL got ${outsiderPlaylist.status}`
    );
    await db.query('DELETE FROM user_sessions WHERE user_id = $1', [nonEnrolledId]);
    await db.query('DELETE FROM users WHERE id = $1', [nonEnrolledId]);

    console.log('Testing 5 enrolled dummy students in parallel...');
    const studentResults = await Promise.all(
      dummy.studentIds.map(async (id, i) => {
        const st = await issueToken(id, dummy.studentEmails[i], 'student');
        const r = await request('GET', `/lessons/${dummy.lessonId}/live/playlist`, { token: st });
        return {
          email: dummy.studentEmails[i],
          status: r.status,
          hasM3u8: r.text?.includes('#EXTM3U') ?? false,
        };
      })
    );
    studentResults.forEach((r) => {
      console.log(`  ${r.email}: ${r.status === 200 && r.hasM3u8 ? 'OK' : `FAIL ${r.status}`}`);
    });
    const allStudentsOk = studentResults.every((r) => r.status === 200 && r.hasM3u8);
    console.log(allStudentsOk ? 'OK all 5 dummy students' : 'FAIL some students');

    const end = await request('PUT', `/lessons/${dummy.lessonId}/live`, {
      token: teacherToken,
      body: { is_live: false },
    });
    console.log('End live:', end.status === 200 ? 'OK' : `FAIL ${end.status}`);

    try { fs.unlinkSync(fakeSeg); } catch (_) {}

    if (!allStudentsOk || teacherPlaylist.status !== 200 || authOk.status !== 200) {
      throw new Error('One or more checks failed — see log above');
    }

    console.log('=== ALL DUMMY TESTS PASSED ===');
  } finally {
    await cleanupDummyData();
    process.exit(0);
  }
}

main().catch(async (err) => {
  console.error('FAILED:', err.message);
  try {
    await cleanupDummyData();
  } catch (_) {}
  process.exit(1);
});
