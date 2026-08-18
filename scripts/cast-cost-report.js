#!/usr/bin/env node
/**
 * Deborah — Cast Cost Report (C5-10)
 * ---------------------------------
 * Har certified tier uchun cost hisoblaydi va ops/capacity/cost-report.md
 * ga yozadi. Narxlar ops/capacity/cost-inputs.json dan o'qiladi (item 13).
 *
 * Usage:
 *   node scripts/cast-cost-report.js                # barcha tierlar (input fayldan)
 *   node scripts/cast-cost-report.js --tier XL      # faqat bitta tier
 *   node scripts/cast-cost-report.js --json         # machine-readable
 *   node scripts/cast-cost-report.js --actual '{"XL": 12.5}'  # actual cost reconciliation
 *
 * Exit code: 0 (har doim — hisobot yaratildi), 2 (xato).
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { computeCost, reconcileCost, isCostRegression, TIER_PEAK_CONNECTIONS } from '../services/cast/cost-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const jsonOut = process.argv.includes('--json');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

function loadInputs() {
  const file = path.join(ROOT, 'ops/capacity/cost-inputs.json');
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function main() {
  const inputs = loadInputs();
  const onlyTier = arg('--tier', null);
  const tiers = onlyTier ? [onlyTier.toUpperCase()] : Object.keys(inputs.tiers);

  const rows = tiers.map((tier) => {
    const tierCfg = inputs.tiers[tier] || {};
    const input = {
      tier,
      peakConnections: TIER_PEAK_CONNECTIONS[tier],
      durationMinutes: inputs.defaults.durationMinutes,
      nodeCount: tierCfg.nodeCount,
      nodeHourPrice: inputs.defaults.nodeHourPrice,
      egressPricePerGb: inputs.defaults.egressPricePerGb,
      storagePricePerGbMonth: inputs.defaults.storagePricePerGbMonth,
      observabilityPricePerGb: inputs.defaults.observabilityPricePerGb,
      supportHours: tierCfg.supportHours,
      supportHourlyCost: inputs.defaults.supportHourlyCost,
      realtimeRate: inputs.defaults.realtimeRate,
    };
    const cost = computeCost(input, inputs.traffic);
    return { tier, cost };
  });

  // Actual/projected reconciliation (item 11) — --actual JSON'dan
  let actuals = null;
  const actualRaw = arg('--actual', null);
  if (actualRaw) {
    try { actuals = JSON.parse(actualRaw); } catch (_) { /* ignore */ }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    regressionThresholdPct: 20,
    rows: rows.map(({ tier, cost }) => {
      const projected = cost.total;
      const actual = actuals && actuals[tier] != null ? actuals[tier] : null;
      const rec = actual != null ? reconcileCost(projected, actual) : null;
      return {
        tier,
        peakConnections: cost.traffic.peakConnections,
        totalAnswers: cost.traffic.totalAnswers,
        components: cost.components,
        projectedTotal: projected,
        actualTotal: actual,
        reconciliation: rec,
        regression: actual != null ? isCostRegression(projected, actual, 20) : null,
      };
    }),
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== Cast Cost Report (C5-10) ===');
    for (const r of report.rows) {
      const c = r.components;
      console.log(`\n[${r.tier}] peak=${r.peakConnections} conn, answers=${r.totalAnswers}`);
      console.log(`  compute=${c.compute.toFixed(4)} realtime=${c.realtime.toFixed(4)} network=${c.network.toFixed(4)}`);
      console.log(`  storage=${c.storage.toFixed(4)} observability=${c.observability.toFixed(4)} support=${c.support.toFixed(4)}`);
      console.log(`  projected total: ${r.projectedTotal.toFixed(4)}`);
      if (r.actualTotal != null && r.reconciliation) {
        console.log(`  actual: ${r.actualTotal.toFixed(4)} | delta: ${r.reconciliation.delta.toFixed(4)} (${r.reconciliation.deltaPct.toFixed(2)}%) ${r.reconciliation.verdict}`);
        console.log(`  regression(>20%): ${r.regression ? 'YES ⚠' : 'no'}`);
      }
    }
    console.log('\nInputlar: ops/capacity/cost-inputs.json');
  }

  // cost-report.md generatsiya (item 9)
  writeMarkdown(report, inputs);
}

function writeMarkdown(report, inputs) {
  const lines = [];
  lines.push('# Cast Cost Report (C5-10)\n');
  lines.push(`Generated: ${report.generatedAt}\n`);
  lines.push('Inputlar: `ops/capacity/cost-inputs.json` (narxlar shu faylda — kodda hardcode emas, item 13).\n');
  lines.push('| Tier | Peak conn | Answers | Compute | Realtime | Network | Storage | Observability | Support | Total |');
  lines.push('|------|-----------|---------|---------|----------|---------|---------|---------------|---------|-------|');
  for (const r of report.rows) {
    const c = r.components;
    lines.push(`| ${r.tier} | ${r.peakConnections} | ${r.totalAnswers} | ${c.compute.toFixed(2)} | ${c.realtime.toFixed(2)} | ${c.network.toFixed(2)} | ${c.storage.toFixed(2)} | ${c.observability.toFixed(2)} | ${c.support.toFixed(2)} | **${r.projectedTotal.toFixed(2)}** |`);
  }
  lines.push('');
  lines.push('> Note: default narxlar 0 — real provider narxlarini `cost-inputs.json` da kiriting.');
  const file = path.join(ROOT, 'ops/capacity/cost-report.md');
  writeFileSync(file, lines.join('\n'));
  if (!jsonOut) console.log(`\nReport: ${file}`);
}

main();
