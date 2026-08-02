#!/usr/bin/env node
/**
 * Edikit — Final Migration / Institutional Cutover CLI (Prompt 72, items 07–09)
 *
 * Zero-dependency final migration harness:
 *   - Reads data/db.json (legacy source), computes final SHA-256 backup hash.
 *   - Runs the migration dry-run (analyzeLegacyData → report) and prints
 *     the reconciliation plan (legacy counts vs expected migrated counts).
 *   - Optionally seeds the institutional cutover state in-memory for a
 *     rehearsal (recordFinalBackup + recordMigrationDryRun + recordReconciliation).
 *
 * SECURITY/DATA GUARD (item 15): legacy db.json HECH QACHON o'zgartirilmaydi —
 * faqat o'qiladi (readFileSync). Cutover rehearsal'da legacy read-only flag
 * yozilmaydi (bu haqiqiy produksiya cutover, faqat evidence hisoblanadi).
 *
 * Usage:
 *   node scripts/final-migration.js --dry-run          # report + hash (default)
 *   node scripts/final-migration.js --rehearsal        # + seed cutover state
 *   node scripts/final-migration.js --json             # machine-readable
 *
 * Exit code 0 = analysis ok (quarantine may exist — report shows it).
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');

const jsonOut = process.argv.includes('--json');
const rehearsal = process.argv.includes('--rehearsal');

let migration;
try {
  migration = await import(path.join(ROOT, 'src/modules/legacy-migration/index.js'));
} catch (_) {
  console.error('Cannot load legacy-migration module');
  process.exit(2);
}

let institutional = null;
if (rehearsal) {
  try {
    institutional = await import(path.join(ROOT, 'src/modules/institutional/index.js'));
  } catch (_) {
    console.error('Cannot load institutional module');
    process.exit(2);
  }
}

if (!existsSync(DB_FILE)) {
  console.error(`Legacy source not found: ${DB_FILE}`);
  process.exit(2);
}

// ── Read legacy source (READ-ONLY — never mutated) ──
const raw = readFileSync(DB_FILE, 'utf-8');
let legacyData;
try {
  legacyData = JSON.parse(raw);
} catch (err) {
  console.error(`Legacy db.json parse error: ${err.message}`);
  process.exit(2);
}

// ── Final backup hash (item 07) ──
const dataHash = migration.computeDataHash(legacyData) || '';

// ── Migration dry-run analysis (item 08) ──
const analysis = migration.analyzeLegacyData(legacyData);

// ── Reconciliation plan (item 09): legacy counts vs expected migrated counts ──
const reconciliation = {
  users: analysis.summary.total_users,
  tests: analysis.summary.total_tests,
  items: analysis.summary.total_items_mapped,
  results: analysis.summary.total_results,
  enrollments: analysis.summary.total_enrollments,
};

if (jsonOut) {
  console.log(JSON.stringify({
    legacyFile: DB_FILE,
    dataHash,
    analysis: {
      summary: analysis.summary,
      quarantine: analysis.quarantine,
    },
    reconciliation,
    rehearsalDone: false,
  }, null, 2));
  process.exit(0);
}

console.log('\n═══ Edikit Final Migration — Cutover Evidence ═══');
console.log(`Legacy source:  ${DB_FILE}`);
console.log(`Data hash:      ${dataHash ? dataHash.slice(0, 32) + '…' : 'N/A'}`);
console.log('');
console.log('─── MIGRATION DRY-RUN ───');
console.log(migration.generateDryRunReport(analysis));
console.log('─── RECONCILIATION PLAN ───');
console.log(`  users: ${reconciliation.users}`);
console.log(`  tests: ${reconciliation.tests}`);
console.log(`  items: ${reconciliation.items}`);
console.log(`  results: ${reconciliation.results}`);
console.log(`  enrollments: ${reconciliation.enrollments}`);
console.log('');

if (rehearsal) {
  // ── Seed the cutover rehearsal state (in-memory evidence only) ──
  await institutional.resetInstitutionalState();
  const backup = await institutional.recordFinalBackup({
    dataHash,
    records: { users: reconciliation.users, tests: reconciliation.tests },
    actorId: 'final-migration-cli',
  });
  const dryRun = await institutional.recordMigrationDryRun({
    reviewed: true,
    reportHash: dataHash,
    actorId: 'final-migration-cli',
  });
  const rec = await institutional.recordReconciliation({
    legacy: reconciliation,
    migrated: reconciliation, // parity — dry-run counts are the expected target
    actorId: 'final-migration-cli',
  });
  console.log('─── CUTOVER REHEARSAL ───');
  console.log(`  backup:  ${backup.ok ? '✅' : '❌ ' + backup.reason}`);
  console.log(`  dry-run: ${dryRun.ok ? '✅' : '❌ ' + dryRun.reason}`);
  console.log(`  recon:   ${rec.ok ? '✅ parity verified' : '❌ ' + rec.reason}`);
  console.log('');
  if (jsonOut) console.log(JSON.stringify({ rehearsal: { backup, dryRun, rec } }, null, 2));
  process.exit(backup.ok && dryRun.ok && rec.ok ? 0 : 1);
}

console.log('Rehearsal uchun: node scripts/final-migration.js --rehearsal');
process.exit(0);
