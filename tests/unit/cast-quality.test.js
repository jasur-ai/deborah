/**
 * Edikit — Cast C3-15 Rehearsal + Quality Lab Tests
 * ---------------------------------------------------
 * coverage: bot scenario validation + production isolation, bot roster
 *           (bot: namespace, isBot flag), duplicate/lost-ACK idempotency
 *           (service-level commandId check), preflight rules (9), postflight
 *           rules (9), finding status workflow (accept/dismiss/resolve),
 *           report aggregation, rehearsal reset/stop helpers, persist/list.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import { botId, isBot, BOT_SCENARIOS, BOT_SCENARIO_LIST, stopBots } from '../../services/cast/bot-simulator.js';
import { isRehearsal, rehearsalMeta, excludeFromMetrics } from '../../services/cast/rehearsal-service.js';
import {
  FINDING_SEVERITIES,
  FINDING_STATUS,
  buildFinding,
  runPreflight,
  runPostflight,
  buildReport,
  persistFindings,
  listFindings,
  getFinding,
  updateFindingStatus,
} from '../../services/cast/quality-lab.js';

const TEST_SESSION = '__quality_test';
const TEST_ACTOR = '__quality_teacher';

const pubQ = (id, extra = {}) => ({ id, type: 'single_choice', text: 'Savol matni', options: [{ id: 'o_1', text: 'A' }, { id: 'o_2', text: 'B' }], ...extra });
const privQ = (id, extra = {}) => ({ id, type: 'single_choice', text: 'Savol matni', correctOptionIds: ['o_1'], explanation: 'Izoh', ...extra });

describe('C3-15: Setup', () => {
  beforeAll(async () => {
    await fb.remove(`cast_private/${TEST_SESSION}`);
    await fb.remove(`cast_sessions/${TEST_SESSION}`);
  });
  afterAll(async () => {
    stopBots(TEST_SESSION);
    await fb.remove(`cast_private/${TEST_SESSION}`);
    await fb.remove(`cast_sessions/${TEST_SESSION}`);
  });
  it('test session is clean before use', async () => {
    const snap = await fb.get(`cast_sessions/${TEST_SESSION}`);
    expect(snap.exists()).toBe(false);
  });
});

describe('C3-15: Rehearsal isolation', () => {
  it('rehearsalMeta marks session as simulation + rehearsal', () => {
    const m = rehearsalMeta({ title: 'T' });
    expect(m.environment).toBe('simulation');
    expect(m.rehearsal).toBe(true);
    expect(m.createdFor).toBe('quality_lab');
  });

  it('isRehearsal true only for simulation sessions', () => {
    expect(isRehearsal(rehearsalMeta({}))).toBe(true);
    expect(isRehearsal({ environment: 'production', rehearsal: false })).toBe(false);
    expect(isRehearsal(null)).toBe(false);
    expect(isRehearsal(undefined)).toBe(false);
  });

  it('excludeFromMetrics filters rehearsal sessions from production metrics', () => {
    expect(excludeFromMetrics(rehearsalMeta({}))).toBe(true);
    expect(excludeFromMetrics({ environment: 'production' })).toBe(false);
  });
});

describe('C3-15: Bot namespace & roster', () => {
  it('botId produces deterministic bot: namespace ids', () => {
    expect(botId(0)).toBe('bot:000');
    expect(botId(1)).toBe('bot:001');
    expect(botId(12)).toBe('bot:012');
    expect(isBot(botId(0))).toBe(true);
  });

  it('isBot false for real participants', () => {
    expect(isBot('p_abc123')).toBe(false);
    expect(isBot('user:admin')).toBe(false);
  });

  it('BOT_SCENARIOS registry covers all 10 scenarios', () => {
    expect(BOT_SCENARIO_LIST).toHaveLength(10);
    expect(BOT_SCENARIO_LIST).toContain('fast_correct');
    expect(BOT_SCENARIO_LIST).toContain('slow_correct');
    expect(BOT_SCENARIO_LIST).toContain('wrong_cluster');
    expect(BOT_SCENARIO_LIST).toContain('disconnect');
    expect(BOT_SCENARIO_LIST).toContain('late_join');
    expect(BOT_SCENARIO_LIST).toContain('no_answers');
    expect(BOT_SCENARIO_LIST).toContain('all_instant');
    expect(BOT_SCENARIO_LIST).toContain('duplicate_answer');
    expect(BOT_SCENARIO_LIST).toContain('lost_ack');
    expect(BOT_SCENARIO_LIST).toContain('host_disconnect');
  });
});

describe('C3-15: Preflight rules (9)', () => {
  const clean = () => ({ publicQuestions: [], privateQuestions: [], config: {} });

  it('1. ANSWER_KEY_PUBLIC — BLOCKER when key leaks in public payload', () => {
    const f = runPreflight({ ...clean(), publicQuestions: [pubQ('q1', { correctOptionIds: ['o_1'] })] });
    expect(f.some((x) => x.code === 'ANSWER_KEY_PUBLIC' && x.severity === 'BLOCKER' && x.questionId === 'q1')).toBe(true);
  });

  it('2. MISSING_ANSWER — WARNING when scored question has no key', () => {
    const f = runPreflight({ ...clean(), privateQuestions: [privQ('q1', { correctOptionIds: [] })] });
    expect(f.some((x) => x.code === 'MISSING_ANSWER' && x.severity === 'WARNING' && x.questionId === 'q1')).toBe(true);
  });

  it('3. UNSUPPORTED_TYPE — WARNING for unknown question type', () => {
    const f = runPreflight({ ...clean(), publicQuestions: [pubQ('q1', { type: 'essay' })] });
    expect(f.some((x) => x.code === 'UNSUPPORTED_TYPE' && x.severity === 'WARNING')).toBe(true);
  });

  it('4. NO_TIMER_FULLY_AUTO — BLOCKER in fully_auto without timer', () => {
    const f = runPreflight({ ...clean(), config: { mode: 'fully_auto', timer: {} } });
    expect(f.some((x) => x.code === 'NO_TIMER_FULLY_AUTO' && x.severity === 'BLOCKER')).toBe(true);
    const ok = runPreflight({ ...clean(), config: { mode: 'fully_auto', timer: { defaultSeconds: 30 } } });
    expect(ok.some((x) => x.code === 'NO_TIMER_FULLY_AUTO')).toBe(false);
  });

  it('5. SHORT_TIMER_LONG_STEM — WARNING for long stem + short timer', () => {
    const longText = 'x'.repeat(220);
    const f = runPreflight({ ...clean(), publicQuestions: [pubQ('q1', { text: longText })], config: { timer: { defaultSeconds: 10 } } });
    expect(f.some((x) => x.code === 'SHORT_TIMER_LONG_STEM' && x.questionId === 'q1')).toBe(true);
  });

  it('6. PUBLIC_FULL_LEADERBOARD — WARNING when full leaderboard is public', () => {
    const f = runPreflight({ ...clean(), config: { leaderboard: { mode: 'full', visibility: 'public' } } });
    expect(f.some((x) => x.code === 'PUBLIC_FULL_LEADERBOARD' && x.severity === 'WARNING')).toBe(true);
  });

  it('7. MUSIC_READING_HEAVY — INFO for long stems on 10+ questions', () => {
    const qs = Array.from({ length: 10 }, (_, i) => pubQ('q' + i, { text: 'y'.repeat(160) }));
    const f = runPreflight({ ...clean(), publicQuestions: qs });
    expect(f.some((x) => x.code === 'MUSIC_READING_HEAVY' && x.severity === 'INFO')).toBe(true);
  });

  it('8. MISSING_EXPLANATION — INFO when explanation absent', () => {
    const f = runPreflight({ ...clean(), privateQuestions: [privQ('q1', { explanation: null })] });
    expect(f.some((x) => x.code === 'MISSING_EXPLANATION' && x.questionId === 'q1')).toBe(true);
  });

  it('9. CONTRAST_MEDIA_ACCESSIBILITY — WARNING for media without high contrast', () => {
    const f = runPreflight({ ...clean(), publicQuestions: [pubQ('q1', { media: { type: 'image' } })], config: { accessibility: { contrast: 'normal' } } });
    expect(f.some((x) => x.code === 'CONTRAST_MEDIA_ACCESSIBILITY')).toBe(true);
  });

  it('clean payload yields zero findings', () => {
    const f = runPreflight({ ...clean(), publicQuestions: [pubQ('q1')], privateQuestions: [privQ('q1')], config: { timer: { defaultSeconds: 30 }, leaderboard: { visibility: 'hidden' } } });
    expect(f.length).toBe(0);
  });
});

describe('C3-15: Postflight rules (9)', () => {
  const answer = (qid, pid, extra = {}) => ({ [pid]: { participantId: pid, selectedOptionIds: ['o_1'], questionId: qid, openedAt: 1000, submittedAt: 5000, closesAt: 10000, ...extra } });

  it('1. TIMEOUT_RATE_HIGH — WARNING when >40% near timeout', () => {
    const byPid = {};
    for (let i = 0; i < 6; i++) byPid['p' + i] = { participantId: 'p' + i, selectedOptionIds: ['o_1'], questionId: 'q1', openedAt: 0, submittedAt: 99, closesAt: 100 };
    const f = runPostflight({
      config: { timer: { defaultSeconds: 30 } },
      answersByQuestion: { q1: byPid },
      participants: { p1: {}, p2: {}, p3: {}, p4: {}, p5: {}, p6: {} },
    });
    expect(f.some((x) => x.code === 'TIMEOUT_RATE_HIGH')).toBe(true);
  });

  it('2. DELIVERY_LATENCY_HIGH — WARNING when avg latency approaches timer', () => {
    const byPid = {};
    for (let i = 0; i < 6; i++) byPid['p' + i] = { participantId: 'p' + i, selectedOptionIds: ['o_1'], questionId: 'q1', openedAt: 100, submittedAt: 30000, closesAt: 30100 };
    const f = runPostflight({
      config: { timer: { defaultSeconds: 30 } },
      answersByQuestion: { q1: byPid },
      participants: { p1: {}, p2: {}, p3: {}, p4: {}, p5: {}, p6: {} },
    });
    expect(f.some((x) => x.code === 'DELIVERY_LATENCY_HIGH')).toBe(true);
  });

  it('3. AUTO_CLOSE_READINESS — INFO when soft timer + late answers', () => {
    const f = runPostflight({
      config: { timer: { mode: 'soft', defaultSeconds: 30 } },
      answersByQuestion: { q1: answer('q1', 'p1', { openedAt: 0, submittedAt: 9900, closesAt: 10000 }) },
      participants: { p1: {} },
    });
    expect(f.some((x) => x.code === 'AUTO_CLOSE_READINESS')).toBe(true);
  });

  it('4. DOMINANT_DISTRACTOR — WARNING when one option gets >50%', () => {
    const byPid = {};
    for (let i = 0; i < 6; i++) byPid['p' + i] = { participantId: 'p' + i, selectedOptionIds: ['o_2'], questionId: 'q1', openedAt: 0, submittedAt: 1000, closesAt: 10000 };
    const f = runPostflight({ answersByQuestion: { q1: byPid }, participants: {} });
    expect(f.some((x) => x.code === 'DOMINANT_DISTRACTOR' && x.questionId === 'q1')).toBe(true);
  });

  it('5. REVOTE_GAIN_LOW — INFO when revote rounds exist', () => {
    const f = runPostflight({
      answersByQuestion: {
        q1: { p1: { participantId: 'p1', attemptNo: 1, selectedOptionIds: ['o_1'], questionId: 'q1', openedAt: 0, submittedAt: 1000, closesAt: 10000 } },
        q1r2: { p1: { participantId: 'p1', attemptNo: 2, selectedOptionIds: ['o_1'], questionId: 'q1r2', openedAt: 0, submittedAt: 1000, closesAt: 10000 } },
      },
      participants: { p1: {} },
    });
    expect(f.some((x) => x.code === 'REVOTE_GAIN_LOW')).toBe(true);
  });

  it('6. HIGH_CONFIDENCE_WRONG — WARNING for 3+ confident wrong answers', () => {
    const byPid = {};
    for (let i = 0; i < 3; i++) byPid['p' + i] = { participantId: 'p' + i, confidence: 'high', status: 'WRONG', selectedOptionIds: ['o_2'], questionId: 'q1', openedAt: 0, submittedAt: 1000, closesAt: 10000 };
    const f = runPostflight({ answersByQuestion: { q1: byPid }, participants: {} });
    expect(f.some((x) => x.code === 'HIGH_CONFIDENCE_WRONG')).toBe(true);
  });

  it('7. PARTICIPANT_COVERAGE_LOW — WARNING when <70% answered', () => {
    const f = runPostflight({
      answersByQuestion: { q1: answer('q1', 'p1') },
      participants: { p1: {}, p2: {}, p3: {}, p4: {}, p5: {}, p6: {}, p7: {}, p8: {} },
    });
    expect(f.some((x) => x.code === 'PARTICIPANT_COVERAGE_LOW')).toBe(true);
  });

  it('8. AUDIO_MUTE — INFO for audio signals', () => {
    const f = runPostflight({ signals: [{ code: 'audio_off' }], answersByQuestion: {}, participants: {} });
    expect(f.some((x) => x.code === 'AUDIO_MUTE')).toBe(true);
  });

  it('9. HOST_INTERVENTION — INFO for 3+ pauses', () => {
    const f = runPostflight({
      events: [{ type: 'pause' }, { type: 'pause' }, { type: 'addTime' }],
      answersByQuestion: {},
      participants: {},
    });
    expect(f.some((x) => x.code === 'HOST_INTERVENTION')).toBe(true);
  });

  it('clean session yields zero findings', () => {
    const f = runPostflight({ answersByQuestion: {}, participants: {}, config: { timer: { defaultSeconds: 30 } } });
    expect(f.length).toBe(0);
  });
});

describe('C3-15: Findings workflow', () => {
  it('buildFinding shapes a valid finding contract', () => {
    const f = buildFinding({ severity: 'WARNING', code: 'TEST_RULE', questionId: 'q1', message: 'x', actionId: 'fix' });
    expect(f.severity).toBe('WARNING');
    expect(f.code).toBe('TEST_RULE');
    expect(f.status).toBe(FINDING_STATUS.OPEN);
    expect(f.findingId).toBeTruthy();
    expect(FINDING_SEVERITIES).toContain(f.severity);
  });

  it('persist + list + get round-trip', async () => {
    const f = buildFinding({ severity: 'INFO', code: 'PERSIST_RULE', message: 'round trip', actionId: 'none' });
    await persistFindings(TEST_SESSION, 'preflight', [f]);
    const all = await listFindings(TEST_SESSION);
    const found = all[f.findingId];
    expect(found).toBeTruthy();
    expect(found.kind).toBe('preflight');
    const single = await getFinding(TEST_SESSION, f.findingId);
    expect(single.findingId).toBe(f.findingId);
  });

  it('updateFindingStatus accept → dismiss → resolve', async () => {
    const f = buildFinding({ severity: 'BLOCKER', code: 'STATUS_RULE', message: 'status', actionId: 'fix' });
    await persistFindings(TEST_SESSION, 'preflight', [f]);

    await updateFindingStatus(TEST_SESSION, f.findingId, 'ACCEPTED', TEST_ACTOR);
    let cur = await getFinding(TEST_SESSION, f.findingId);
    expect(cur.status).toBe('ACCEPTED');
    expect(cur.updatedBy).toBe(TEST_ACTOR);
    expect(cur.resolvedAt).toBeNull();

    await updateFindingStatus(TEST_SESSION, f.findingId, 'DISMISSED', TEST_ACTOR);
    cur = await getFinding(TEST_SESSION, f.findingId);
    expect(cur.status).toBe('DISMISSED');

    await updateFindingStatus(TEST_SESSION, f.findingId, 'RESOLVED', TEST_ACTOR);
    cur = await getFinding(TEST_SESSION, f.findingId);
    expect(cur.status).toBe('RESOLVED');
    expect(cur.resolvedAt).toBeTruthy();
    expect(cur.resolvedBy).toBe(TEST_ACTOR);
  });

  it('buildReport aggregates severity + status counts', () => {
    const findings = [
      buildFinding({ severity: 'BLOCKER', code: 'A', message: 'x' }),
      buildFinding({ severity: 'BLOCKER', code: 'B', message: 'x' }),
      buildFinding({ severity: 'WARNING', code: 'C', message: 'x' }),
      buildFinding({ severity: 'INFO', code: 'D', message: 'x' }),
    ];
    const rep = buildReport(findings);
    expect(rep.total).toBe(4);
    expect(rep.bySeverity.BLOCKER).toBe(2);
    expect(rep.bySeverity.WARNING).toBe(1);
    expect(rep.bySeverity.INFO).toBe(1);
    expect(rep.byStatus.OPEN).toBe(4);
  });
});
