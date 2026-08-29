#!/usr/bin/env node
/**
 * Deborah — Cast Bundle Budget Report (C5-05 item 1/2/3/20)
 * --------------------------------------------------------
 * Cast critical HTML/CSS/JS compressed budgetni o'lchaydi:
 *   - Critical (initial lobby): cast-tokens.css, cast-core.css, cast-director.js,
 *     cast-participant.js, cast-join.css/js  → 250KB target
 *   - Background (lazy): cast-results, cast-replay, orb, poe, teams, card-scan,
 *     a11y, confidence, open-response css/js   → 300KB target
 * Policy: default WARN; `--ci` flag bilan exceed bo'lsa FAIL (exit 1).
 *
 * Usage: node scripts/cast-bundle-report.js [--ci] [--json]
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bundleBudgetReport, WARNING_KB } from '../services/cast/payload-service.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ci = process.argv.includes('--ci');
const json = process.argv.includes('--json');

const publicDir = join(root, 'public');

/** Critical assets — initial lobby uchun zarur (haqiqiy fayl nomlari). */
const CRITICAL = [
  'css/cast-tokens.css',
  'css/cast-director.css',
  'css/cast-participant.css',
  'css/cast-projector.css',
  'js/cast-socket-client.js',
  'js/cast-director.js',
  'js/cast-participant.js',
  'js/cast-projector.js',
  'js/cast-api.js',
];

/** Background assets — lazy load (haqiqiy fayl nomlari). */
const BACKGROUND = [
  'css/cast-results.css',
  'css/cast-replay.css',
  'css/cast-quality.css',
  'css/cast-studio.css',
  'js/cast-results.js',
  'js/cast-replay.js',
  'js/cast-a11y.js',
  'js/cast-card-scanner.js',
  'js/cast-choreography.js',
  'js/cast-quality.js',
  'js/cast-studio.js',
];

function assetBytes(rel) {
  const p = join(publicDir, rel);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p).length;
  } catch (_) {
    return null;
  }
}

const assets = [];
const missing = [];
for (const rel of CRITICAL) {
  const bytes = assetBytes(rel);
  if (bytes !== null) assets.push({ name: rel, bytes, kind: 'critical' });
  else missing.push({ name: rel, kind: 'critical' });
}
for (const rel of BACKGROUND) {
  const bytes = assetBytes(rel);
  if (bytes !== null) assets.push({ name: rel, bytes, kind: 'background' });
  else missing.push({ name: rel, kind: 'background' });
}

// Review fix: missing CRITICAL asset — budget hisobidan tashqarida qolib,
// report'ni yolg'ondan o'tkazmasligi uchun CI'da fail qilamiz.
// (Mavjud bo'lmagan fayl = bundle qisqargan emas, build yoki path buzilgan.)
const missingCritical = missing.filter((m) => m.kind === 'critical');

const report = bundleBudgetReport(assets, { failOnExceed: ci });

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('══════════════════════════════════════════════');
  console.log('   📦 Cast Bundle Budget Report (C5-05)');
  console.log('══════════════════════════════════════════════');
  for (const item of report.items) {
    const mark = item.bytes === 0 ? '⚠️ ' : '  ';
    console.log(` ${mark}${item.kind.padEnd(10)} ${String(item.kb).padStart(8)} KB  ${item.name}`);
  }
  console.log('──────────────────────────────────────────────');
  console.log(` Critical (lobby): ${report.totalCriticalKB} KB / ${report.criticalBudgetKB} KB  ${report.criticalExceeded ? '❌ EXCEEDED' : '✅ ok'}`);
  console.log(` Background:       ${report.totalBackgroundKB} KB / ${report.backgroundBudgetKB} KB  ${report.backgroundExceeded ? '❌ EXCEEDED' : '✅ ok'}`);
  console.log(` Policy: ${report.policy === 'fail' ? 'FAIL on exceed' : 'WARN on exceed'}`);
  console.log('══════════════════════════════════════════════');
}

if (missingCritical.length) {
  console.error(`\n❌ Missing CRITICAL cast assets: ${missingCritical.map((m) => m.name).join(', ')}`);
  console.error('   Bu budget hisobini bekor qiladi — fayllar mavjud bolishi kerak.');
  if (ci) process.exit(1);
  else process.exit(2);
}
if (ci && report.exceeded) {
  console.error(`\n❌ Cast bundle budget EXCEEDED (policy=fail). Critical: ${report.totalCriticalKB}KB/${report.criticalBudgetKB}KB, Background: ${report.totalBackgroundKB}KB/${report.backgroundBudgetKB}KB`);
  process.exit(1);
}
process.exit(0);
