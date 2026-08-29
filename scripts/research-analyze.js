#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * STEP 39 — Research analysis: validated instrument'larni hisoblaydi va
 * targets bilan solishtiradi (S39.03–S39.12).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CSV'lar `research/results/raw/` da — formatlar `research/instruments/*.md`.
 * Chiqish: JSON (aggregate) + har target bo'yicha PASS/FAIL.
 *
 * Run:
 *   node scripts/research-analyze.js [--dir research/results/raw] [--out research/results/aggregate.json]
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Targets (design-study-plan.md §1) ──────────────────────────────── */
export const TARGETS = {
  semantic: {
    mature: 5.8,
    official: 5.8,
    distinctive: 5.2,
    clear: 6.0,
    competent: 6.0,
    trustworthy: 5.8,
  },
  fiveSecondCategoryRecallPct: 80,
  firstClickPrimaryCtaPct: 80,
  nasaTlxLoadIndexMax: 11, // /20
  susMin: 70,
  visawiSubscaleMin: 5.0,
  ueqScaleMin: 1.5,
  fameNameRecallPct: 60,
  fameUniquenessMin: 5.0,
  motionSuccessGapMaxPp: 10,
  gamificationFairnessMin: 5.0,
};

/* ── Stats ──────────────────────────────────────────────────────────── */
export function mean(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

/** 95% CI (Student t, n≥2) */
export function ci95(arr) {
  const n = arr.length;
  if (n < 2) return null;
  // df = n-1 → T_TABLE indexi df-1 = n-2
  const t = n < 30 ? T_TABLE[Math.min(29, n - 2)] : 1.96;
  return t * (std(arr) / Math.sqrt(n));
}

// t(0.975, df) — df 1..29
const T_TABLE = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function pct(ok, total) {
  return total ? (ok / total) * 100 : NaN;
}

/* ── CSV parse (header + rows, raqamlar auto) ───────────────────────── */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((l) => {
    const cells = l.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      const raw = (cells[i] || '').trim();
      obj[h] = raw === '' ? null : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    });
    return obj;
  });
  return { headers, rows };
}

export function loadCsv(dir, name) {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  return parseCsv(readFileSync(p, 'utf8'));
}

/* ── SUS scoring (Brooke 1996) ──────────────────────────────────────── */
export function susScore(row) {
  let total = 0;
  for (let i = 1; i <= 10; i++) {
    const v = Number(row[`q${i}`]);
    if (Number.isNaN(v)) return null;
    total += i % 2 === 1 ? v - 1 : 5 - v;
  }
  return total * 2.5;
}

/* ── VisAWI-S subscales ─────────────────────────────────────────────── */
export function visawiSubscales(row) {
  const q = (n) => Number(row[`q${n}`]);
  const items = [q(1), q(2), q(3), q(4), q(5), q(6), q(7), q(8), q(9)];
  if (items.some((x) => Number.isNaN(x))) return null;
  return {
    simplicity: mean([8 - q(1), q(2), q(7)]), // q1 reverse: 1→7,7→1 => 8-q
    diversity: mean([q(6), q(9)]),
    colorfulness: mean([q(4), 8 - q(8)]),
    craftsmanship: mean([q(3), q(5)]),
  };
}

/* ── UEQ short ──────────────────────────────────────────────────────── */
export function ueqScales(row) {
  const q = (n) => Number(row[`q${n}`]);
  const items = [q(1), q(2), q(3), q(4), q(5), q(6), q(7), q(8)];
  if (items.some((x) => Number.isNaN(x))) return null;
  return { pragmatic: mean([q(2), q(4), q(5), q(7)]), hedonic: mean([q(1), q(3), q(6), q(8)]) };
}

/* ── NASA-TLX light load index (unweighted) ─────────────────────────── */
export function nasaLoadIndex(rows) {
  const dims = ['Mental demand', 'Physical demand', 'Temporal demand', 'Effort', 'Frustration'];
  const values = dims.map((d) => {
    const r = rows.find((x) => x.dimension === d);
    return r ? Number(r.value) : NaN;
  });
  if (values.some((x) => Number.isNaN(x))) return null;
  return mean(values);
}

/* ── Semantic differential ──────────────────────────────────────────── */
export function semanticMeans(rows, variant) {
  const out = {};
  for (const pair of Object.keys(TARGETS.semantic)) {
    const vals = rows
      .filter((r) => r.pair === pair && (!variant || r.variant === variant) && r.value != null)
      .map((r) => Number(r.value))
      .filter((x) => !Number.isNaN(x));
    out[pair] = vals.length ? { mean: mean(vals), ci: ci95(vals), n: vals.length } : null;
  }
  return out;
}

/* ── Fame recall ────────────────────────────────────────────────────── */
export function fameRecall(rows, element = 'evidence_mark') {
  const rec = rows.filter((r) => r.element === element);
  const recognized = rec.filter((r) => Number(r.recognized) === 1).length;
  const uni = rec
    .map((r) => (r.uniqueness != null ? Number(r.uniqueness) : NaN))
    .filter((x) => !Number.isNaN(x));
  return {
    n: rec.length,
    recognizedPct: pct(recognized, rec.length),
    uniquenessMean: uni.length ? mean(uni) : null,
  };
}

/* ── First-click ────────────────────────────────────────────────────── */
export function firstClickStats(rows) {
  const byTask = {};
  for (const r of rows) {
    const task = (r.task || '').toLowerCase().trim();
    if (!byTask[task]) byTask[task] = { success: 0, total: 0, time: [], misclick: 0 };
    const t = byTask[task];
    t.total++;
    if (Number(r.success) === 1) t.success++;
    if (Number(r.misclick) === 1) t.misclick++;
    if (r.time_ms != null) t.time.push(Number(r.time_ms));
  }
  const out = {};
  for (const [task, t] of Object.entries(byTask)) {
    out[task] = {
      successPct: pct(t.success, t.total),
      misclickPct: pct(t.misclick, t.total),
      medianTimeMs: t.time.length ? median(t.time) : null,
    };
  }
  return out;
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* ── Motion success gap ─────────────────────────────────────────────── */
export function motionAnalysis(rows) {
  const byCond = {};
  for (const r of rows) {
    if (!byCond[r.motion_condition]) byCond[r.motion_condition] = { success: 0, total: 0, speed: [], dis: [] };
    const c = byCond[r.motion_condition];
    if (r.motion_condition == null) continue;
    c.total++;
    if (Number(r.task_success) === 1) c.success++;
    if (r.perceived_speed != null) c.speed.push(Number(r.perceived_speed));
    if (r.discomfort != null) c.dis.push(Number(r.discomfort));
  }
  const out = {};
  for (const [cond, c] of Object.entries(byCond)) {
    out[cond] = {
      successPct: pct(c.success, c.total),
      perceivedSpeedMean: c.speed.length ? mean(c.speed) : null,
      discomfortMean: c.dis.length ? mean(c.dis) : null,
    };
  }
  const gap = out.full && out.none ? out.full.successPct - out.none.successPct : null;
  return { conditions: out, fullVsNoneSuccessGapPp: gap };
}

/* ── Gamification ───────────────────────────────────────────────────── */
export function gamificationByMode(rows) {
  const byMode = {};
  for (const r of rows) {
    if (r.leaderboard_mode == null) continue;
    if (!byMode[r.leaderboard_mode]) byMode[r.leaderboard_mode] = { anxiety: [], fairness: [], motivation: [] };
    const m = byMode[r.leaderboard_mode];
    if (r.anxiety != null) m.anxiety.push(Number(r.anxiety));
    if (r.fairness != null) m.fairness.push(Number(r.fairness));
    if (r.motivation != null) m.motivation.push(Number(r.motivation));
  }
  const out = {};
  for (const [mode, m] of Object.entries(byMode)) {
    out[mode] = {
      anxietyMean: m.anxiety.length ? mean(m.anxiety) : null,
      fairnessMean: m.fairness.length ? mean(m.fairness) : null,
      motivationMean: m.motivation.length ? mean(m.motivation) : null,
    };
  }
  return out;
}

/* ── Environment ────────────────────────────────────────────────────── */
export function environmentAnalysis(rows) {
  const byEnv = {};
  for (const r of rows) {
    if (r.environment == null || r.theme == null) continue;
    const k = `${r.environment}:${r.theme}`;
    if (!byEnv[k]) byEnv[k] = { readable: [], preferred: 0, total: 0 };
    const e = byEnv[k];
    e.total++;
    if (r.readable != null) e.readable.push(Number(r.readable));
    if (Number(r.preferred) === 1) e.preferred++;
  }
  const out = {};
  for (const [k, e] of Object.entries(byEnv)) {
    out[k] = { readableMean: e.readable.length ? mean(e.readable) : null, preferredPct: pct(e.preferred, e.total) };
  }
  return out;
}

/* ── 5-second recall ────────────────────────────────────────────────── */
export function recallStats(rows, field = 'category_correct') {
  const vals = rows.map((r) => (r[field] != null ? Number(r[field]) : NaN)).filter((x) => !Number.isNaN(x));
  return { n: vals.length, correctPct: pct(vals.filter((x) => x === 1).length, vals.length) };
}

/* ── Umumiy analysis ────────────────────────────────────────────────── */
export function analyzeAll(dir) {
  const res = {};
  const load = (n) => loadCsv(dir, n);

  const sem = load('semantic-differential.csv');
  if (sem) res.semantic = semanticMeans(sem.rows);

  const five = load('five-second.csv');
  if (five) res.fiveSecond = { category: recallStats(five.rows, 'category_correct'), cta: recallStats(five.rows, 'cta_correct') };

  const fc = load('first-click.csv');
  if (fc) res.firstClick = firstClickStats(fc.rows);

  const sus = load('sus.csv');
  if (sus) {
    const scores = sus.rows.map(susScore).filter((x) => x != null);
    res.sus = scores.length ? { mean: mean(scores), ci: ci95(scores), n: scores.length } : null;
  }

  const vis = load('visawi-s.csv');
  if (vis) {
    const subs = vis.rows.map(visawiSubscales).filter(Boolean);
    res.visawiS = subs.length
      ? {
          simplicity: mean(subs.map((s) => s.simplicity)),
          diversity: mean(subs.map((s) => s.diversity)),
          colorfulness: mean(subs.map((s) => s.colorfulness)),
          craftsmanship: mean(subs.map((s) => s.craftsmanship)),
          n: subs.length,
        }
      : null;
  }

  const ueq = load('ueq.csv');
  if (ueq) {
    const sc = ueq.rows.map(ueqScales).filter(Boolean);
    res.ueq = sc.length
      ? { pragmatic: mean(sc.map((s) => s.pragmatic)), hedonic: mean(sc.map((s) => s.hedonic)), n: sc.length }
      : null;
  }

  const tlx = load('nasa-tlx.csv');
  if (tlx) {
    const directors = tlx.rows.filter((r) => r.role === 'director');
    const builders = tlx.rows.filter((r) => r.role === 'builder');
    res.nasaTlx = {
      director: nasaLoadIndex(directors),
      builder: nasaLoadIndex(builders),
    };
  }

  const fame = load('fame.csv');
  if (fame) res.fame = fameRecall(fame.rows);

  const motion = load('motion.csv');
  if (motion) res.motion = motionAnalysis(motion.rows);

  const env = load('environment.csv');
  if (env) res.environment = environmentAnalysis(env.rows);

  const gam = load('gamification.csv');
  if (gam) res.gamification = gamificationByMode(gam.rows);

  res.targets = evaluateTargets(res);
  return res;
}

/* ── Targets evaluation ─────────────────────────────────────────────── */
export function evaluateTargets(res) {
  const results = [];
  const add = (id, label, value, target, ok) => results.push({ id, label, value, target, ok });

  for (const [pair, t] of Object.entries(TARGETS.semantic)) {
    const v = res.semantic?.[pair];
    add(`semantic.${pair}`, `Semantic: ${pair}`, v?.mean ?? null, t, v ? v.mean >= t : null);
  }
  add('fiveSecond.category', '5-sec category recall %', res.fiveSecond?.category?.correctPct ?? null, TARGETS.fiveSecondCategoryRecallPct, res.fiveSecond?.category?.correctPct != null ? res.fiveSecond.category.correctPct >= TARGETS.fiveSecondCategoryRecallPct : null);
  add('firstClick.primaryCta', 'Primary CTA first-click %', res.firstClick?.['create test']?.successPct ?? null, TARGETS.firstClickPrimaryCtaPct, res.firstClick?.['create test']?.successPct != null ? res.firstClick['create test'].successPct >= TARGETS.firstClickPrimaryCtaPct : null);
  add('nasaTlx.director', 'NASA-TLX load index (director)', res.nasaTlx?.director ?? null, TARGETS.nasaTlxLoadIndexMax, res.nasaTlx?.director != null ? res.nasaTlx.director <= TARGETS.nasaTlxLoadIndexMax : null);
  add('sus', 'SUS score', res.sus?.mean ?? null, TARGETS.susMin, res.sus?.mean != null ? res.sus.mean >= TARGETS.susMin : null);
  add('ueq.pragmatic', 'UEQ pragmatic', res.ueq?.pragmatic ?? null, TARGETS.ueqScaleMin, res.ueq?.pragmatic != null ? res.ueq.pragmatic >= TARGETS.ueqScaleMin : null);
  add('ueq.hedonic', 'UEQ hedonic', res.ueq?.hedonic ?? null, TARGETS.ueqScaleMin, res.ueq?.hedonic != null ? res.ueq.hedonic >= TARGETS.ueqScaleMin : null);
  add('fame.nameRecall', 'Fame name recall %', res.fame?.recognizedPct ?? null, TARGETS.fameNameRecallPct, res.fame?.recognizedPct != null ? res.fame.recognizedPct >= TARGETS.fameNameRecallPct : null);
  add('fame.uniqueness', 'Fame uniqueness', res.fame?.uniquenessMean ?? null, TARGETS.fameUniquenessMin, res.fame?.uniquenessMean != null ? res.fame.uniquenessMean >= TARGETS.fameUniquenessMin : null);
  add('motion.gap', 'Motion success gap pp', res.motion?.fullVsNoneSuccessGapPp ?? null, TARGETS.motionSuccessGapMaxPp, res.motion?.fullVsNoneSuccessGapPp != null ? res.motion.fullVsNoneSuccessGapPp <= TARGETS.motionSuccessGapMaxPp : null);
  add('gamification.fairness', 'Gamification fairness', res.gamification?.on_global?.fairnessMean ?? null, TARGETS.gamificationFairnessMin, res.gamification?.on_global?.fairnessMean != null ? res.gamification.on_global.fairnessMean >= TARGETS.gamificationFairnessMin : null);

  if (res.visawiS) {
    for (const [sub, v] of Object.entries(res.visawiS)) {
      if (sub === 'n') continue;
      add(`visawi.${sub}`, `VisAWI-S ${sub}`, v, TARGETS.visawiSubscaleMin, v >= TARGETS.visawiSubscaleMin);
    }
  }
  return results;
}

/* ── CLI ────────────────────────────────────────────────────────────── */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && !process.argv[1].includes('vitest')) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(name);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
  };
  const dir = arg('--dir', join(ROOT, 'research/results/raw'));
  const out = arg('--out', join(ROOT, 'research/results/aggregate.json'));
  const res = analyzeAll(dir);
  console.log('── Research analysis (STEP 39) ──');
  for (const t of res.targets) {
    const v = t.value == null ? '—' : (typeof t.value === 'number' ? t.value.toFixed(2) : t.value);
    const s = t.ok === null ? '⏳ no-data' : t.ok ? '✓' : '✗';
    console.log(`  ${s} ${t.label}: ${v} (target ${t.target})`);
  }
  const hasData = res.targets.some((t) => t.ok !== null);
  console.log(`\n${hasData ? 'PASS — ma\'lumotlar bor, targets hisoblandi' : "⏳ Field ma'lumotlari kutilmoqda — CSV shablonlari research/results/raw/ da"}`);
  writeFileSync(out, JSON.stringify(res, null, 2));
  console.log(`aggregate → ${out}`);
}
