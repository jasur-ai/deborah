/**
 * Deborah — Cast C3-11 Prediction → Observation → Explanation (POE) Tests
 * -----------------------------------------------------------------------
 * coverage: contract validation, media validation/readiness/failure,
 *           prediction (with & without confidence), explanation records,
 *           prediction/explanation join, change matrix, aggregate pattern
 *           (identity-hidden), Action Pack summary, exemplar moderation,
 *           reconnect-in-phase (records survive via participant path).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  POE_MEDIA_TYPES,
  POE_MEDIA_READY_THRESHOLD,
  POE_EXPLANATION_CHAR_LIMIT,
  POE_EXPLANATION_MODES,
  validatePoeMedia,
  validatePoeContract,
  recordPrediction,
  recordExplanation,
  getPoeRecords,
  computePredictionDistribution,
  computeChangeMatrix,
  computeAggregatePattern,
  buildPoeSummary,
  mediaReadyState,
  submitExemplar,
  listExemplarQueue,
  moderateExemplar,
  projectPublicExemplars,
} from '../../services/cast/poe-service.js';
import { fb } from '../../firebase/admin.js';
import { publicStateProjection } from '../../services/cast/projections.js';

const TEST_ROOT = 'cast_private/__poe_test';

// ── Setup: lokal DB (data/db.json) test run'lari orasida persists bo'ladi —
//    har run oldidan tozalash idempotentlikni ta'minlaydi ──
describe('C3-11: Setup', () => {
  beforeAll(async () => {
    await fb.remove(TEST_ROOT);
  });
  it('prepares clean test root', async () => {
    const snap = await fb.get(TEST_ROOT);
    expect(snap.exists()).toBe(false);
  });
});

// ── C3-11 Constants ──
describe('C3-11: Constants', () => {
  it('media types has exactly 5 entries', () => {
    expect(POE_MEDIA_TYPES).toEqual(['image', 'animation', 'video', 'experiment', 'live_note']);
  });

  it('readiness threshold is 0.8, char limit 280, modes short_answer+mcq', () => {
    expect(POE_MEDIA_READY_THRESHOLD).toBe(0.8);
    expect(POE_EXPLANATION_CHAR_LIMIT).toBe(280);
    expect(POE_EXPLANATION_MODES).toEqual(['short_answer', 'mcq']);
  });
});

// ── C3-11 Media validation ──
describe('C3-11: Media validation', () => {
  it('image/animation/video require http(s) url', () => {
    expect(validatePoeMedia({ type: 'image' }).error).toBe('MEDIA_URL_REQUIRED');
    expect(validatePoeMedia({ type: 'image', url: 'ftp://x' }).error).toBe('MEDIA_URL_INVALID');
    const ok = validatePoeMedia({ type: 'animation', url: 'https://cdn.example.com/a.gif' });
    expect(ok.ok).toBe(true);
    expect(ok.media.type).toBe('animation');
  });

  it('experiment/live_note require text', () => {
    expect(validatePoeMedia({ type: 'experiment' }).error).toBe('MEDIA_TEXT_REQUIRED');
    const ok = validatePoeMedia({ type: 'live_note', text: 'Muz erishi…', caption: '  1-qadam  ' });
    expect(ok.ok).toBe(true);
    expect(ok.media.caption).toBe('1-qadam');
  });

  it('unknown type rejected', () => {
    expect(validatePoeMedia({ type: 'hologram' }).error).toBe('INVALID_MEDIA_TYPE');
    expect(validatePoeMedia({}).error).toBe('INVALID_MEDIA_TYPE');
  });

  it('caption trimmed and capped at 200', () => {
    const ok = validatePoeMedia({ type: 'image', url: 'https://x.dev/i.png', caption: 'x'.repeat(500) });
    expect(ok.media.caption.length).toBe(200);
  });
});

// ── C3-11 Contract validation ──
describe('C3-11: Contract validation', () => {
  it('valid contract passes', () => {
    const { ok, contract } = validatePoeContract({
      flowId: 'poe_01',
      predictionQuestionId: 'q_pred',
      observationId: 'obs_01',
      explanationQuestionId: 'q_exp',
      timerPolicy: { predictionSeconds: 20, observationSeconds: null, explanationSeconds: 90 },
      media: { type: 'video', url: 'https://cdn.example.com/clip.mp4' },
    });
    expect(ok).toBe(true);
    expect(contract.timerPolicy.predictionSeconds).toBe(20);
    expect(contract.timerPolicy.observationSeconds).toBeNull();
    expect(contract.timerPolicy.explanationSeconds).toBe(90);
    expect(contract.mediaReadyThreshold).toBe(POE_MEDIA_READY_THRESHOLD);
  });

  it('missing required ids → errors', () => {
    const res = validatePoeContract({});
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('flowId kerak');
    expect(res.errors).toContain('predictionQuestionId kerak');
    expect(res.errors).toContain('observationId kerak');
    expect(res.errors).toContain('explanationQuestionId kerak');
  });

  it('invalid media bubbles up as error', () => {
    const res = validatePoeContract({
      flowId: 'f1', predictionQuestionId: 'q1', observationId: 'o1', explanationQuestionId: 'q2',
      media: { type: 'image' }, // url yo'q
    });
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('MEDIA_URL_REQUIRED');
  });

  it('timer clamp: min 5s, max 600s, default 30s', () => {
    const { contract } = validatePoeContract({
      flowId: 'f1', predictionQuestionId: 'q1', observationId: 'o1', explanationQuestionId: 'q2',
      timerPolicy: { predictionSeconds: 2, explanationSeconds: 9000 },
      media: { type: 'image', url: 'https://x.dev/i.png' },
    });
    expect(contract.timerPolicy.predictionSeconds).toBe(5);
    expect(contract.timerPolicy.explanationSeconds).toBe(600);
    const def = validatePoeContract({
      flowId: 'f1', predictionQuestionId: 'q1', observationId: 'o1', explanationQuestionId: 'q2',
      media: { type: 'image', url: 'https://x.dev/i.png' },
    });
    expect(def.contract.timerPolicy.predictionSeconds).toBe(30);
  });

  it('mediaReadyThreshold clamped to 0.5..1', () => {
    const mk = (v) => validatePoeContract({
      flowId: 'f1', predictionQuestionId: 'q1', observationId: 'o1', explanationQuestionId: 'q2',
      mediaReadyThreshold: v, media: { type: 'image', url: 'https://x.dev/i.png' },
    }).contract.mediaReadyThreshold;
    expect(mk(0.2)).toBe(0.5);
    expect(mk(0.9)).toBe(0.9);
    expect(mk('junk')).toBe(POE_MEDIA_READY_THRESHOLD);
  });
});

// ── C3-11 Media readiness (item 6-7) ──
describe('C3-11: Media readiness', () => {
  it('ready when readyCount >= ceil(active * threshold)', () => {
    const st = mediaReadyState(8, 10, 0.8);
    expect(st.required).toBe(8);
    expect(st.ready).toBe(true);
  });

  it('not ready below threshold', () => {
    const st = mediaReadyState(7, 10, 0.8);
    expect(st.required).toBe(8);
    expect(st.ready).toBe(false);
  });

  it('no active participants → never ready', () => {
    expect(mediaReadyState(0, 0).ready).toBe(false);
    expect(mediaReadyState(5, 0).ready).toBe(false);
  });

  it('required never below 1', () => {
    expect(mediaReadyState(1, 1, 0.1).required).toBe(1);
  });
});

// ── C3-11 Records: prediction (item 2-3, plan: "Prediction without confidence") ──
describe('C3-11: Prediction records (local DB)', () => {
  it('prediction WITHOUT confidence is valid (confidence null)', async () => {
    const res = await recordPrediction({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_a', questionId: 'q_pred',
      selectedOptionIds: ['opt_2'], confidence: null, commandId: 'c1',
    });
    expect(res.ok).toBe(true);
    expect(res.record.confidence).toBeNull();
    expect(res.record.type).toBe('prediction');
    expect(res.record.selectedOptionIds).toEqual(['opt_2']);
  });

  it('prediction WITH confidence keeps level; invalid level → null', async () => {
    const ok = await recordPrediction({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_a', questionId: 'q_pred',
      selectedOptionIds: ['opt_1'], confidence: 'high', commandId: 'c2',
    });
    expect(ok.record.confidence).toBe('high');
    const bad = await recordPrediction({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_b', questionId: 'q_pred',
      selectedOptionIds: ['opt_1'], confidence: 'sure_thing', commandId: 'c3',
    });
    expect(bad.record.confidence).toBeNull();
  });

  it('empty prediction rejected', async () => {
    const res = await recordPrediction({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_x', questionId: 'q_pred',
      selectedOptionIds: [], commandId: 'c4',
    });
    expect(res.error).toBe('EMPTY');
  });
});

// ── C3-11 Explanation records + join (item 8-9) ──
describe('C3-11: Explanation records + prediction join', () => {
  it('short_answer explanation recorded and capped at 280', async () => {
    const res = await recordExplanation({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_a', questionId: 'q_exp',
      mode: 'short_answer', text: '  Muz suvga aylanadi  ', commandId: 'c5',
    });
    expect(res.ok).toBe(true);
    expect(res.record.text).toBe('Muz suvga aylanadi');
    const long = await recordExplanation({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_b', questionId: 'q_exp',
      mode: 'short_answer', text: 'x'.repeat(500), commandId: 'c6',
    });
    expect(long.record.text.length).toBe(POE_EXPLANATION_CHAR_LIMIT);
  });

  it('mcq explanation requires selectedOptionIds; empty rejected', async () => {
    const res = await recordExplanation({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_c', questionId: 'q_exp',
      mode: 'mcq', selectedOptionIds: ['opt_3'], commandId: 'c7',
    });
    expect(res.ok).toBe(true);
    expect(res.record.mode).toBe('mcq');
    const empty = await recordExplanation({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_c', questionId: 'q_exp',
      mode: 'mcq', selectedOptionIds: [], commandId: 'c8',
    });
    expect(empty.error).toBe('EMPTY');
  });

  it('invalid mode rejected', async () => {
    const res = await recordExplanation({
      sessionId: '__poe_test', flowId: 'poe_01', participantId: 'p_c', questionId: 'q_exp',
      mode: 'essay', text: 'x', commandId: 'c9',
    });
    expect(res.error).toBe('INVALID_MODE');
  });

  it('prediction + explanation JOIN under same participantId (reconnect-safe)', async () => {
    const records = await getPoeRecords('__poe_test', 'poe_01');
    expect(records.p_a.prediction).toBeTruthy();
    expect(records.p_a.explanation).toBeTruthy();
    expect(records.p_a.prediction.questionId).toBe('q_pred');
    expect(records.p_a.explanation.questionId).toBe('q_exp');
    expect(records.p_b.prediction).toBeTruthy(); // faqat prediction bo'lsa ham qaytadi
    expect(records.p_b.explanation).toBeTruthy();
  });
});

// ── C3-11 Analysis (pure, teacher-private) ──
describe('C3-11: Analysis — distribution & change matrix', () => {
  const records = {
    a: { participantId: 'a', prediction: { selectedOptionIds: ['opt_1'] }, explanation: { mode: 'mcq', selectedOptionIds: ['opt_1'] } },
    b: { participantId: 'b', prediction: { selectedOptionIds: ['opt_1'] }, explanation: { mode: 'mcq', selectedOptionIds: ['opt_2'] } },
    c: { participantId: 'c', prediction: { selectedOptionIds: ['opt_2'] }, explanation: { mode: 'mcq', selectedOptionIds: ['opt_2'] } },
    d: { participantId: 'd', prediction: null, explanation: null }, // prediction yo'q
    e: { participantId: 'e', prediction: { selectedOptionIds: ['opt_3'] }, explanation: { mode: 'short_answer', text: 'chunki…' } }, // mcq emas
  };

  it('distribution counts prediction options only (teacher-private)', () => {
    const dist = computePredictionDistribution(records);
    expect(dist.total).toBe(4);
    expect(dist.dist.opt_1).toBe(2);
    expect(dist.dist.opt_2).toBe(1);
    expect(dist.dist.opt_3).toBe(1);
  });

  it('change matrix includes participantId + changed flag (teacher-private)', () => {
    const m = computeChangeMatrix(records);
    expect(m.total).toBe(3); // faqat mcq explanation'lar
    const rowA = m.rows.find((r) => r.participantId === 'a');
    expect(rowA.changed).toBe(false);
    const rowB = m.rows.find((r) => r.participantId === 'b');
    expect(rowB.changed).toBe(true);
    expect(m.changed).toBe(1);
    expect(m.changeRate).toBe(33);
  });

  it('aggregate pattern is public-safe: NO identity fields', () => {
    const agg = computeAggregatePattern(records);
    expect(agg.participants).toBe(3); // faqat son — identity emas
    expect(agg.changed).toBe(1);
    expect(agg.changeRate).toBe(33);
    expect(JSON.stringify(agg)).not.toContain('participantId');
    expect(JSON.stringify(agg)).not.toContain('displayAlias');
  });

  it('topTransitions sorted desc, capped at 5', () => {
    const many = {};
    for (let i = 0; i < 10; i++) {
      many[`p${i}`] = {
        participantId: `p${i}`,
        prediction: { selectedOptionIds: [`opt_${i % 2}`] },
        explanation: { mode: 'mcq', selectedOptionIds: [`opt_${i % 2}`] },
      };
    }
    const agg = computeAggregatePattern(many);
    expect(agg.topTransitions.length).toBeLessThanOrEqual(5);
    const counts = agg.topTransitions.map((t) => t.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});

// ── C3-11 Action Pack summary (item 13) ──
describe('C3-11: Action Pack summary', () => {
  it('buildPoeSummary counts predicted/explained/changed', () => {
    const records = {
      a: { prediction: { selectedOptionIds: ['o1'] }, explanation: { mode: 'mcq', selectedOptionIds: ['o1'] } },
      b: { prediction: { selectedOptionIds: ['o1'] }, explanation: { mode: 'mcq', selectedOptionIds: ['o2'] } },
      c: { prediction: { selectedOptionIds: ['o2'] } }, // explained yo'q
      d: { explanation: { mode: 'short_answer', text: 'x' } }, // prediction yo'q
    };
    const s = buildPoeSummary(records, { flowId: 'poe_01' });
    expect(s.flowId).toBe('poe_01');
    expect(s.predicted).toBe(3);
    expect(s.explained).toBe(3);
    expect(s.changed).toBe(1);
    expect(s.changeRate).toBe(50); // 2 mcq juftlikdan 1 o'zgargan
    expect(s.completedAt).toBeTruthy();
  });
});

// ── C3-11 Explanation moderation / exemplars (item 11-12) ──
describe('C3-11: Exemplar moderation', () => {
  it('submitExemplar → RECEIVED with priority; empty rejected', async () => {
    const res = await submitExemplar({
      sessionId: '__poe_test', flowId: 'poe_02', participantId: 'p1', text: 'Muz erishi suyuqlanish deyiladi', commandId: 'c10',
    });
    expect(res.ok).toBe(true);
    expect(res.exemplarId).toMatch(/^exm_/);
    expect(res.priority).toBe('LOW');
    const empty = await submitExemplar({
      sessionId: '__poe_test', flowId: 'poe_02', participantId: 'p1', text: '   ', commandId: 'c11',
    });
    expect(empty.error).toBe('EMPTY');
  });

  it('sensitive exemplar gets HIGH priority flag', async () => {
    const res = await submitExemplar({
      sessionId: '__poe_test', flowId: 'poe_02', participantId: 'p2', text: 'Aloqa: test@mail.uz', commandId: 'c12',
    });
    expect(res.priority).toBe('HIGH');
  });

  it('approve → APPROVED; withdraw → WITHDRAWN final', async () => {
    const queue = await listExemplarQueue('__poe_test', 'poe_02');
    const id = Object.keys(queue)[0];
    const approved = await moderateExemplar({
      sessionId: '__poe_test', flowId: 'poe_02', exemplarId: id, action: 'approve', moderatorId: 'teacher',
    });
    expect(approved.moderationState).toBe('APPROVED');
    expect(approved.moderatedBy).toBe('teacher');
    const again = await moderateExemplar({
      sessionId: '__poe_test', flowId: 'poe_02', exemplarId: id, action: 'withdraw', moderatorId: 'teacher',
    });
    expect(again.moderationState).toBe('WITHDRAWN');
    await expect(moderateExemplar({
      sessionId: '__poe_test', flowId: 'poe_02', exemplarId: id, action: 'approve', moderatorId: 'teacher',
    })).rejects.toThrow();
  });

  it('missing exemplar → throws', async () => {
    await expect(moderateExemplar({
      sessionId: '__poe_test', flowId: 'poe_02', exemplarId: 'exm_missing', action: 'approve', moderatorId: 't',
    })).rejects.toThrow();
  });

  it('public projection: APPROVED public (identity stripped), RECEIVED excluded', async () => {
    const res = await submitExemplar({
      sessionId: '__poe_test', flowId: 'poe_03', participantId: 'p1', text: 'Namuna javob', commandId: 'c13',
    });
    await moderateExemplar({
      sessionId: '__poe_test', flowId: 'poe_03', exemplarId: res.exemplarId, action: 'approve', moderatorId: 'teacher',
    });
    const pending = await submitExemplar({
      sessionId: '__poe_test', flowId: 'poe_03', participantId: 'p2', text: 'Hali ko‘rib chiqilmagan', commandId: 'c14',
    });
    expect(pending.ok).toBe(true);
    const queue = await listExemplarQueue('__poe_test', 'poe_03');
    const pub = projectPublicExemplars(queue);
    expect(pub.length).toBe(1);
    expect(pub[0].text).toBe('Namuna javob');
    expect(pub[0].exemplarId).toBe(res.exemplarId);
    expect(JSON.stringify(pub)).not.toContain('participantId');
    expect(JSON.stringify(pub)).not.toContain('moderatedBy');
  });
});

// ── C3-11 Reconnect: public state projection (plan: "Reconnect in every phase") ──
describe('C3-11: Reconnect projection (publicStateProjection)', () => {
  const contract = {
    flowId: 'poe_01',
    predictionQuestionId: 'q_pred',
    observationId: 'obs_01',
    explanationQuestionId: 'q_exp',
    media: { type: 'video', url: 'https://cdn.example.com/clip.mp4', caption: 'Tajriba' },
    mediaReadyThreshold: 0.8,
    timerPolicy: { predictionSeconds: 20, observationSeconds: null, explanationSeconds: 90 },
  };

  it('PREDICTION_OPEN → poe.phase=PREDICTION with safe contract', () => {
    const proj = publicStateProjection({
      phase: 'PREDICTION_OPEN',
      questionId: 'q_pred',
      poeFlow: { contract, openedAt: 1, closesAt: 20000 },
    });
    expect(proj.poe.phase).toBe('PREDICTION');
    expect(proj.poe.flowId).toBe('poe_01');
    expect(proj.poe.predictionQuestionId).toBe('q_pred');
    expect(proj.poe.media.url).toContain('https://');
    expect(proj.poe.mediaReadyThreshold).toBe(0.8);
    expect(JSON.stringify(proj.poe)).not.toContain('correctOptionIds');
    expect(JSON.stringify(proj.poe)).not.toContain('participantId');
  });

  it('OBSERVATION → media + predictionClosedAt; EXPLANATION → question id', () => {
    const obs = publicStateProjection({
      phase: 'OBSERVATION',
      questionId: 'q_pred',
      poeFlow: { contract, predictionClosedAt: 5000 },
    });
    expect(obs.poe.phase).toBe('OBSERVATION');
    expect(obs.poe.predictionClosedAt).toBe(5000);
    const exp = publicStateProjection({
      phase: 'EXPLANATION_OPEN',
      questionId: 'q_exp',
      poeFlow: { contract, explanationOpenedAt: 6000, closesAt: 90000 },
    });
    expect(exp.poe.phase).toBe('EXPLANATION');
    expect(exp.questionId).toBe('q_exp');
  });

  it('DONE after explanation locked; ANALYSIS after shown; null when no flow', () => {
    const done = publicStateProjection({
      phase: 'QUESTION_LOCKED',
      questionId: 'q_exp',
      poeFlow: { contract, explanationClosedAt: 7000 },
    });
    expect(done.poe.phase).toBe('DONE');
    const analysis = publicStateProjection({
      phase: 'REVEAL',
      questionId: 'q_exp',
      poeFlow: { contract, explanationClosedAt: 7000, analysisShownAt: 8000 },
    });
    expect(analysis.poe.phase).toBe('ANALYSIS');
    expect(publicStateProjection({ phase: 'LOBBY_OPEN' }).poe).toBeNull();
  });

  it('mediaFailed + fallback text exposed (host retry/skip/fallback state)', () => {
    const proj = publicStateProjection({
      phase: 'OBSERVATION',
      questionId: 'q_pred',
      poeFlow: { contract, mediaFailed: true, mediaFallbackText: 'Matnli kuzatuv…' },
    });
    expect(proj.poe.mediaFailed).toBe(true);
    expect(proj.poe.mediaFallbackText).toBe('Matnli kuzatuv…');
  });
});

// ── Cleanup ──
describe('C3-11: Cleanup', () => {
  it('removes test data', async () => {
    await fb.remove(TEST_ROOT);
    const snap = await fb.get(TEST_ROOT);
    expect(snap.exists()).toBe(false);
  });
});
