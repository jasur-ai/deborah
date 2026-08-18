/**
 * Deborah — Lightweight Mutation Testing (AUTH D-33 §06/§24)
 * ---------------------------------------------------------------------------
 * stryker o'rnini bosuvchi yengil runner: kritik auth modullariga maqsadli
 * mutatsiyalar qo'llaydi (vaqtincha, git restore bilan qaytariladi), tegishli
 * test faylini yuguradi va "killed/total" % hisoblaydi.
 *
 * Mutatsiya KILLED = test FAIL (mutatsiya test tomonidan ushlandi).
 * Maqsad: kritik modullar uchun killed >= 80% (§06/§21).
 *
 * Foydalanish: node scripts/mutation-run.js
 * Chiqish: har mutatsiya uchun KILLED/SURVIVED + jami % (hujjatga yoziladi).
 */
import { execSync } from 'child_process';
import fs from 'fs';

const ROOT = process.cwd();

const MUTATIONS = [
  // password-policy.js (NIST parol siyosati — kritik)
  { file: 'src/modules/auth/password-policy.js', test: 'tests/unit/password-policy-a22.test.js',
    label: 'policy: MIN_LENGTH 15→5', from: 'export const POLICY_MIN_LENGTH = 15;', to: 'export const POLICY_MIN_LENGTH = 5;' },
  { file: 'src/modules/auth/password-policy.js', test: 'tests/unit/password-policy-a22.test.js',
    label: 'policy: MIN_LENGTH_MFA 8→3', from: 'export const POLICY_MIN_LENGTH_MFA = 8;', to: 'export const POLICY_MIN_LENGTH_MFA = 3;' },
  { file: 'src/modules/auth/password-policy.js', test: 'tests/unit/password-policy-a22.test.js',
    label: 'policy: MAX_LENGTH 128→20', from: 'export const POLICY_MAX_LENGTH = 128;', to: 'export const POLICY_MAX_LENGTH = 20;' },
  { file: 'src/modules/auth/password-policy.js', test: 'tests/unit/password-policy-a22.test.js',
    label: 'policy: min-check o\'chirilgan', from: 'if (len < min) {', to: 'if (false && len < min) {' },
  { file: 'src/modules/auth/password-policy.js', test: 'tests/unit/password-policy-a22.test.js',
    label: 'policy: requireStrong score 4→1', from: 'if (requireStrong && score < 4) {', to: 'if (requireStrong && score < 1) {' },

  // session-store.js (session TTL — kritik)
  { file: 'src/modules/auth/session-store.js', test: 'tests/unit/auth-session-store.test.js',
    label: 'session: TTL default 8h→1h', from: 'export const SESSION_TTL_DEFAULT_MS = 8 * 60 * 60 * 1000;', to: 'export const SESSION_TTL_DEFAULT_MS = 60 * 60 * 1000;' },
  { file: 'src/modules/auth/session-store.js', test: 'tests/unit/auth-session-store.test.js',
    label: 'session: TTL remember 30d→7d', from: 'export const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;', to: 'export const SESSION_TTL_REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;' },
  { file: 'src/modules/auth/session-store.js', test: 'tests/unit/auth-session-store.test.js',
    label: 'session: absolute timeout 12h→1h', from: 'export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;', to: 'export const SESSION_ABSOLUTE_TIMEOUT_MS = 60 * 60 * 1000;' },

  // mfa-totp.js (OTP — kritik)
  { file: 'src/modules/auth/mfa-totp.js', test: 'tests/unit/mfa-totp-a26.test.js',
    label: 'mfa: encryptSecret parol hash o\'zgardi', from: 'export function encryptSecret(plaintext) {', to: 'export function encryptSecret(plaintext) { return { v: "x" };' },

  // risk.js (risk score — kritik)
  { file: 'src/modules/auth/risk.js', test: 'tests/unit/risk-a28.test.js',
    label: 'risk: new_device weight 0.3→0', from: 'new_device: 0.3,', to: 'new_device: 0,' },
  { file: 'src/modules/auth/risk.js', test: 'tests/unit/risk-a28.test.js',
    label: 'risk: trusted discount 0.4→0', from: 'trusted_device: -0.4,', to: 'trusted_device: 0,' },
];

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
}

// Mutatsiya qo'llashdan oldin backup saqlaymiz (git emas — fayllar untracked
// bo'lishi mumkin, git checkout ishonchli emas). Har bir mutatsiyadan keyin
// aynan shu backup qaytariladi.
const backups = new Map();

function backup(file) {
  if (!backups.has(file)) backups.set(file, fs.readFileSync(`${ROOT}/${file}`, 'utf8'));
}

function apply(file, from, to) {
  backup(file);
  const content = backups.get(file);
  if (!content.includes(from)) return false;
  fs.writeFileSync(`${ROOT}/${file}`, content.replace(from, to));
  return true;
}

function restore(file) {
  if (backups.has(file)) fs.writeFileSync(`${ROOT}/${file}`, backups.get(file));
}

const results = [];
let killed = 0;
let total = 0;

for (const m of MUTATIONS) {
  const applied = apply(m.file, m.from, m.to);
  if (!applied) {
    results.push({ ...m, status: 'SKIP (pattern topilmadi)' });
    continue;
  }
  total += 1;
  let testFailed = false;
  let out = '';
  try {
    out = run(`node node_modules/vitest/vitest.mjs run ${m.test} 2>&1`);
  } catch (err) {
    testFailed = true; // test FAIL → mutatsiya KILLED
    out = String(err.stdout || '');
  }
  restore(m.file);
  const killedStatus = testFailed;
  if (killedStatus) killed += 1;
  const passCount = (out.match(/Tests\s+\d+ passed/) || [])[0] || '';
  results.push({ ...m, status: killedStatus ? 'KILLED ✅' : `SURVIVED ❌ (${passCount})` });
  console.log(`[mutation] ${killedStatus ? 'KILLED  ' : 'SURVIVED'} ${m.label}`);
}

const pct = total ? Math.round((killed / total) * 1000) / 10 : 0;
console.log(`\n[mutation] RESULT: ${killed}/${total} killed (${pct}%) — maqsad >= 80%`);
if (pct < 80) {
  console.error('[mutation] STOP CONDITION (§21): mutation <80% — tuzatish kerak');
  process.exit(1);
}
console.log('[mutation] PASS ✓');
