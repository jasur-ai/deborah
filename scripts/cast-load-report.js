#!/usr/bin/env node
/**
 * Edikit — Cast Load Report (C5-09 items 16-19)
 * ----------------------------------------------
 * Load scenario natijalarini SLO (release threshold) bilan solishtiradi va
 * har tier uchun certification xulosasini chiqaradi.
 *
 * Usage:
 *   node scripts/cast-load-report.js --run <scenario> --base-url http://localhost:3457 \
 *     --session <sid> --join-code <code> --count 30 [--json]
 *
 *   --run        gradualJoin | answerBurst | reconnectStorm | soak | all
 *   --base-url   server URL
 *   --session    sessiya ID (oldindan yaratilgan)
 *   --join-code  join code
 *   --count      participant soni (tier shundan kelib chiqadi)
 *   --questions  savol soni (soak uchun)
 *   --json       machine-readable chiqish
 *
 * Exit code: 0 = barcha tanlangan SLO'lar o'tdi; 1 = birortasi o'tmadi.
 */

import { runGradualJoin, runAnswerBurst, runReconnectStorm, runSoak, TIER_ACK_SLO, TIER_RANGES } from '../load/cast-scenarios.js';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const jsonOut = process.argv.includes('--json');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SCENARIOS = ['gradualJoin', 'answerBurst', 'reconnectStorm', 'soak'];
const RUN = arg('--run', 'all');
const BASE_URL = arg('--base-url', 'http://localhost:3457');
const SESSION = arg('--session', null);
const JOIN_CODE = arg('--join-code', null);
const COOKIE = arg('--cookie', null);
const COUNT = parseInt(arg('--count', '30'), 10);
const QUESTIONS = parseInt(arg('--questions', '1'), 10);

if (!SESSION || !JOIN_CODE || !COOKIE) {
  console.error('Usage: --session <sid> --join-code <code> --cookie "<session cookie>" (director uchun kerak)');
  process.exit(2);
}

const tier = Object.keys(TIER_RANGES).find((t) => COUNT >= TIER_RANGES[t].min && COUNT <= TIER_RANGES[t].max) || 'S';

function evaluateSlo(scenario, t, res) {
  const threshold = (TIER_ACK_SLO[t] || TIER_ACK_SLO.S).p95;
  const s = res.summary || {};
  const p95 = s.latency ? s.latency.p95 : Infinity;
  const pass = res.ok === true && p95 <= threshold && (s.acceptedLoss || 0) === 0;
  return { pass, threshold, measuredP95: p95, acceptedLoss: s.acceptedLoss || 0 };
}

async function evaluate() {
  const results = [];
  const names = RUN === 'all' ? SCENARIOS : [RUN];
  if (!SCENARIOS.includes(names[0])) {
    console.error(`Unknown scenario: ${names[0]}`);
    process.exit(2);
  }

  for (const name of names) {
    const common = { baseUrl: BASE_URL, sessionId: SESSION, joinCode: JOIN_CODE, directorCookie: COOKIE, count: COUNT };
    const start = Date.now();
    let res;
    try {
      if (name === 'gradualJoin') res = await runGradualJoin({ ...common, questions: QUESTIONS });
      else if (name === 'answerBurst') res = await runAnswerBurst(common);
      else if (name === 'reconnectStorm') res = await runReconnectStorm(common);
      else if (name === 'soak') res = await runSoak({ ...common, questions: QUESTIONS });
      res.durationMs = Date.now() - start;
    } catch (err) {
      res = { ok: false, summary: { errorCount: 1, lost: 1, acceptedLoss: 1 }, breakdown: {}, scenarios: [name], error: err.message, durationMs: Date.now() - start };
    }
    res.slo = evaluateSlo(name, tier, res);
    results.push({ scenario: name, tier, ...res });
  }

  const allOk = results.every((r) => r.ok && r.slo.pass);
  const output = { runAt: new Date().toISOString(), tier, count: COUNT, results, allOk };

  if (jsonOut) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const r of results) {
      const s = r.summary || {};
      console.log(`\n[${r.scenario}] tier=${r.tier}`);
      console.log(`  duration: ${r.durationMs}ms`);
      console.log(`  commands: ${s.totalCommands ?? '-'} | ok: ${s.okCount ?? '-'} | lost: ${s.lost ?? '-'}`);
      console.log(`  acceptedAnswers: ${s.acceptedAnswers ?? '-'} / expected ${s.expectedAnswers ?? '-'} | acceptedLoss: ${s.acceptedLoss ?? '-'}`);
      if (s.latency) {
        console.log(`  ACK p50=${s.latency.p50}ms p95=${s.latency.p95}ms p99=${s.latency.p99}ms max=${s.latency.max}ms`);
      }
      console.log(`  SLO: ${r.slo.pass ? 'PASS' : 'FAIL'} (p95<=${r.slo.threshold}ms, acceptedLoss==0)`);
      if (r.error) console.log(`  error: ${r.error}`);
    }
    console.log(`\nRESULT: ${allOk ? 'ALL PASS' : 'FAILED'}`);
  }

  writeCertifiedSnapshot(output);
  process.exit(allOk ? 0 : 1);
}

/**
 * C5-09 item 19: har tier uchun certified config snapshot'ini saqlash.
 */
function writeCertifiedSnapshot(output) {
  const dir = path.join(ROOT, 'ops/capacity');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tier-${output.tier}.json`);
  const payload = {
    certifiedAt: output.runAt,
    tier: output.tier,
    concurrentParticipants: output.count,
    results: output.results.map((r) => ({
      scenario: r.scenario,
      ok: r.ok,
      sloPass: r.slo ? r.slo.pass : null,
      measuredP95: r.slo ? r.slo.measuredP95 : null,
      acceptedLoss: r.slo ? r.slo.acceptedLoss : null,
    })),
    certified: output.allOk,
  };
  writeFileSync(file, JSON.stringify(payload, null, 2));
  if (!jsonOut) console.log(`\nCertified snapshot: ${file}`);
}

evaluate();
