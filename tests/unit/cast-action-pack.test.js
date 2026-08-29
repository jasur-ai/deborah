import { describe, it, expect, beforeEach } from 'vitest';
import {
  summarizeParticipation,
  summarizeAccuracy,
  identifyHardestQuestions,
  summarizeMisconceptions,
  summarizeConfidence,
  summarizeRevoteChanges,
  summarizeTransfers,
  summarizeNetwork,
  mapFindingsToItemActions,
  recommendActions,
  projectStudentRecap,
  actionPackRetentionInfo,
  fingerprintConfig,
  buildActionPackForSession,
  HARDEST_QUESTION_MIN_SAMPLE,
  ACTION_PACK_VERSION,
} from '../../services/cast/action-pack-service.js';

function makeParticipants(n = 3, overrides = {}) {
  const out = {};
  for (let i = 1; i <= n; i++) {
    out[`p${i}`] = { participantId: `p${i}`, displayAlias: `Talaba ${i}`, presence: 'online', delivery: 'in_room', ...(overrides[i] || {}) };
  }
  return out;
}

function makeAnswer(overrides = {}) {
  return {
    status: 'ACCEPTED',
    isCorrect: false,
    selectedOptionIds: ['a'],
    submittedAt: Date.now() - 5000,
    ...overrides,
  };
}

describe('C5-01: summarizeParticipation', () => {
  it('hammasi accepted — missing reasonlar nol', () => {
    const participants = makeParticipants(2);
    const answersByQuestion = {
      q1: { p1: makeAnswer(), p2: makeAnswer() },
    };
    const r = summarizeParticipation({ participants, answersByQuestion });
    expect(r.total).toBe(2);
    expect(r.reasons.accepted).toBe(2);
    expect(r.reasons.no_response).toBe(0);
  });

  it('javob bermagan + disconnected + texnik uzilish reasonlari', () => {
    const participants = makeParticipants(3, {
      2: { presence: 'offline' },
      3: { delivery: 'remote', networkBucket: 'poor' },
    });
    const answersByQuestion = { q1: { p1: makeAnswer() } };
    const r = summarizeParticipation({ participants, answersByQuestion });
    expect(r.reasons.accepted).toBe(1);
    expect(r.reasons.disconnected).toBe(1);
    expect(r.reasons.technical_failure).toBe(1);
  });

  it('late_join reason', () => {
    const participants = makeParticipants(1, { 1: { late: true, presence: 'offline' } });
    const r = summarizeParticipation({ participants, answersByQuestion: {} });
    expect(r.reasons.late_join).toBe(1);
  });
});

describe('C5-01: summarizeAccuracy', () => {
  it('accepted denominator — faqat ACCEPTED javoblar', () => {
    const answersByQuestion = {
      q1: { p1: makeAnswer({ isCorrect: true }), p2: makeAnswer({ isCorrect: false }) },
    };
    const r = summarizeAccuracy({ answersByQuestion });
    expect(r.accepted).toBe(2);
    expect(r.correct).toBe(1);
    expect(r.accuracyPercent).toBe(50);
  });

  it('hech qanday javob yo q — null', () => {
    const r = summarizeAccuracy({ answersByQuestion: {} });
    expect(r.accepted).toBe(0);
    expect(r.accuracyPercent).toBeNull();
  });
});

describe('C5-01: identifyHardestQuestions', () => {
  it('past accuracy birinchi keladi, insufficient sample flaglanadi', () => {
    const questions = { q1: { text: 'Savol 1' }, q2: { text: 'Savol 2' } };
    const answersByQuestion = {
      q1: { p1: makeAnswer({ isCorrect: true }), p2: makeAnswer({ isCorrect: false }), p3: makeAnswer({ isCorrect: false }), p4: makeAnswer({ isCorrect: false }), p5: makeAnswer({ isCorrect: false }), p6: makeAnswer({ isCorrect: false }) },
      q2: { p1: makeAnswer({ isCorrect: true }) },
    };
    const r = identifyHardestQuestions({ answersByQuestion, questions });
    expect(r[0].questionId).toBe('q1'); // 16.7% — qiyin
    expect(r[1].insufficientSample).toBe(true); // q2 — 1 ta javob
    expect(HARDEST_QUESTION_MIN_SAMPLE).toBe(6);
  });
});

describe('C5-01: summarizeMisconceptions', () => {
  it('faqat confirmed decision lar chiqadi', () => {
    const misconceptions = {
      q1: {
        b: { misconceptionId: 'formula_mixup', confirmed: true, teacherExplanation: 'Formulani almashtirdi' },
        c: { misconceptionId: 'x', confirmed: false },
      },
    };
    const r = summarizeMisconceptions({ misconceptions, questions: { q1: { text: 'Savol' } } });
    expect(r).toHaveLength(1);
    expect(r[0].optionId).toBe('b');
    expect(r[0].teacherExplanation).toBe('Formulani almashtirdi');
  });
});

describe('C5-01: summarizeConfidence', () => {
  it('confidence bor javoblar uchun matritsa', () => {
    const answersByQuestion = {
      q1: {
        p1: makeAnswer({ confidence: 'high', isCorrect: true }),
        p2: makeAnswer({ confidence: 'high', isCorrect: true }),
        p3: makeAnswer({ confidence: 'low', isCorrect: false }),
      },
    };
    const r = summarizeConfidence({ answersByQuestion });
    expect(r).toHaveLength(1);
    expect(r[0].questionId).toBe('q1');
  });

  it('confidence yo q — empty', () => {
    const answersByQuestion = { q1: { p1: makeAnswer() } };
    const r = summarizeConfidence({ answersByQuestion });
    expect(r).toHaveLength(0);
  });
});

describe('C5-01: summarizeRevoteChanges', () => {
  it('first -> revote WRONG_TO_CORRECT / CORRECT_TO_WRONG / stable', () => {
    const firstAnswers = { q1: { p1: makeAnswer({ isCorrect: false }), p2: makeAnswer({ isCorrect: true }), p3: makeAnswer({ isCorrect: false }) } };
    const revoteAnswers = { q1: { p1: makeAnswer({ isCorrect: true }), p2: makeAnswer({ isCorrect: false }), p3: makeAnswer({ isCorrect: false }) } };
    const r = summarizeRevoteChanges({ firstAnswers, revoteAnswers });
    expect(r).toHaveLength(1);
    expect(r[0].wrongToCorrect).toBe(1);
    expect(r[0].correctToWrong).toBe(1);
    expect(r[0].stable).toBe(1);
  });
});

describe('C5-01: summarizeTransfers', () => {
  it('faqat applied transferlar hisoblanadi', () => {
    const redemptions = {
      q1: { p1: { applied: true, points: 200 }, p2: { applied: false, points: 200 } },
    };
    const r = summarizeTransfers({ redemptions });
    expect(r.applied).toBe(1);
    expect(r.totalPoints).toBe(200);
  });
});

describe('C5-01: summarizeNetwork', () => {
  it('bucket taqsimoti + technical failures', () => {
    const network = { p1: { bucket: 'good', latencyMs: 20 }, p2: { bucket: 'poor', latencyMs: 400 } };
    const participants = makeParticipants(2, { 2: { delivery: 'remote', networkBucket: 'poor' } });
    const r = summarizeNetwork({ network, participants });
    expect(r.totalSamples).toBe(2);
    expect(r.buckets.poor).toBe(1);
    expect(r.technicalFailures).toBe(1);
  });
});

describe('C5-01: mapFindingsToItemActions', () => {
  it('BLOCKER -> retire, dominant distractor -> revise, INFO -> review', () => {
    const findings = [
      { severity: 'BLOCKER', code: 'X', message: 'm1' },
      { severity: 'WARNING', code: 'DOMINANT_DISTRACTOR', message: 'm2' },
      { severity: 'INFO', code: 'AUTO_CLOSE_READINESS', message: 'm3' },
    ];
    const r = mapFindingsToItemActions({ findings });
    expect(r[0].action).toBe('retire');
    expect(r[1].action).toBe('revise');
    expect(r[2].action).toBe('review');
  });
});

describe('C5-01: recommendActions', () => {
  it('past accuracy -> assign_practice birinchi', () => {
    const r = recommendActions({ accuracy: { accuracyPercent: 40 }, participation: {}, network: {} });
    expect(r.some((a) => a.id === 'assign_practice')).toBe(true);
  });

  it('texnik uzilishlar -> redemption sessiya', () => {
    const r = recommendActions({ accuracy: { accuracyPercent: 80 }, participation: { technical_failure: 2 }, network: {} });
    expect(r.some((a) => a.id === 'create_redemption_session')).toBe(true);
  });

  it('doim export tavsiya qilinadi', () => {
    const r = recommendActions({ accuracy: { accuracyPercent: 90 }, participation: {}, network: {} });
    expect(r.some((a) => a.id === 'export')).toBe(true);
  });
});

describe('C5-01: projectStudentRecap', () => {
  it('studentga faqat own response + approved explanation beriladi (low rank YO Q)', () => {
    const answersByQuestion = {
      q1: { p1: makeAnswer({ isCorrect: true, selectedOptionIds: ['a'] }), p2: makeAnswer({ isCorrect: false }) },
    };
    const misconceptions = { q1: { b: { confirmed: true, teacherExplanation: 'Izoh' } } };
    const r = projectStudentRecap({
      participantId: 'p1',
      answersByQuestion,
      misconceptions,
      questions: { q1: { text: 'Savol?' } },
      accuracy: { accepted: 1, correct: 1, accuracyPercent: 100 },
    });
    expect(r.items).toHaveLength(1); // faqat p1 ning savoli
    expect(r.items[0].correct).toBe(true);
    // recap'da hech qanday rank / leaderboard / boshqa student ma'lumoti yo'q
    expect(JSON.stringify(r)).not.toContain('p2');
    expect(JSON.stringify(r)).not.toContain('rank');
  });

  it('approved explanation next step sifatida beriladi', () => {
    const answersByQuestion = { q1: { p1: makeAnswer({ isCorrect: false, selectedOptionIds: ['b'] }) } };
    const misconceptions = { q1: { b: { confirmed: true, teacherExplanation: 'Formulani qayta ko rib chiqing' } } };
    const r = projectStudentRecap({
      participantId: 'p1',
      answersByQuestion,
      misconceptions,
      questions: { q1: { text: 'Savol?' } },
      accuracy: {},
    });
    expect(r.items[0].approvedExplanation).toBe('Formulani qayta ko rib chiqing');
    expect(r.items[0].nextStep).toBeTruthy();
  });
});

describe('C5-01: actionPackRetentionInfo', () => {
  it('action_pack class — 180 kun REVIEW_OR_DELETE', () => {
    const endedAt = 1780000000000;
    const r = actionPackRetentionInfo({ sessionEndedAt: endedAt });
    expect(r.dataClass).toBe('action_pack');
    expect(r.days).toBe(180);
    expect(r.expiryAction).toBe('REVIEW_OR_DELETE');
    expect(r.expiryAt).toBe(endedAt + 180 * 24 * 3600 * 1000);
  });
});

describe('C5-01: fingerprintConfig', () => {
  it('deterministik sha256', () => {
    const a = fingerprintConfig({ timer: { defaultSeconds: 30 } });
    const b = fingerprintConfig({ timer: { defaultSeconds: 30 } });
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
  });
});

describe('C5-01: buildActionPackForSession', () => {
  let store;
  beforeEach(() => {
    store = {
      getSessionMeta: async () => ({ title: 'Fizika', ended_at: 1780000000000 }),
      getConfig: async () => ({ timer: { defaultSeconds: 30 }, dataLifecycle: { policyId: 'inst_v1' }, postCast: { actionPack: true } }),
      listParticipants: async () => makeParticipants(2),
      getPublicQuestions: async () => ({ q1: { text: 'Savol 1' }, q2: { text: 'Savol 2' } }),
      getScores: async () => ({ p1: { total: 1000 } }),
      listAnswersForQuestion: async (sid, qid, attemptNo) => {
        if (attemptNo === 1) return { p1: makeAnswer({ isCorrect: true }), p2: makeAnswer({ isCorrect: false }) };
        return {};
      },
      getNetworkSamples: async () => ({ p1: { bucket: 'good' } }),
      listAudit: async () => ({
        a1: { type: 'cast:misconceptionDecision', questionId: 'q1', optionId: 'b', misconceptionId: 'formula_mixup', confirmed: true, teacherExplanation: 'Izoh', at: 1 },
      }),
      listFindings: async () => [],
    };
  });

  it('to liq report — contract shakli', async () => {
    const report = await buildActionPackForSession('cast_1', store);
    expect(report.sessionId).toBe('cast_1');
    expect(report.version).toBe(ACTION_PACK_VERSION);
    expect(report.fingerprint).toBeTruthy();
    expect(report.accuracy.accepted).toBe(4); // q1+q2, har biri 2 ta
    expect(report.participation.total).toBe(2);
    expect(report.hardestQuestions).toHaveLength(2);
    expect(report.misconceptions).toHaveLength(1);
    expect(report.confidenceMatrix).toBeDefined();
    expect(report.revoteChanges).toHaveLength(2);
    expect(report.networkSummary.totalSamples).toBe(1);
    expect(report.recommendedActions.some((a) => a.id === 'export')).toBe(true);
    expect(report.retention.days).toBe(180);
    expect(report.policyVersion).toBe(1);
    // Review fix: raw participantId'lar snapshot'da YO'Q (private scope)
    expect(report.participation.rows).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain('participantId');
    expect(report.participation.coverage).toBeDefined();
  });

  it('zero participant — report hali ham quriladi (crash yo q)', async () => {
    store.listParticipants = async () => ({});
    store.getScores = async () => ({});
    store.listAnswersForQuestion = async () => ({});
    const report = await buildActionPackForSession('cast_2', store);
    expect(report.participation.total).toBe(0);
    expect(report.accuracy.accepted).toBe(0);
    expect(report.accuracy.accuracyPercent).toBeNull();
    expect(report.generatedAt).toBeTruthy();
  });

  it('audit yo q bo lsa — misconception bo sh, report yaxshi', async () => {
    store.listAudit = async () => ({});
    const report = await buildActionPackForSession('cast_3', store);
    expect(report.misconceptions).toHaveLength(0);
  });
});
