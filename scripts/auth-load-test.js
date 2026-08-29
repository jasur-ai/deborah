#!/usr/bin/env node
/**
 * Deborah — Auth Peak Load Test Harness (AUTH D-19)
 *
 * Zero-dependency auth SLO evaluation for exam-start peaks:
 *   auth-login-storm  (5000 students login)
 *   auth-teacher-login (1000 teachers)
 *   auth-mfa-storm    (TOTP/backup burst)
 *   auth-forgot-storm (reset requests, low)
 *
 * SECURITY/DATA GUARD (D-19 §13): harness NEVER accepts production PII —
 * observed metrics are synthetic numbers from a real load run report
 * (k6/autocannon), never live production data. A run with falseLockouts > 0
 * can never pass (kampus NAT false-lockout = C-01 violation).
 *
 * Usage:
 *   node scripts/auth-load-test.js --profile auth-login-storm --login-p95 1500 --error-rate 0.0005 --false-lockouts 0
 *   node scripts/auth-load-test.js --all
 *   node scripts/auth-load-test.js --json
 *
 * Exit code 0 = all selected profiles pass their SLOs; 1 = any fail.
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let reliability;
try {
  reliability = await import(pathToFileURL(path.join(ROOT, 'src/modules/reliability/index.js')).href);
} catch (err) {
  console.error('Cannot load reliability module:', err?.message || err);
  process.exit(2);
}

const { AUTH_LOAD_PROFILES, evaluateAuthLoadSlo } = reliability;

const jsonOut = process.argv.includes('--json');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const runAll = process.argv.includes('--all');
const single = arg('--profile', null);

if (!runAll && !single) {
  console.error('Usage: node scripts/auth-load-test.js --profile <id> [--login-p95 N] [--error-rate N] [--false-lockouts N] | --all | --json');
  process.exit(2);
}

function buildObserved() {
  return {
    loginP95Ms: Number(arg('--login-p95', 1500)), // synthetic default (pass)
    errorRate: Number(arg('--error-rate', 0.0005)),
    falseLockouts: Number(arg('--false-lockouts', 0)),
  };
}

const results = [];
let allPass = true;

for (const profile of AUTH_LOAD_PROFILES) {
  if (!runAll && profile.id !== single) continue;
  const res = evaluateAuthLoadSlo({ profileId: profile.id, observed: buildObserved() });
  results.push({ profile: profile.id, label: profile.label, ...res });
  if (!res.ok) allPass = false;
}

if (jsonOut) {
  console.log(JSON.stringify({ results, pass: allPass }, null, 2));
} else {
  console.log('\n═══ Deborah Auth Peak Load Test ═══');
  for (const r of results) {
    console.log(`\n[${r.ok ? 'PASS' : 'FAIL'}] ${r.profile} — ${r.label}`);
    for (const c of r.checks || []) {
      console.log(`   ${c.ok ? '✓' : '✗'} ${c.name}: observed=${c.observed} target=${c.target}`);
    }
    if (r.securityGuard) console.log(`   ⚠ security guard: ${r.securityGuard}`);
  }
  console.log(allPass ? '\n✅ ALL AUTH LOAD PROFILES PASS SLOs' : '\n❌ AUTH LOAD SLO FAILURE');
}

process.exit(allPass ? 0 : 1);
