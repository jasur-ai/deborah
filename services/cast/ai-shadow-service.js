/**
 * Edikit — Cast AI Co-host Shadow Service (C5-11)
 * ------------------------------------------------
 * Pure shadow module: AI hech qachon live action bajarmaydi, faqat
 * recommendation card sifatida suggestion beradi va teacher qaror
 * qiladi (accept/dismiss). Bu faylda I/O YO'Q — barcha funksiyalar
 * pure/deterministic (testable). Provider chaqiruvi alohida adapterda
 * (ai-shadow-adapter.js), socket emit/routes integratsiyasi esa
 * cast-handler/routes'da.
 *
 * Reja item'lari:
 *   1. Rule engine outputini baseline sifatida saqlash          → buildShadowBaseline
 *   2. LLM adapterga aggregate/de-identified structured input   → buildShadowInput
 *   3. Outputni strict suggestion schema bilan parse            → SUGGESTION_SCHEMA / parseSuggestion
 *   4. Provider timeout/cost cap                                → adapter'da (timeoutMs/maxCostUs)
 *   5. Director'da shadow/recommendation card                   → socket + UI
 *   6. Teacher accept/dismiss eventini yig'ish                  → recordShadowDecision
 *   7. AIga live command tool bermaslik                         → suggestion faqat card, command execute YO'Q
 *   8. Forbidden actionlar (reveal/score/punish/final/misconduct/end) → assertSuggestionAllowed
 *   9. Correctness/false interruption/acceptance/subgroup/latency/cost → evaluateShadowRun
 *  10. Shadow evaluation gate'dan keyin suggestion mode          → computeShadowGate / shouldPromoteToSuggestion
 */

import { z } from 'zod';

// ── Item 8: forbidden live actions ──
// AI suggestion'larda HECh QACHON bu action'lar bo'lishi mumkin emas —
// ular live command'larga aylantirilmaydi, suggestion ham rad etiladi.
export const SHADOW_FORBIDDEN_ACTIONS = Object.freeze({
  ANSWER_REVEAL: 'answer:reveal',
  SCORE_CHANGE: 'score:change',
  PUNISHMENT: 'participant:punish',
  FINAL_GRADE: 'grade:final',
  MISCONDUCT: 'participant:flag_misconduct',
  SESSION_END: 'session:end',
});

export const SHADOW_FORBIDDEN_SET = Object.freeze(new Set(Object.values(SHADOW_FORBIDDEN_ACTIONS)));

// ── Allowed suggestion action types (soft suggestions, teacher decides) ──
// Faqat ushbu "nazorat" action'lari taklif sifatida berilishi mumkin.
export const SHADOW_ALLOWED_ACTIONS = Object.freeze({
  REVOTE: 'revote:open',                 // teacher revote ochishi mumkin
  DISCUSS: 'discuss:start',              // discussion boshlash
  PAUSE: 'question:pause',               // think-time uzaytirish
  SLOW_DOWN: 'pace:slow',                // sur'atni pasaytirish (recommendation)
  RETRY_QUESTION: 'question:retry',      // bir xil savolni qayta o'qitish
  HINGE_REVIEW: 'content:hinge_review',  // hinge miskonsepsiya ko'rib chiqish
});

export const SHADOW_ALLOWED_SET = Object.freeze(new Set(Object.values(SHADOW_ALLOWED_ACTIONS)));

// ── Item 3: strict suggestion schema ──
// LLM/adapter output'i shu schema'ga parse qilinadi. Schema'dan
// tashqari narsa (extra key) → parse fail → suggestion tushiriladi.
export const SUGGESTION_SCHEMA = z
  .object({
    kind: z.enum(['intervention', 'question', 'pace', 'climate']),
    message: z.string().min(1).max(280),
    // Ixtiyoriy soft action — faqat SHADOW_ALLOWED_ACTIONS dan.
    action: z.string().optional().nullable(),
    // 0..1 — AI ishonch darajasi (card'da ko'rsatiladi)
    confidence: z.number().min(0).max(1).optional().default(0.5),
    // Subgroup'ga tegishli bo'lsa — qaysi guruh (de-identified id).
    subgroupId: z.string().min(1).max(32).optional().nullable(),
  })
  .strict();

export const SUGGESTION_VERSION = 'shadow_suggestion_v1';

/**
 * Item 3: raw outputni strict schema bilan parse qilish.
 * @param {unknown} raw
 * @returns {{ ok: true, suggestion: object } | { ok: false, error: string }}
 */
export function parseSuggestion(raw) {
  const parsed = SUGGESTION_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues?.[0];
    return {
      ok: false,
      error: first ? `${first.path?.join('.') || 'value'}: ${first.message}` : 'invalid suggestion',
    };
  }
  return { ok: true, suggestion: parsed.data };
}

/**
 * Item 8: suggestion'da forbidden action bo'lsa rad etish.
 * Bu ikkinchi himoya qatlami — parse'dan keyin ham tekshiriladi,
 * chunki `action` string'i schema'dan o'tib qolishi mumkin (enum emas).
 * @param {object} suggestion — parseSuggestion'dan o'tgan suggestion
 * @returns {string|null} — forbidden bo'lsa reason, aks holda null
 */
export function assertSuggestionAllowed(suggestion) {
  const action = suggestion?.action;
  if (!action) return null;
  if (SHADOW_FORBIDDEN_SET.has(action)) {
    return `forbidden-action:${action}`;
  }
  if (!SHADOW_ALLOWED_SET.has(action)) {
    return `unknown-action:${action}`;
  }
  return null;
}

/**
 * Item 1: rule engine outputini baseline sifatida saqlash.
 * Hinge / evidence / confusion / first-vote natijalaridan structured
 * baseline yig'iladi. Baseline shadow evaluation'da "to'g'ri javob"
 * solishtirish nuqtasi sifatida ishlatiladi (item 9 correctness).
 *
 * @param {object} input
 * @param {object} [input.evidence] — evidence-service computeQuestionEvidence natijasi
 * @param {object} [input.hinge]    — hinge-engine recommendHingeAction natijasi
 * @param {object} [input.confusion] — confusion-service aggregate natijasi
 * @param {object} [input.votes]    — { total, correctCount, distribution }
 * @returns {object} — baseline snapshot (de-identified)
 */
export function buildShadowBaseline({ evidence = {}, hinge = null, confusion = null, votes = null } = {}) {
  // Evidence'dan faqat aggregate (PII yo'q) — participant bo'yicha hech narsa.
  const agg = {
    participationRate: clamp01(evidence.participationRate),
    accuracyRate: clamp01(evidence.accuracyRate),
    responseTimeMs: safeNum(evidence.responseTimeMs),
    voteShiftAfterDiscussion: clamp01(evidence.voteShiftAfterDiscussion),
  };
  const hingeOut = hinge?.recommendation || null;
  const confusionOut = confusion?.total
    ? { count: confusion.total, rate: clamp01(confusion.counts?.confused / confusion.total) }
    : null;
  return {
    version: 'shadow_baseline_v1',
    at: Date.now(),
    aggregate: agg,
    hinge: hingeOut,
    confusion: confusionOut,
    votes: votes
      ? { total: safeNum(votes.total), correctRate: clamp01(votes.correctRate) }
      : null,
  };
}

/**
 * Item 2: LLM adapterga yuboriladigan de-identified structured input.
 * Faqat baseline + config'ning pedagogik qismi — student nomlari,
 * free-text, session code, join code KIRMAYDI.
 *
 * @param {object} baseline — buildShadowBaseline natijasi
 * @param {object} [config] — session config (ai/playback/scoring qismi)
 * @param {object} [context] — { pace, phase, questionIndex }
 * @returns {object} — safe input (adapter'ga beriladi)
 */
export function buildShadowInput({ baseline, config = {}, context = {} } = {}) {
  const ai = config.ai || {};
  const playback = config.playback || {};
  const scoring = config.scoring || {};
  return {
    baseline,
    pedagogy: {
      pace: context.pace || 'instructor',
      phase: context.phase || 'UNKNOWN',
      questionIndex: safeNum(context.questionIndex),
      cohostMode: ai.cohostMode || 'shadow',
      defaultThinkSeconds: safeNum(playback.thinkSeconds),
      scoreMode: scoring.mode || 'unknown',
    },
  };
}

/**
 * Item 9: shadow run'ni baholash.
 * Har bir run uchun evaluation metrics qaytaradi:
 *  - correctness: baseline (rule engine) bilan moslik
 *  - falseInterruption: teacher dismiss qilgan suggestion
 *  - acceptance: teacher accept qilgan
 *  - subgroupEffect: subgroupId ko'rsatilgan run'lar uchun kuzatuv
 *  - latencyMs / costUs: adapter'dan kelgan
 *
 * @param {object} input
 * @param {object} input.suggestion — final suggestion (allowed)
 * @param {object} [input.baseline]  — buildShadowBaseline natijasi
 * @param {string} [input.decision]  — 'accepted' | 'dismissed' | 'pending'
 * @param {number} [input.latencyMs]
 * @param {number} [input.costUs]
 * @returns {object} — evaluation record
 */
export function evaluateShadowRun({ suggestion, baseline = null, decision = 'pending', latencyMs = null, costUs = null } = {}) {
  // Correctness: baseline hinge recommendation bilan suggestion action
  // mos bo'lsa → correct. Hinge yo'q bo'lsa — neytral (null).
  let correctness = null;
  if (baseline?.hinge && suggestion?.action) {
    correctness = hingeActionMatchesSuggestion(baseline.hinge, suggestion.action) ? 1 : 0;
  }
  return {
    version: SUGGESTION_VERSION,
    at: Date.now(),
    suggestionId: suggestion?.id || null,
    kind: suggestion?.kind || 'unknown',
    action: suggestion?.action || null,
    decision,
    accepted: decision === 'accepted',
    dismissed: decision === 'dismissed',
    correctness,
    falseInterruption: decision === 'dismissed' ? 1 : 0,
    subgroup: suggestion?.subgroupId ? { subgroupId: suggestion.subgroupId } : null,
    latencyMs: latencyMs === null ? null : Math.max(0, latencyMs),
    costUs: costUs === null ? null : Math.max(0, costUs),
  };
}

/**
 * Item 9: hinge baseline va suggestion action mosligini tekshiradi.
 * Hinge recommendation'ning action'iga mos/ekvivalent soft action.
 */
function hingeActionMatchesSuggestion(hingeAction, suggestionAction) {
  const map = {
    review: SHADOW_ALLOWED_ACTIONS.HINGE_REVIEW,
    revote: SHADOW_ALLOWED_ACTIONS.REVOTE,
    discuss: SHADOW_ALLOWED_ACTIONS.DISCUSS,
    slow_down: SHADOW_ALLOWED_ACTIONS.SLOW_DOWN,
    retry: SHADOW_ALLOWED_ACTIONS.RETRY_QUESTION,
    pause: SHADOW_ALLOWED_ACTIONS.PAUSE,
  };
  // Hinge recommendation'lari katta harfda keladi (MOVE_ON/DISCUSS/RETEACH) —
  // normalize qilamiz, aks holda correctness 0 bo'lib qoladi.
  return map[String(hingeAction || '').toLowerCase()] === suggestionAction;
}

/**
 * Item 10: shadow evaluation gate.
 * Suggestion mode'ga o'tishga ruxsat berishdan oldin yig'ilgan
 * run'lar bo'yicha gate hisoblanadi.
 *
 * @param {object} input
 * @param {Array<object>} input.runs — evaluateShadowRun natijalari
 * @param {object} [input.thresholds]
 * @param {number} [input.thresholds.minRuns=10]       — minimal run soni
 * @param {number} [input.thresholds.minAcceptance=0.5] — accept darajasi
 * @param {number} [input.thresholds.minCorrectness=0.5] — baseline bilan moslik (null'lar hisobga olinmaydi)
 * @param {number} [input.thresholds.maxFalseInterruption=0.4] — dismiss ulushi chegarasi
 * @param {number} [input.thresholds.maxP95LatencyMs=3000]
 * @returns {{ pass: boolean, reasons: string[], stats: object }}
 */
export function computeShadowGate({ runs = [], thresholds = {} } = {}) {
  const t = {
    minRuns: thresholds.minRuns ?? 10,
    minAcceptance: thresholds.minAcceptance ?? 0.5,
    minCorrectness: thresholds.minCorrectness ?? 0.5,
    maxFalseInterruption: thresholds.maxFalseInterruption ?? 0.4,
    maxP95LatencyMs: thresholds.maxP95LatencyMs ?? 3000,
  };
  if (runs.length === 0) {
    return { pass: false, reasons: ['no-runs'], stats: {} };
  }
  const decided = runs.filter((r) => r.decision === 'accepted' || r.decision === 'dismissed');
  const accepted = runs.filter((r) => r.accepted).length;
  const dismissed = runs.filter((r) => r.dismissed).length;
  const withCorrectness = runs.filter((r) => r.correctness !== null);
  const correctnessSum = withCorrectness.reduce((a, r) => a + r.correctness, 0);
  const latencies = runs.map((r) => r.latencyMs).filter((v) => v !== null).sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null;

  const stats = {
    runs: runs.length,
    decided: decided.length,
    acceptanceRate: decided.length ? accepted / decided.length : 0,
    correctnessRate: withCorrectness.length ? correctnessSum / withCorrectness.length : null,
    falseInterruptionRate: runs.length ? dismissed / runs.length : 0,
    p95LatencyMs: p95,
  };

  const reasons = [];
  if (runs.length < t.minRuns) reasons.push(`min-runs:${runs.length}<${t.minRuns}`);
  if (stats.acceptanceRate < t.minAcceptance) reasons.push(`acceptance:${round2(stats.acceptanceRate)}<${t.minAcceptance}`);
  if (stats.correctnessRate !== null && stats.correctnessRate < t.minCorrectness) reasons.push(`correctness:${round2(stats.correctnessRate)}<${t.minCorrectness}`);
  if (stats.falseInterruptionRate > t.maxFalseInterruption) reasons.push(`false-interruption:${round2(stats.falseInterruptionRate)}>${t.maxFalseInterruption}`);
  if (p95 !== null && p95 > t.maxP95LatencyMs) reasons.push(`latency-p95:${p95}>${t.maxP95LatencyMs}`);

  return { pass: reasons.length === 0, reasons, stats };
}

/**
 * Item 10: gate'dan o'tgan bo'lsa suggestion mode'ga o'tish mumkin.
 */
export function shouldPromoteToSuggestion({ runs = [], thresholds = {} } = {}) {
  const gate = computeShadowGate({ runs, thresholds });
  return {
    canPromote: gate.pass,
    reasons: gate.reasons,
    stats: gate.stats,
    nextMode: gate.pass ? 'suggestion' : 'shadow',
  };
}

/**
 * Item 6: teacher accept/dismiss decision'ni record qilish.
 * Deterministic record — run'lar ro'yxatiga qo'shiladi va gate'da
 * ishlatiladi. (Persistence DB'da routes/socket tomonidan.)
 */
export function recordShadowDecision({ suggestion, decision = 'pending', latencyMs = null, costUs = null, baseline = null }) {
  if (decision !== 'accepted' && decision !== 'dismissed' && decision !== 'pending') {
    return { ok: false, error: `invalid-decision:${decision}` };
  }
  const forbidden = assertSuggestionAllowed(suggestion);
  if (forbidden) return { ok: false, error: forbidden };
  return { ok: true, evaluation: evaluateShadowRun({ suggestion, baseline, decision, latencyMs, costUs }) };
}

// ── Small pure helpers ──
function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round2(v) {
  return Math.round(v * 100) / 100;
}

export default {
  SHADOW_FORBIDDEN_ACTIONS,
  SHADOW_FORBIDDEN_SET,
  SHADOW_ALLOWED_ACTIONS,
  SHADOW_ALLOWED_SET,
  SUGGESTION_SCHEMA,
  SUGGESTION_VERSION,
  parseSuggestion,
  assertSuggestionAllowed,
  buildShadowBaseline,
  buildShadowInput,
  evaluateShadowRun,
  computeShadowGate,
  shouldPromoteToSuggestion,
  recordShadowDecision,
};
