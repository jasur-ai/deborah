#!/usr/bin/env node

/**
 * Deborah — Legacy JSON/Firebase Migration Dry-Run Script
 *
 * Reads data/db.json, analyzes all legacy records, and generates
 * a structured migration report without writing to any database.
 *
 * Usage:
 *   node scripts/migrate-legacy-dry-run.js
 *   node scripts/migrate-legacy-dry-run.js --json   (JSON output)
 *   node scripts/migrate-legacy-dry-run.js --quiet  (summary only)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const quietMode = args.includes('--quiet');

  // ── Read legacy data ──
  const dbPath = resolve(__dirname, '..', 'data', 'db.json');

  if (!existsSync(dbPath)) {
    console.error('❌ data/db.json not found. Run the server first to generate seed data.');
    process.exit(1);
  }

  let legacyData;
  let raw;
  try {
    raw = readFileSync(dbPath, 'utf-8');
    legacyData = JSON.parse(raw);
  } catch (err) {
    console.error('❌ Failed to parse data/db.json:', err.message);
    process.exit(1);
  }

  const fileSize = Math.round(raw.length / 1024);

  // ── Analyze ──
  const { analyzeLegacyData, generateDryRunReport, computeDataHash } =
    await import('../src/modules/legacy-migration/index.js');

  const analysis = analyzeLegacyData(legacyData);
  const hash = computeDataHash(legacyData);

  // ── Add file metadata ──
  analysis.file_info = {
    path: 'data/db.json',
    size_kb: fileSize,
    top_level_keys: Object.keys(legacyData).length,
    sections: Object.keys(legacyData),
  };
  analysis.hash = hash;

  // ── Output ──
  if (jsonMode) {
    console.log(JSON.stringify(analysis, null, 2));
  } else if (quietMode) {
    const s = analysis.summary;
    console.log(`Legacy Migration Dry-Run: ${s.total_users} users, ${s.total_tests} tests, ${s.total_mock_fans} mock fans, ${s.total_pre_groups} PRE groups, ${s.total_results} results — ${s.total_warnings} warnings`);
    if (s.total_warnings > 0) {
      console.log(`  ⚠️  Warnings: ${s.total_warnings}`);
      analysis.warnings.slice(0, 5).forEach(w => console.log(`     ${w}`));
    }
    console.log(`  Hash: ${hash ? hash.substring(0, 16) : 'N/A'}`);
  } else {
    console.log(generateDryRunReport(analysis));
  }

  // ── Exit with status ──
  if (analysis.summary.total_items_mapped === 0 && analysis.summary.total_users === 0) {
    console.error('\n❌ DRY-RUN: Nothing to migrate!');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
