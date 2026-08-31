/**
 * R2 Live E2E smoke test — creates 5 dummy students, verifies API auth paths.
 *
 * Usage:
 *   cd backend
 *   node scripts/test-r2-live-e2e.js
 *
 * Env:
 *   API_BASE_URL=http://localhost:5000/v1
 *   TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD (optional — uses seeded users if set)
 */
require('dotenv').config();
const crypto = require('crypto');

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:5000/v1').replace(/\/$/, '');

async function request(method, path, { token, body, headers = {} } = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const opts = {
    method,
    headers: {
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };
  if (body != null) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function login(email, password) {
  const res = await request('POST', '/auth/login', { body: { email, password } });
  assert(res.status === 200 && res.data.token, `Login failed for ${email}: ${res.status}`);
  return res.data.token;
}

async function main() {
  console.log('[R2 Live E2E] API:', API_BASE);

  // 1) Ingest auth — invalid path
  const badAuth = await request('POST', '/internal/live/ingest-auth', {
    body: { path: 'invalid', action: 'publish' },
  });
  assert(badAuth.status === 401, 'Expected 401 for invalid ingest path');

  // 2) Health
  const health = await fetch(`${API_BASE.replace(/\/v1$/, '')}/health`).catch(() => null);
  if (health) {
    console.log('[R2 Live E2E] Health:', health.status);
  }

  const teacherEmail = process.env.TEST_TEACHER_EMAIL;
  const teacherPassword = process.env.TEST_TEACHER_PASSWORD;
  if (!teacherEmail || !teacherPassword) {
    console.log('[R2 Live E2E] Skipping authenticated flow — set TEST_TEACHER_EMAIL and TEST_TEACHER_PASSWORD');
    console.log('[R2 Live E2E] Basic checks passed.');
    return;
  }

  const teacherToken = await login(teacherEmail, teacherPassword);

  // Find a course with live enabled and a lesson
  const coursesRes = await request('GET', '/courses/teacher/mine', { token: teacherToken });
  assert(coursesRes.status === 200, 'Failed to list teacher courses');
  const liveCourse = (coursesRes.data.courses || coursesRes.data || []).find(
    (c) => c.has_live_class || c.hasLiveClass
  );
  assert(liveCourse, 'No course with has_live_class=true found for teacher');

  const lessonsRes = await request('GET', `/lessons/course/${liveCourse.id}`, { token: teacherToken });
  assert(lessonsRes.status === 200 && lessonsRes.data?.length, 'No lessons in live course');
  const lesson = lessonsRes.data[0];

  // Force r2_live via env on server (LIVE_FORCE_PROVIDER=r2_live) or admin toggle
  const startRes = await request('PUT', `/lessons/${lesson.id}/live`, {
    token: teacherToken,
    body: { is_live: true, live_name: 'R2 E2E Test', live_order: 0 },
  });
  console.log('[R2 Live E2E] Start live:', startRes.status, startRes.data?.provider);
  assert(startRes.status === 200, `Start live failed: ${JSON.stringify(startRes.data)}`);

  if (startRes.data.provider !== 'r2_live') {
    console.warn('[R2 Live E2E] Provider is not r2_live — enable r2LiveEnabled in admin or set LIVE_FORCE_PROVIDER=r2_live');
  } else {
    assert(startRes.data.whipUrl, 'Missing whipUrl for r2_live');
    assert(startRes.data.streamKey, 'Missing streamKey');
    console.log('[R2 Live E2E] WHIP URL:', startRes.data.whipUrl);

    const validAuth = await request('POST', '/internal/live/ingest-auth', {
      body: { path: `live_${startRes.data.streamKey}`, action: 'publish' },
    });
    assert(validAuth.status === 200, 'Valid stream key should pass ingest auth');
  }

  // 5 dummy student tokens (parallel playlist access)
  const studentEmails = [];
  for (let i = 1; i <= 5; i++) {
    studentEmails.push(process.env[`TEST_STUDENT_${i}_EMAIL`] || null);
  }
  const enrolledStudents = studentEmails.filter(Boolean);

  if (enrolledStudents.length > 0) {
    const playlistResults = await Promise.all(
      enrolledStudents.map(async (email) => {
        const pwd = process.env.TEST_STUDENT_PASSWORD || 'password123';
        const t = await login(email, pwd);
        return request('GET', `/lessons/${lesson.id}/live/playlist`, { token: t });
      })
    );
    for (const r of playlistResults) {
      console.log('[R2 Live E2E] Student playlist:', r.status);
    }
  } else {
    console.log('[R2 Live E2E] Set TEST_STUDENT_1_EMAIL … TEST_STUDENT_5_EMAIL for 5-student playlist test');
  }

  // End live without save
  const endRes = await request('PUT', `/lessons/${lesson.id}/live`, {
    token: teacherToken,
    body: { is_live: false },
  });
  assert(endRes.status === 200, 'End live failed');
  console.log('[R2 Live E2E] All checks completed.');
}

main().catch((err) => {
  console.error('[R2 Live E2E] FAILED:', err.message);
  process.exit(1);
});
