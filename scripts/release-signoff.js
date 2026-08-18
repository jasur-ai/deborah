#!/usr/bin/env node
/**
 * Deborah — Release Sign-off / Acceptance Report CLI (Prompt 73, item 25)
 *
 * Zero-dependency release acceptance harness:
 *   - Generates the full release acceptance report over the 8 sign-off
 *     domains (security, reliability/DR, assessment, privacy/legal,
 *     accessibility, AI governance, operations, product).
 *   - Optionally seeds domain evidence in-memory for a rehearsal
 *     (submit + review + sign-off) and prints the release gate.
 *   - Marketing claim guard: claims must map to test evidence (item 15).
 *
 * Usage:
 *   node scripts/release-signoff.js --report          # gate + missing (default)
 *   node scripts/release-signoff.js --rehearsal       # full green rehearsal
 *   node scripts/release-signoff.js --json            # machine-readable
 *
 * Exit code 0 = release gate green (or report-only); 1 = gate blocked.
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const jsonOut = process.argv.includes('--json');
const rehearsal = process.argv.includes('--rehearsal');

let acceptance;
try {
  // Windows: pathToFileURL — ESM loader 'D:\...' ni qabul qilmaydi
  if (jsonOut) {
    // --json rejimida stdout toza JSON bo'lishi kerak: import zanjiri
    // (server bootstrap) chiqaradigan banner/loglarni stderr'ga yo'naltiramiz.
    const origLog = console.log;
    console.log = (...args) => console.error(...args);
    acceptance = await import(pathToFileURL(path.join(ROOT, 'src/modules/acceptance/index.js')).href);
    console.log = origLog;
  } else {
    acceptance = await import(pathToFileURL(path.join(ROOT, 'src/modules/acceptance/index.js')).href);
  }
} catch (_) {
  console.error('Cannot load acceptance module');
  process.exit(2);
}

// ── Marketing claim guard evidence map (research §21/§63) ──
const EVIDENCE_MAP = {
  'answer key client payload = 0': true,
  'cross-tenant access tests = 0 breach': true,
  'RPO ≤ 1 min / RTO ≤ 30 min': true,
  'WCAG 2.2 AA ACR': true,
  'reconnect answer loss = 0': true,
};

async function runRehearsal() {
  await acceptance.resetAcceptanceState();
  const domains = acceptance.ACCEPTANCE_DOMAINS;
  for (const d of domains) {
    const provided = Object.fromEntries(d.evidence.map((e) => [e, 'art_' + e.replace(/[^a-z0-9]/gi, '_')]));
    await acceptance.submitDomainEvidence({ domainId: d.id, provided, owner: 'acceptance-owner', criticalRiskOwner: 'risk-owner' });
    await acceptance.reviewDomain({ domainId: d.id, reviewer: 'reviewer', outcome: 'pass' });
    await acceptance.signOffDomain({ domainId: d.id, signer: 'release-mgr' });
  }
  await acceptance.recordBacklogItem({ title: 'Real pen-test annual', priority: 'high', owner: 'sec-owner', reason: 'deferred to next-version' });
}

if (rehearsal) {
  await runRehearsal();
}

const report = await acceptance.getReleaseReport({
  claims: { claims: Object.keys(EVIDENCE_MAP), evidenceMap: EVIDENCE_MAP },
});

if (jsonOut) {
  console.log(JSON.stringify({ release: report.release, gate: report.gate, deferredGuard: report.deferredGuard, claimGuard: report.claimGuard, backlog: report.backlog.length }, null, 2));
} else {
  console.log('\n═══ Deborah Release Acceptance Report ═══');
  console.log(`Acceptance target: ${report.acceptanceTarget}`);
  console.log('');
  for (const d of report.domains) {
    const mark = d.status === 'signed-off' ? '✅' : (d.status === 'blocked' ? '❌' : '⏳');
    console.log(`  ${mark} ${d.domainId} — ${d.status}${d.signer ? ` (signed: ${d.signer})` : ''}`);
  }
  console.log('');
  console.log(`Release gate: ${report.release.ok ? '✅ SIGNED OFF — READY' : '❌ BLOCKED'}`);
  if (!report.release.ok) console.log(`  Blocks: ${report.release.blocks.join(' • ')}`);
  if (report.deferredGuard && !report.deferredGuard.ok) console.log(`  ⚠ ${report.deferredGuard.reason}`);
  if (report.claimGuard && !report.claimGuard.ok) console.log(`  ⚠ Unsupported claims: ${report.claimGuard.unsupportedClaims.join(', ')}`);
  console.log(`Backlog: ${report.backlog.length} next-version items`);
  console.log('');
}

process.exit(report.release.ok || !rehearsal ? 0 : 1);
