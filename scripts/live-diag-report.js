#!/usr/bin/env node
/**
 * Print R2 live diagnostics report (same data as GET /v1/internal/live/diag).
 *
 * Usage:
 *   node scripts/live-diag-report.js
 *   node scripts/live-diag-report.js --lesson <id> --session <id>
 *   node scripts/live-diag-report.js --tail 20
 */
require('dotenv').config();
const path = require('path');
const liveDiag = require('../src/services/liveDiagnosticsService');

const args = process.argv.slice(2);
let lessonId = null;
let sessionId = null;
let tail = 0;

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--lesson' && args[i + 1]) lessonId = args[++i];
  else if (args[i] === '--session' && args[i + 1]) sessionId = args[++i];
  else if (args[i] === '--tail' && args[i + 1]) tail = parseInt(args[++i], 10) || 0;
}

const report = lessonId || sessionId
  ? liveDiag.getSessionReport(lessonId, sessionId)
  : liveDiag.getGlobalReport();

console.log('\n=== R2 Live Diagnostics Report ===\n');
console.log('Updated:', report.updatedAt || 'never');
console.log('Log file:', liveDiag.JSONL);
console.log('\n--- Issue checklist ---');
console.log(JSON.stringify(report.issueChecklist, null, 2));

if (report.summary) {
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(report.summary, null, 2));
}

if (report.sessions?.length) {
  console.log('\n--- Active sessions ---');
  for (const s of report.sessions) {
    console.log(`  ${s.sessionId?.slice(0, 8) || '?'} lesson=${s.lessonId?.slice(0, 8) || '?'} role=${s.role || '-'} last=${s.lastType || '-'} events=${s.eventCount}`);
  }
}

const events = tail > 0
  ? (report.recentEvents || report.session?.timeline || []).slice(-tail)
  : (report.recentEvents || report.session?.timeline || []).slice(-15);

if (events.length) {
  console.log('\n--- Recent events ---');
  for (const e of events) {
    const tag = e.type || 'event';
    const sid = e.sessionId ? e.sessionId.slice(0, 8) : '';
    const msg = e.message || '';
    const extra = e.data ? ` ${JSON.stringify(e.data).slice(0, 120)}` : '';
    console.log(`  ${e.ts} [${tag}]${sid ? ` ${sid}` : ''} ${msg}${extra}`);
  }
}

console.log('\n');
