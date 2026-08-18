#!/usr/bin/env node
/**
 * Deborah — Cast Certification Verifier (C5-12)
 * ----------------------------------------------
 * F-tier (F4/F5/F6) uchun load certification'ni tekshiradi:
 *   1. F-tier → load-tier mapping (F4→L, F5→XL, F6→XXL)
 *   2. `ops/capacity/tier-<T>.json` snapshot'ida `certified: true` va
 *      accepted-loss 0 (barcha scenario'lar)
 *   3. Snapshot yoshi 30 kundan oshmagan — eskirgan sertifikat invalid
 *
 * Usage:
 *   node scripts/cast-certification.js --tier F4
 *   node scripts/cast-certification.js --tier F5 --snapshot ops/capacity/tier-XL.json
 *   node scripts/cast-certification.js --tier F6
 *   node scripts/cast-certification.js --all          # barcha F4/F5/F6
 *   node scripts/cast-certification.js --json
 *
 * Exit code: 0 = barcha tekshirilgan sertifikatlar valid; 1 = birortasi invalid.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { TIER_RANGES, TIER_ACK_SLO } from '../load/cast-scenarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAP_DIR = path.join(ROOT, 'ops/capacity');

// ── F-tier → load-tier mapping ──
// Load tier chegaralari va ACK SLO'lar `load/cast-scenarios.js`'dagi
// TIER_RANGES / TIER_ACK_SLO dan olinadi — duplikatsiya yo'q, drift xavfi yo'q.
const F_TIER_MAP = {
  F4: { loadTier: 'L', count: 400 },
  F5: { loadTier: 'XL', count: 1000 },
  F6: { loadTier: 'XXL', count: 10000 },
};

// Har F-tier uchun ACK p95 SLO — load-tier SLO'sidan (TIER_ACK_SLO) olinadi
function ackP95SloFor(loadTier) {
  return TIER_ACK_SLO[loadTier]?.p95 ?? null;
}

const MAX_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 kun

const jsonOut = process.argv.includes('--json');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

function defaultSnapshotPath(loadTier) {
  return path.join(CAP_DIR, `tier-${loadTier}.json`);
}

/**
 * Bitta F-tier sertifikatini tekshiradi.
 * @returns {{ tier:string, loadTier:string, ok:boolean, reasons:string[], snapshot:object|null }}
 */
function verifyTier(fTier, snapshotPathOverride = null) {
  const map = F_TIER_MAP[fTier];
  if (!map) {
    return { tier: fTier, loadTier: null, ok: false, reasons: [`unknown-f-tier:${fTier}`], snapshot: null };
  }
  const p95Slo = ackP95SloFor(map.loadTier);
  const snapshotPath = snapshotPathOverride || defaultSnapshotPath(map.loadTier);
  const reasons = [];

  if (!existsSync(snapshotPath)) {
    return { tier: fTier, loadTier: map.loadTier, ok: false, reasons: [`no-snapshot:${path.basename(snapshotPath)}`], snapshot: null };
  }

  let snap;
  try {
    snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch (err) {
    return { tier: fTier, loadTier: map.loadTier, ok: false, reasons: [`snapshot-parse-error:${err.message}`], snapshot: null };
  }

  // 1. certified flag
  if (snap.certified !== true) reasons.push(`not-certified:${snap.certified}`);

  // 2. accepted-loss 0 — barcha scenario'lar
  const results = Array.isArray(snap.results) ? snap.results : [];
  if (results.length === 0) {
    reasons.push('no-results');
  } else {
    for (const r of results) {
      if (r.sloPass !== true) reasons.push(`scenario-fail:${r.scenario || '?'}`);
      if (r.acceptedLoss !== undefined && r.acceptedLoss !== 0) {
        reasons.push(`accepted-loss:${r.scenario || '?'}=${r.acceptedLoss}`);
      }
      if (r.measuredP95 !== undefined && r.measuredP95 !== null && p95Slo !== null && r.measuredP95 > p95Slo) {
        reasons.push(`p95-over:${r.scenario || '?'}=${r.measuredP95}ms>${p95Slo}ms`);
      }
    }
  }

  // 3. Snapshot yoshi (30 kun)
  const certifiedAt = new Date(snap.certifiedAt || snap.runAt || 0).getTime();
  if (!certifiedAt) {
    reasons.push('no-certifiedAt');
  } else if (Date.now() - certifiedAt > MAX_SNAPSHOT_AGE_MS) {
    const days = Math.round((Date.now() - certifiedAt) / (24 * 60 * 60 * 1000));
    reasons.push(`stale:${days}days>30`);
  }

  return { tier: fTier, loadTier: map.loadTier, ok: reasons.length === 0, reasons, snapshot: snap };
}

// ── CLI ──
const ALL = process.argv.includes('--all');
const tierArg = arg('--tier', null);
const snapshotOverride = arg('--snapshot', null);

let tiers;
if (ALL) tiers = Object.keys(F_TIER_MAP);
else if (tierArg) tiers = [tierArg.toUpperCase()];
else {
  console.error('Usage: --tier F4|F5|F6 | --all  [--snapshot path] [--json]');
  process.exit(2);
}

const results = tiers.map((t) => verifyTier(t, snapshotOverride || null));
const allOk = results.every((r) => r.ok);

if (jsonOut) {
  console.log(JSON.stringify({ runAt: new Date().toISOString(), results, allOk }, null, 2));
} else {
  for (const r of results) {
    const status = r.ok ? '✅ VALID' : '❌ INVALID';
    console.log(`\n[${r.tier} → ${r.loadTier || '?'}] ${status}`);
    if (r.snapshot) {
      console.log(`  certifiedAt: ${r.snapshot.certifiedAt}`);
      console.log(`  participants: ${r.snapshot.concurrentParticipants}`);
      const res = r.snapshot.results || [];
      for (const s of res) {
        console.log(`  ${s.scenario}: p95=${s.measuredP95 ?? '-'}ms loss=${s.acceptedLoss ?? '-'} SLO=${s.sloPass ? 'PASS' : 'FAIL'}`);
      }
    }
    if (r.reasons.length) console.log(`  reasons: ${r.reasons.join('; ')}`);
  }
  console.log(`\nRESULT: ${allOk ? 'ALL CERTIFIED ✅' : 'CERTIFICATION INVALID ❌'}`);
}

// Manually marked F-tier report uchun helper — agar --snapshot valid bo'lsa
// cert-<F>.md signed report shablonini yaratish (opsiyalik).
// Review fix: --all bo'lsa HAMMA valid tier uchun alohida report yoziladi.
if (allOk && !jsonOut && process.argv.includes('--write-report')) {
  mkdirSync(CAP_DIR, { recursive: true });
  for (const r of results) {
    if (!r.ok || !r.snapshot) continue;
    const file = path.join(CAP_DIR, `cert-${r.tier}.md`);
    const rows = (r.snapshot.results || [])
      .map((s) => `| ${s.scenario} | ${s.measuredP95 ?? '-'} | ${s.acceptedLoss ?? '-'} | - | ${s.sloPass ? '✅' : '❌'} |`)
      .join('\n');
    writeFileSync(
      file,
      `# Cast Certification — ${r.tier}\n\n- **Tier:** ${r.tier} (${F_TIER_MAP[r.tier].count} concurrent)\n- **Load tier:** ${r.loadTier}\n- **Date:** ${new Date().toISOString().slice(0, 10)}\n- **Certified by:** <name>\n- **Snapshot:** ops/capacity/tier-${r.loadTier}.json\n\n| Scenario | ACK p95 (ms) | acceptedLoss | Recovery (s) | SLO |\n|----------|-------------|--------------|--------------|-----|\n${rows}\n\n- **Certified:** ✅\n- **Imzo:** <signed>\n`,
      'utf8'
    );
    console.log(`\nSigned report draft: ${file}`);
  }
}

process.exit(allOk ? 0 : 1);
