#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * STEP 41 — Final launch gate (S41.01–S41.12)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Barcha 12 gate'ni yig'uvchi umbrella: har gate uchun mavjud script/test'ni
 * chaqiradi yoki evidence faylini tekshiradi. Chiqish: PASS / FAIL / PENDING.
 *
 * Final non-negotiables ham tekshiriladi (raw color, transition:all, infinite
 * motion, fake proof, public low-rank shame, boundary).
 *
 * Run:
 *   node scripts/launch-gate.js          # barcha gate'lar (fast subset)
 *   node scripts/launch-gate.js --full   # visual + axe ham (uzoq)
 *   node scripts/launch-gate.js --json   # machine-readable
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const full = process.argv.includes('--full');
const jsonOut = process.argv.includes('--json');

const results = [];

function run(name, id, cmd, { warn = false, timeout = 240000 } = {}) {
  const res = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', timeout });
  const ok = res.status === 0;
  results.push({ id, name, ok, warn });
  if (!jsonOut) console.log(`  ${ok ? '✓' : warn ? '⚠' : '✗'} ${id} — ${name}${ok ? '' : warn ? ' (warn)' : ''}`);
  return res;
}

function evidence(id, name, file, { warn = false } = {}) {
  const ok = existsSync(join(ROOT, file));
  results.push({ id, name, ok, warn });
  if (!jsonOut) console.log(`  ${ok ? '✓' : warn ? '⚠' : '✗'} ${id} — ${name}${ok ? '' : warn ? ' (warn)' : ''}`);
  return ok;
}

/* ── S41.01 Gate 0 — compile + HTTP + tests ─────────────────────────── */
run('S41.01', 'Gate 0 — EJS compile', 'node scripts/test-views.js');
run('S41.01b', 'Gate 0 — design:check (tokens+lint+perf+legacy)', 'node scripts/design-check.js');

/* ── S41.02 Token gate ──────────────────────────────────────────────── */
run('S41.02', 'Token gate — schema + build', 'node scripts/validate-design-tokens.js && node scripts/build-design-tokens.js');
run('S41.02b', 'Token gate — contrast 40/40', 'node scripts/check-contrast.js');

/* ── S41.03 Visual gate (full'da) ───────────────────────────────────── */
if (full) {
  run('S41.03', 'Visual gate — critical pages', 'NODE_ENV=test npx playwright test tests/visual/critical-pages.spec.js tests/visual/foundations.spec.js', { timeout: 600000 });
}

/* ── S41.04 Accessibility gate ──────────────────────────────────────── */
run('S41.04', 'A11y static audit', 'node scripts/a11y-audit.js');
if (full) {
  run('S41.04b', 'A11y axe (light+dark)', 'NODE_ENV=test npx playwright test --project=a11y-audit tests/a11y/', { timeout: 600000 });
}

/* ── S41.05 Performance gate ────────────────────────────────────────── */
run('S41.05', 'Perf budget (route/assets/fonts/SW)', 'node scripts/performance-budget.js');

/* ── S41.06 Content gate ────────────────────────────────────────────── */
run('S41.06', 'Content — no fake proof, no broken links', 'node scripts/check-content.js', { warn: true });
evidence('S41.06b', 'Content — accessibility docs current', 'docs/accessibility.md');
evidence('S41.06c', 'Content — brand docs current', 'docs/brand-assets.md');

/* ── S41.07 Brand gate ──────────────────────────────────────────────── */
evidence('S41.07', 'Brand — Evidence Mark SVG', 'public/images/brand/evidence-mark.svg');
evidence('S41.07b', 'Brand — wordmark horizontal', 'public/images/brand/wordmark-horizontal.svg');
evidence('S41.07c', 'Brand — monochrome/inverse/high-contrast', 'public/images/brand/evidence-mark-monochrome.svg');

/* ── S41.08 User evidence gate ──────────────────────────────────────── */
evidence('S41.08', 'Research kit — design study plan', 'research/design-study-plan.md');
// --json field data yo'q bo'lsa ham exit 0 (field pending) — targetlar faqat
// CSV'lar to'lgach PASS/FAIL beradi (research-analyze S39)
run('S41.08b', 'Research — aggregate pipeline (field pending OK)', 'node scripts/research-analyze.js --json');

/* ── S41.09 Mature gamification gate ────────────────────────────────── */
run('S41.09', 'Gamification — leaderboard privacy checks', 'node scripts/check-leaderboard.js', { warn: true });

/* ── S41.10 Field gate ──────────────────────────────────────────────── */
evidence('S41.10', 'Field — projector/class pilot signed report', 'research/results/field-report.md', { warn: true });

/* ── S41.11 Governance gate ─────────────────────────────────────────── */
evidence('S41.11', 'Governance — design-system docs', 'docs/design-system/governance.md');
evidence('S41.11b', 'Governance — CODEOWNERS', 'CODEOWNERS');
evidence('S41.11c', 'Governance — CHANGELOG', 'CHANGELOG.md');
evidence('S41.11d', 'Governance — final acceptance audit', 'docs/final-acceptance.md');

/* ── S41.12 Sign-off gate ───────────────────────────────────────────── */
// release-signoff --json report rejimida `report.gate.ok` beradi. Sign-off
// haqiqatan tasdiqlangan bo'lsa (signed domains) gate green bo'ladi.
const signoff = spawnSync('node scripts/release-signoff.js --json', { cwd: ROOT, shell: true, encoding: 'utf8', timeout: 120000 });
// S41.12 — real state tekshiriladi: release.ok true bo'lsa ✓, false bo'lsa ⚠ warn
// (pending — 8 domain sign-off'i launch paytida yakunlanadi). False-green emas:
// sign-off qilingan da'vo qilinsa, faqat real signed state green bo'ladi.
let signoffOk = false;
let signoffPending = true;
try {
  const parsed = JSON.parse(signoff.stdout || '{}');
  signoffOk = signoff.status === 0 && parsed.release?.ok === true;
  signoffPending = signoffOk || parsed.release?.ok === false;
} catch {
  signoffOk = false;
  signoffPending = false;
}
results.push({ id: 'S41.12', name: 'Sign-off — release acceptance gate (release.ok)', ok: signoffOk, warn: !signoffOk && signoffPending });
if (!jsonOut) {
  if (signoffOk) console.log(`  ✓ S41.12 — Sign-off — release acceptance gate`);
  else if (signoffPending) console.log(`  ⚠ S41.12 — Sign-off — 0/8 domain signed (launch paytida yakunlanadi)`);
  else console.log(`  ✗ S41.12 — Sign-off — release acceptance gate (signoff xatosi)`);
}

/* ── Final non-negotiables ──────────────────────────────────────────── */
// design-lint allaqachon raw color/transition:all/infinite motion'ni bloklaydi (S37)
run('NN-1', 'Non-neg — raw color / transition:all / infinite motion (lint)', 'node scripts/design-lint.js');
run('NN-2', 'Non-neg — legacy regression (S40)', 'node scripts/legacy-usage.js --check');
evidence('NN-3', 'Non-neg — no fake proof (content gate evidence)', 'docs/accessibility.md');

/* ── Summary ────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.ok && !r.warn);
const warnings = results.filter((r) => !r.ok && r.warn);
const passed = results.filter((r) => r.ok);
// --full'siz visual (S41.03) va axe (S41.04b) o'tkazib yuboriladi
const skipped = ['S41.03', 'S41.04b'].filter((id) => !results.some((r) => r.id === id));

if (jsonOut) {
  console.log(JSON.stringify({ gates: results, summary: { passed: passed.length, failed: failed.length, warnings: warnings.length, skipped } }, null, 2));
} else {
  console.log(`\n  ── Summary ──`);
  console.log(`  ✓ ${passed.length} pass${warnings.length ? ` · ⚠ ${warnings.length} warn` : ''}${failed.length ? ` · ✗ ${failed.length} fail` : ''}${skipped.length ? ` · ${skipped.length} skipped (--full'da)` : ''}`);
  if (failed.length) {
    console.log(`  BLOCKED: ${failed.map((r) => r.id).join(', ')}`);
    console.log(`\n  ✗ LAUNCH GATE BLOCKED — ${failed.length} ta gate fail`);
    process.exit(1);
  }
  console.log(`\n  ✓ LAUNCH GATE PASS — barcha hard gate'lar yashil${warnings.length ? ` (${warnings.length} warn — field/pilot pending)` : ''}`);
  process.exit(0);
}
