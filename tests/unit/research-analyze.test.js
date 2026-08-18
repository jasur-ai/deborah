import { describe, it, expect } from 'vitest';
import {
  mean, std, ci95, pct, median, parseCsv,
  susScore, visawiSubscales, ueqScales, nasaLoadIndex,
  semanticMeans, firstClickStats, motionAnalysis, gamificationByMode,
  recallStats, fameRecall, environmentAnalysis,
  analyzeAll, evaluateTargets, TARGETS,
} from '../../scripts/research-analyze.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('STEP 39 — Research analysis', () => {
  it('stats: mean/std/ci95/median', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    expect(median([3, 1, 2])).toBe(2);
    expect(pct(4, 5)).toBe(80);
    expect(ci95([5, 6, 7])).toBeCloseTo(2.484, 2); // df=2, t=4.303, sd=1, n=3
  });

  it('parseCsv: header + numeric auto', () => {
    const { headers, rows } = parseCsv('a,b\n1,ok\n2,no');
    expect(headers).toEqual(['a', 'b']);
    expect(rows[0]).toEqual({ a: 1, b: 'ok' });
    expect(rows[1]).toEqual({ a: 2, b: 'no' });
  });

  it('SUS: 10-item score 0-100', () => {
    // Hammasi 4 → 50 (5×3 + 5×1 = 20 → ×2.5)
    const row = {};
    for (let i = 1; i <= 10; i++) row[`q${i}`] = 4;
    expect(susScore(row)).toBe(50);
    // Ideal: odd=5, even=1 → 100
    const best = {};
    for (let i = 1; i <= 10; i++) best[`q${i}`] = i % 2 === 1 ? 5 : 1;
    expect(susScore(best)).toBe(100);
    // Eng yomon: odd=1, even=5 → 0
    const worst = {};
    for (let i = 1; i <= 10; i++) worst[`q${i}`] = i % 2 === 1 ? 1 : 5;
    expect(susScore(worst)).toBe(0);
    // Hammasi 5 → 50 (balanced scale haqiqiy chiqishi)
    const all5 = {};
    for (let i = 1; i <= 10; i++) all5[`q${i}`] = 5;
    expect(susScore(all5)).toBe(50);
  });

  it('VisAWI-S: reverse-scored simplicity', () => {
    // q1=1 (not attractive → reverse → 7), q2=7, q7=7 → simplicity 7
    const row = { q1: 1, q2: 7, q3: 7, q4: 7, q5: 7, q6: 7, q7: 7, q8: 1, q9: 7 };
    const s = visawiSubscales(row);
    expect(s.simplicity).toBeCloseTo(7, 5);
    expect(s.colorfulness).toBeCloseTo(7, 5); // q4=7, q8 reverse: 8-1=7
  });

  it('UEQ: pragmatic/hedonic', () => {
    const row = { q1: 7, q2: 7, q3: 7, q4: 7, q5: 7, q6: 7, q7: 7, q8: 7 };
    const s = ueqScales(row);
    expect(s.pragmatic).toBe(7);
    expect(s.hedonic).toBe(7);
  });

  it('NASA-TLX: load index 6 dims (5 non-performance)', () => {
    const rows = [
      { dimension: 'Mental demand', value: 10 },
      { dimension: 'Physical demand', value: 2 },
      { dimension: 'Temporal demand', value: 8 },
      { dimension: 'Effort', value: 12 },
      { dimension: 'Frustration', value: 3 },
    ];
    expect(nasaLoadIndex(rows)).toBe(7);
  });

  it('Semantic: mean + targets', () => {
    const rows = [
      { variant: 'B', pair: 'mature', value: 6 },
      { variant: 'B', pair: 'mature', value: 6 },
      { variant: 'B', pair: 'mature', value: 5 },
      { variant: 'B', pair: 'clear', value: 7 },
    ];
    const m = semanticMeans(rows);
    expect(m.mature.mean).toBeCloseTo(5.667, 2);
    expect(m.mature.n).toBe(3);
    expect(m.clear.mean).toBe(7);
  });

  it('First-click: success/misclick/median time', () => {
    const rows = [
      { task: 'Create test', success: 1, misclick: 0, time_ms: 300 },
      { task: 'Create test', success: 1, misclick: 0, time_ms: 500 },
      { task: 'Create test', success: 0, misclick: 1, time_ms: 900 },
    ];
    const s = firstClickStats(rows);
    expect(s['create test'].successPct).toBeCloseTo(66.67, 2);
    expect(s['create test'].misclickPct).toBeCloseTo(33.33, 2);
    expect(s['create test'].medianTimeMs).toBe(500);
  });

  it('Motion: success gap full vs none', () => {
    const rows = [
      { motion_condition: 'full', task_success: 1, perceived_speed: 6, discomfort: 3 },
      { motion_condition: 'full', task_success: 1, perceived_speed: 5, discomfort: 4 },
      { motion_condition: 'none', task_success: 1, perceived_speed: 3, discomfort: 2 },
      { motion_condition: 'none', task_success: 0, perceived_speed: 2, discomfort: 2 },
    ];
    const m = motionAnalysis(rows);
    expect(m.fullVsNoneSuccessGapPp).toBe(50);
  });

  it('Gamification: by mode', () => {
    const rows = [
      { leaderboard_mode: 'on_global', anxiety: 6, fairness: 5, motivation: 6 },
      { leaderboard_mode: 'on_global', anxiety: 4, fairness: 4, motivation: 5 },
      { leaderboard_mode: 'off', anxiety: 1, fairness: 7, motivation: 3 },
    ];
    const g = gamificationByMode(rows);
    expect(g.on_global.anxietyMean).toBe(5);
    expect(g.off.fairnessMean).toBe(7);
  });

  it('Fame recall', () => {
    const rows = [
      { element: 'evidence_mark', recognized: 1, uniqueness: 6 },
      { element: 'evidence_mark', recognized: 1, uniqueness: 5 },
      { element: 'evidence_mark', recognized: 0, uniqueness: 4 },
    ];
    const f = fameRecall(rows);
    expect(f.recognizedPct).toBeCloseTo(66.67, 2);
    expect(f.uniquenessMean).toBe(5);
  });

  it('5-sec recall', () => {
    const rows = [{ category_correct: 1 }, { category_correct: 1 }, { category_correct: 0 }];
    expect(recallStats(rows).correctPct).toBeCloseTo(66.67, 2);
  });

  it('analyzeAll: to\'liq CSV pipeline + targets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edikit-research-'));
    const csv = (name, content) => writeFileSync(join(dir, name), content);

    csv('five-second.csv', 'participant_id,variant,category_correct,cta_correct\nP1,B,1,1\nP2,B,1,1\nP3,B,0,1');
    csv('first-click.csv', 'participant_id,variant,task,success,time_ms,misclick\nP1,B,Create test,1,400,0\nP2,B,Create test,1,600,0\nP3,B,Create test,0,800,1');
    csv('semantic-differential.csv', 'participant_id,variant,pair,value\nP1,B,mature,6\nP2,B,mature,6\nP3,B,mature,6');
    csv('sus.csv', 'participant_id,variant,q1,q2,q3,q4,q5,q6,q7,q8,q9,q10\nP1,B,4,4,4,4,4,4,4,4,4,4');
    csv('visawi-s.csv', 'participant_id,variant,q1,q2,q3,q4,q5,q6,q7,q8,q9\nP1,B,2,6,6,6,6,6,6,2,6');
    csv('ueq.csv', 'participant_id,variant,q1,q2,q3,q4,q5,q6,q7,q8\nP1,B,6,6,6,6,6,6,6,6');
    csv('nasa-tlx.csv', 'participant_id,variant,role,dimension,value\nP1,B,director,Mental demand,8\nP1,B,director,Physical demand,2\nP1,B,director,Temporal demand,6\nP1,B,director,Effort,8\nP1,B,director,Frustration,2');
    csv('fame.csv', 'participant_id,variant,element,recognized,uniqueness\nP1,B,evidence_mark,1,6\nP2,B,evidence_mark,1,6\nP3,B,evidence_mark,1,5');
    csv('motion.csv', 'participant_id,variant,motion_condition,task_success,perceived_speed,discomfort\nP1,B,full,1,6,3\nP2,B,full,1,5,3\nP3,B,none,1,3,2\nP4,B,none,1,3,2');
    csv('environment.csv', 'participant_id,variant,environment,theme,readable,preferred\nP1,B,projector,dark,6,1\nP2,B,projector,dark,5,1');
    csv('gamification.csv', 'participant_id,variant,leaderboard_mode,anxiety,fairness,motivation\nP1,B,on_global,4,5,6\nP2,B,on_global,5,5,5\nP3,B,on_global,5,5,5');

    const res = analyzeAll(dir);
    expect(res.sus.mean).toBe(50);
    expect(res.semantic.mature.mean).toBe(6);
    expect(res.fame.recognizedPct).toBe(100);
    expect(res.nasaTlx.director).toBe(5.2);
    expect(res.firstClick['create test'].successPct).toBeCloseTo(66.67, 2);
    expect(res.motion.fullVsNoneSuccessGapPp).toBe(0);
    expect(res.gamification.on_global.fairnessMean).toBe(5);
    expect(res.targets.length).toBeGreaterThan(10);
    // Target evaluation — data bor joylarda ok boolean
    const withData = res.targets.filter((t) => t.ok !== null);
    expect(withData.length).toBeGreaterThan(5);
    expect(TARGETS.semantic.mature).toBe(5.8);
  });

  it('evaluateTargets: PASS/FAIL', () => {
    const res = analyzeAll(join(process.cwd(), 'research/results/raw'));
    const targets = evaluateTargets(res);
    // Hech qanday CSV yo'q — hammasi no-data, xatolik yo'q
    expect(targets.every((t) => t.ok === null)).toBe(true);
  });
});
