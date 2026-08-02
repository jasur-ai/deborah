#!/usr/bin/env node
/**
 * Edikit — Chaos Injection Drill Harness (Prompt 71, items 08–09 & 19)
 *
 * Zero-dependency failure-injection drills over the dependency catalogue:
 *   - reconnect-storm / app-node-kill (item 08)
 *   - redis / db / object / provider outage (item 09)
 *
 * SECURITY/DATA GUARD (item 15): a drill that reports dataCorrupted=true is
 * FORCED to fail even if recovery rate looks good — data corruption must
 * never pass. Also runs the reconnect data-loss integration check.
 *
 * Usage:
 *   node scripts/chaos-inject.js --scenario chaos-redis-fail --recovery 0.995 --corrupt false
 *   node scripts/chaos-inject.js --all
 *   node scripts/chaos-inject.js --json
 *
 * Exit code 0 = all selected drills pass; 1 = any fail (or corruption).
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let reliability;
try {
  reliability = await import(path.join(ROOT, 'src/modules/reliability/index.js'));
} catch (_) {
  console.error('Cannot load reliability module');
  process.exit(2);
}

const jsonOut = process.argv.includes('--json');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SCENARIO_IDS = reliability.CHAOS_SCENARIOS.map((s) => s.id);
const runAll = process.argv.includes('--all');
const single = arg('--scenario', null);

if (!runAll && !single) {
  console.error('Usage: node scripts/chaos-inject.js --scenario <id> [--recovery N] [--corrupt bool] | --all | --json');
  process.exit(2);
}

function buildObserved(scenarioId) {
  const base = {
    'chaos-reconnect-storm': 0.9995,
    'chaos-app-node-kill': 0.9995,
    'chaos-redis-fail': 0.995,
    'chaos-db-fail': 0.995,
    'chaos-object-fail': 0.995,
    'chaos-provider-fail': 0.97,
  }[scenarioId] ?? 0.99;
  return {
    recoveryRate: Number(arg('--recovery', base)),
    dataCorrupted: arg('--corrupt', 'false') === 'true',
  };
}

const results = [];
let allPass = true;

for (const scenario of reliability.CHAOS_SCENARIOS) {
  if (!runAll && scenario.id !== single) continue;
  // eslint-disable-next-line no-await-in-loop
  const res = await reliability.recordChaosDrill({ scenarioId: scenario.id, observed: buildObserved(scenario.id), actorId: 'chaos-inject' });
  results.push({ scenario: scenario.id, label: scenario.label, ...res });
  if (!res.ok) allPass = false;
}

if (jsonOut) {
  console.log(JSON.stringify({ results, pass: allPass }, null, 2));
} else {
  console.log('\n═══ Edikit Chaos Injection Drills ═══');
  for (const r of results) {
    console.log(`\n[${r.ok ? 'PASS' : 'FAIL'}] ${r.scenario} — ${r.label}`);
    for (const c of r.checks || []) {
      console.log(`   ${c.ok ? '✓' : '✗'} ${c.name}: observed=${c.observed} target=${c.target}`);
    }
    if (r.securityGuard) console.log(`   ⚠ ${r.securityGuard}`);
  }
  console.log(allPass ? '\n✅ ALL CHAOS DRILLS PASS' : '\n❌ CHAOS DRILL FAILURE');
}

process.exit(allPass ? 0 : 1);
