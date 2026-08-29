/**
 * Deborah — Written AI Grading Shadow Mode (pure logic)
 *
 * Prompt 51 — rubric/evidence structured AI draft'ni student/final
 * grade'dan YASHIRIN shadow rejimda ishlatish (research.md §7.4 rubric
 * model, §7.5 confidence routing, §7.7 metrics, §20 Phase 3). This module
 * is PURE (no I/O, no globals):
 *
 *   - PII redaction: redactPii — provider'ga student identity kirmaydi
 *     (name/ID/phone/email/address) → [REDACTED].
 *   - Prompt template: buildPromptTemplate — rubric criterion, levels,
 *     anchors, redacted response; structured JSON chiqish buyrug'i.
 *   - Strict schema: enforceCriterionSchema — LLM output JSON'ini
 *     validate (criterion, score, evidence, confidence); invalid → reject.
 *   - Evidence span: validateEvidenceSpan — span bounds response ichida,
 *     concept bog'langan, non-empty.
 *   - Pipeline: extractConceptEvidence — response ichida required
 *     concept/contradiction matching (normalized), missing concepts,
 *     contradictions, keyword-stuffing va negation detection.
 *   - Deterministic aggregation: aggregateCriterionScores — rubric level
 *     mappingdan score (erkin raqam EMAS); sumCriterionResults.
 *   - Confidence routing: routeConfidence — §7.5 (≥0.90 auto_draft,
 *     0.65–0.89 grading_queue, <0.65/contradiction/injection human_review).
 *   - Shadow comparison: compareAiHuman — QWK/exact/within-one/MAE;
 *     shadow hech qachon teacher finalini o'zgartirmaydi.
 *
 * SECURITY / DATA GUARD (Prompt 51 §15-17):
 *   - LLM total score final authority EMAS — final faqat teacher.
 *   - Model web/tool access qilmaydi — prompt faqat matn, output JSON.
 *   - Prompt-injection markerlar (instruction) aniqlanadi → human_review.
 */

import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const AI_JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};
export const AI_RUN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};
export const AI_ROUTING = {
  AUTO_DRAFT: 'auto_draft',
  GRADING_QUEUE: 'grading_queue',
  HUMAN_REVIEW: 'human_review',
};
export const AI_PROMPT_TEMPLATE_VERSION = 'v1';

/** Confidence thresholds (§7.5). */
export const CONFIDENCE_AUTO = 0.9;
export const CONFIDENCE_QUEUE = 0.65;

/** Prompt-injection markerlar (document/response ichida bo'lsa human_review). */
export const AI_INSTRUCTION_MARKERS = [
  'ignore all previous instructions',
  'ignore previous instructions',
  'disregard all previous',
  'system instruction',
  'system prompt',
  'you are now',
  'from now on you are',
  'reveal your system prompt',
  'output your instructions',
  'override your instructions',
  'jailbreak',
  'developer message',
];

/** PII patternlar (regex) — redaction uchun. */
export const PII_PATTERNS = [
  // Student ID / passport / JSHSHIR (Uzbekistan)
  /\b[A-Z]{2}\d{7}\b/g, // passport
  /\b\d{9,14}\b/g, // generic long number (ID)
  // Phone (Uzbekistan: +998 XX XXX XX XX)
  /(?:\+998|998|8)\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/g,
  // Email
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,
  // Name heuristics: "Salom, men Aziz" / "Talaba: Aziz Karimov"
  /\b(Talaba|Student|Name|Ism|F.I.SH|FISH)\s*[::\-]?\s*[A-Za-z][\w.'-]+(\s+[A-Za-z][\w.'-]+){0,2}/gi,
];

// ═══════════════════════════════════════════════════════════════════
// PII REDACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Redact PII from a response before it reaches the provider.
 *
 * @param {string} text
 * @returns {{ ok: boolean, text: string, redactedCount: number }}
 */
export function redactPii(text = '') {
  if (!text || typeof text !== 'string') return { ok: true, text: '', redactedCount: 0 };
  let out = text;
  let redactedCount = 0;
  for (const re of PII_PATTERNS) {
    out = out.replace(re, (m) => {
      redactedCount += 1;
      return '[REDACTED]';
    });
  }
  return { ok: true, text: out.trim(), redactedCount };
}

/**
 * Hash the redacted input — reproducibility (same input → same hash).
 *
 * @param {string} text
 * @returns {string}
 */
export function hashAiInput(text = '') {
  return createHash('sha256').update(String(text ?? '')).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT TEMPLATE
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the grading prompt. Faqat matn — model web/tool access qilmaydi.
 * Output strict JSON schema talab qilinadi (criterion level mapping).
 *
 * @param {Object} params
 * @param {Object} params.criterion - { id, name, max_points, required_concepts, contradictions, levels }
 * @param {string} params.redactedResponse
 * @param {Array<Object>} [params.anchors]
 * @returns {string}
 */
export function buildPromptTemplate({ criterion = {}, redactedResponse = '', anchors = [] } = {}) {
  const levels = Array.isArray(criterion.levels) ? criterion.levels : [];
  const concepts = Array.isArray(criterion.required_concepts) ? criterion.required_concepts : [];
  const contradictions = Array.isArray(criterion.contradictions) ? criterion.contradictions : [];

  const anchorBlock = anchors.length
    ? `Calibration anchors:\n${anchors.map((a, i) => `${i + 1}. [score ${a.expected_score}] ${a.response_text}`).join('\n')}`
    : '';

  return [
    'You are a grading assistant for a rubric-based assessment.',
    'Grade the student response against the rubric criterion ONLY.',
    'The score MUST be one of the exact rubric level points — never a free number.',
    '',
    `Criterion: ${criterion.name || 'untitled'}`,
    `Max points: ${criterion.max_points ?? 0}`,
    `Required concepts: ${concepts.map((c) => c.concept || c).join('; ')}`,
    `Contradictions to flag: ${contradictions.join('; ') || '(none)'}`,
    `Levels (points → descriptor): ${levels.map((l) => `${l.points}=${l.descriptor}`).join(' | ')}`,
    ...(anchorBlock ? [anchorBlock] : []),
    '',
    'Student response (PII already redacted):',
    `"""${redactedResponse}"""`,
    '',
    'Return ONLY a JSON object with this exact schema (no markdown, no commentary):',
    '{"criterion_score": <number>, "level": <number>, "evidence_spans": [{"concept": "<concept>", "start": <number>, "end": <number>, "text": "<exact span>"}], "missing_concepts": ["<concept>"], "contradictions_found": ["<contradiction>"], "confidence": <0..1>, "feedback": "<brief rubric-grounded feedback>"}',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// STRICT CRITERION JSON SCHEMA
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a provider's criterion output against the strict schema.
 * Invalid JSON / wrong types / score not in levels → { ok: false }.
 *
 * @param {Object} params
 * @param {string} params.raw - provider raw text (JSON expected)
 * @param {Array<Object>} params.levels - [{ points, descriptor }]
 * @param {string} params.responseText - original redacted response
 * @returns {{ ok: boolean, error?: string, parsed?: Object }}
 */
export function enforceCriterionSchema({ raw = '', levels = [], responseText = '' } = {}) {
  let parsed;
  try {
    parsed = typeof raw === 'object' ? raw : JSON.parse(String(raw || '').trim());
  } catch (_) {
    return { ok: false, error: 'invalid JSON from provider' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'provider output must be an object' };
  }
  const allowedPoints = new Set(levels.map((l) => Number(l.points)));
  const score = Number(parsed.criterion_score);
  if (!Number.isFinite(score) || !allowedPoints.has(score)) {
    return { ok: false, error: `criterion_score ${parsed.criterion_score} is not one of rubric levels [${[...allowedPoints].join(', ')}]` };
  }
  // Prompt schema "level" ni talab qiladi — valid index bo'lishi va
  // ko'rsatilgan score bilan mos kelishi shart (inconsistent output → reject).
  const level = Number(parsed.level);
  if (!Number.isInteger(level) || level < 0 || level >= levels.length) {
    return { ok: false, error: `level ${parsed.level} is not a valid rubric level index (0..${levels.length - 1})` };
  }
  const levelPoints = Number(levels[level]?.points);
  if (Number.isFinite(levelPoints) && levelPoints !== score) {
    return { ok: false, error: `level ${level} points (${levelPoints}) does not match criterion_score ${score}` };
  }
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, error: 'confidence must be a number in [0,1]' };
  }
  if (!Array.isArray(parsed.evidence_spans)) {
    return { ok: false, error: 'evidence_spans must be an array' };
  }
  if (!Array.isArray(parsed.missing_concepts)) {
    return { ok: false, error: 'missing_concepts must be an array' };
  }
  if (!Array.isArray(parsed.contradictions_found)) {
    return { ok: false, error: 'contradictions_found must be an array' };
  }
  if (typeof parsed.feedback !== 'string') {
    return { ok: false, error: 'feedback must be a string' };
  }
  // Evidence span validation (bounds + non-empty)
  for (const span of parsed.evidence_spans) {
    const v = validateEvidenceSpan({ span, responseText });
    if (!v.ok) return { ok: false, error: v.error };
  }
  return { ok: true, parsed };
}

/**
 * Validate a single evidence span — bounds inside response, non-empty.
 *
 * @param {Object} params
 * @param {Object} params.span - { concept, start, end, text }
 * @param {string} params.responseText
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateEvidenceSpan({ span = {}, responseText = '' } = {}) {
  if (!span || typeof span !== 'object') return { ok: false, error: 'evidence span must be an object' };
  if (!span.concept || typeof span.concept !== 'string') return { ok: false, error: 'evidence span concept is required' };
  const start = Number(span.start);
  const end = Number(span.end);
  const len = String(responseText ?? '').length;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return { ok: false, error: 'evidence span start/end must be integers' };
  }
  if (start < 0 || end > len || start >= end) {
    return { ok: false, error: `evidence span [${start},${end}) out of response bounds (0..${len})` };
  }
  const text = String(span.text ?? '');
  if (!text.trim()) return { ok: false, error: 'evidence span text is empty' };
  // Span text response bilan mos kelishi kerak (fabricated span → reject)
  const actual = String(responseText).slice(start, end);
  if (text.trim() !== actual.trim()) {
    return { ok: false, error: 'evidence span text does not match response slice' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// CONCEPT / EVIDENCE / CONTRADICTION PIPELINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize text for concept matching (lowercase, spaces).
 * @param {string} s
 * @returns {string}
 */
export function normalizeConceptText(s = '') {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Detect prompt-injection markers in a response → mandatory human review.
 *
 * @param {string} text
 * @returns {{ ok: boolean, markers: string[] }}
 */
export function detectAiInjection(text = '') {
  const lower = String(text ?? '').toLowerCase();
  const markers = AI_INSTRUCTION_MARKERS.filter((m) => lower.includes(m));
  return { ok: markers.length === 0, markers };
}

/**
 * Detect keyword stuffing — required concept aynan bir joyda ko'p marta
 * takrorlangan, kontekstsiz (adversarial test §7.7).
 *
 * @param {Object} params
 * @param {string} params.response
 * @param {Array<Object>} params.requiredConcepts
 * @param {number} [params.threshold] - bir concept uchun max takrorlanish
 * @returns {{ ok: boolean, stuffed: Array<{ concept: string, count: number }> }}
 */
export function detectKeywordStuffing({ response = '', requiredConcepts = [], threshold = 8 } = {}) {
  const norm = normalizeConceptText(response);
  const stuffed = [];
  for (const c of requiredConcepts) {
    const concept = normalizeConceptText(c.concept || c);
    if (!concept) continue;
    const re = new RegExp(`\\b${concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const count = (norm.match(re) || []).length;
    if (count >= threshold) stuffed.push({ concept: c.concept || c, count });
  }
  return { ok: stuffed.length === 0, stuffed };
}

/**
 * Detect negation — concept "not X" / "X emas" / "X yo'q" (adversarial §7.7).
 *
 * @param {Object} params
 * @param {string} params.response
 * @param {Array<Object>} params.requiredConcepts
 * @returns {{ ok: boolean, negated: Array<{ concept: string }> }}
 */
export function detectNegation({ response = '', requiredConcepts = [] } = {}) {
  const lower = String(response ?? '').toLowerCase();
  const negated = [];
  for (const c of requiredConcepts) {
    const concept = normalizeConceptText(c.concept || c);
    if (!concept) continue;
    const negPatterns = [
      `not ${concept}`,
      `no ${concept}`,
      `${concept} not`,
      `${concept} emas`,
      `${concept} yo'q`,
      `${concept} yoq`,
      `${concept} bo'lmaydi`,
      `${concept} is not`,
      `${concept} isn't`,
      `${concept} doesn't`,
      `without ${concept}`,
      `lacks ${concept}`,
    ];
    if (negPatterns.some((p) => lower.includes(p))) {
      negated.push({ concept: c.concept || c });
    }
  }
  return { ok: negated.length === 0, negated };
}

/**
 * Concept/evidence/contradiction pipeline — required concept present?,
 * contradiction found?, missing concepts, keyword-stuffing, negation.
 *
 * @param {Object} params
 * @param {string} params.response
 * @param {Array<Object>} params.requiredConcepts
 * @param {Array<string>} params.contradictions
 * @returns {{
 *   ok: boolean,
 *   found: string[],
 *   missing: string[],
 *   contradictionsFound: string[],
 *   stuffing: Array<{concept: string, count: number}>,
 *   negated: Array<{concept: string}>,
 *   injection: string[]
 * }}
 */
export function extractConceptEvidence({ response = '', requiredConcepts = [], contradictions = [] } = {}) {
  const norm = normalizeConceptText(response);
  const lower = String(response ?? '').toLowerCase();
  const found = [];
  const missing = [];
  for (const c of requiredConcepts) {
    const concept = normalizeConceptText(c.concept || c);
    if (!concept) continue;
    if (norm.includes(concept)) found.push(c.concept || c);
    else missing.push(c.concept || c);
  }
  const contradictionsFound = (contradictions || []).filter((cd) => lower.includes(String(cd).toLowerCase()));
  const stuffing = detectKeywordStuffing({ response, requiredConcepts }).stuffed;
  const negated = detectNegation({ response, requiredConcepts }).negated;
  const injection = detectAiInjection(response).markers;
  return {
    ok: missing.length === 0 && contradictionsFound.length === 0 && stuffing.length === 0 && negated.length === 0 && injection.length === 0,
    found,
    missing,
    contradictionsFound,
    stuffing,
    negated,
    injection,
  };
}

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC SCORE AGGREGATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Aggregate per-criterion results deterministically. Score model erkin
 * raqam emas — rubric level mappingdan keladi.
 *
 * @param {Array<Object>} criterionResults - [{ score, weight }]
 * @returns {{ total: number, weightedTotal: number, count: number }}
 */
export function aggregateCriterionScores(criterionResults = []) {
  const count = criterionResults.length;
  const total = Number(criterionResults.reduce((s, c) => s + Number(c.score || 0), 0).toFixed(2));
  const weightedTotal = Number(
    criterionResults.reduce((s, c) => s + Number(c.score || 0) * Number(c.weight ?? 1), 0).toFixed(2)
  );
  return { total, weightedTotal, count };
}

/**
 * Compute the shadow total score from a run's criterion results.
 *
 * @param {Array<Object>} results - [{ score, weight }]
 * @returns {number}
 */
export function sumCriterionResults(results = []) {
  return aggregateCriterionScores(results).weightedTotal;
}

// ═══════════════════════════════════════════════════════════════════
// CONFIDENCE ROUTING (§7.5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Route a shadow run based on confidence + risk flags.
 * §7.5: ≥0.90 auto_draft; 0.65–0.89 grading_queue; <0.65, contradiction,
 * prompt injection, unusual → human_review. Summative → AI draft only.
 *
 * @param {Object} params
 * @param {number} params.confidence
 * @param {boolean} [params.contradiction]
 * @param {boolean} [params.injection]
 * @param {boolean} [params.keywordStuffing]
 * @param {boolean} [params.negation]
 * @param {boolean} [params.summative]
 * @returns {{ decision: string, reason: string }}
 */
export function routeConfidence({
  confidence = 0,
  contradiction = false,
  injection = false,
  keywordStuffing = false,
  negation = false,
  summative = false,
} = {}) {
  const c = Number(confidence);
  if (contradiction) return { decision: AI_ROUTING.HUMAN_REVIEW, reason: 'contradiction found' };
  if (injection) return { decision: AI_ROUTING.HUMAN_REVIEW, reason: 'prompt-injection markers' };
  if (keywordStuffing) return { decision: AI_ROUTING.HUMAN_REVIEW, reason: 'keyword stuffing' };
  if (negation) return { decision: AI_ROUTING.HUMAN_REVIEW, reason: 'negation detected' };
  if (!Number.isFinite(c) || c < CONFIDENCE_QUEUE) {
    return { decision: AI_ROUTING.HUMAN_REVIEW, reason: `low confidence ${c}` };
  }
  if (summative) {
    return { decision: AI_ROUTING.GRADING_QUEUE, reason: 'summative — teacher approval required' };
  }
  if (c >= CONFIDENCE_AUTO) return { decision: AI_ROUTING.AUTO_DRAFT, reason: `high confidence ${c}` };
  return { decision: AI_ROUTING.GRADING_QUEUE, reason: `moderate confidence ${c}` };
}

// ═══════════════════════════════════════════════════════════════════
// SHADOW COMPARISON (AI vs HUMAN)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compare AI shadow scores against human scores (no final authority).
 * Metrics (§7.7): exact agreement, within-one, MAE, QWK.
 *
 * @param {Object} params
 * @param {Array<number>} params.aiScores
 * @param {Array<number>} params.humanScores
 * @returns {{
 *   ok: boolean, pairs: number,
 *   exactAgreement: number, withinOneAgreement: number,
 *   mae: number, qwk: number|null
 * }}
 */
export function compareAiHuman({ aiScores = [], humanScores = [] } = {}) {
  if (aiScores.length !== humanScores.length || aiScores.length === 0) {
    return { ok: false, pairs: 0, exactAgreement: 0, withinOneAgreement: 0, mae: 0, qwk: null };
  }
  const n = aiScores.length;
  let exact = 0;
  let withinOne = 0;
  let absSum = 0;
  for (let i = 0; i < n; i++) {
    const a = Number(aiScores[i]);
    const h = Number(humanScores[i]);
    const delta = Math.abs(a - h);
    if (delta === 0) exact += 1;
    if (delta <= 1) withinOne += 1;
    absSum += delta;
  }
  return {
    ok: true,
    pairs: n,
    exactAgreement: Number((exact / n).toFixed(4)),
    withinOneAgreement: Number((withinOne / n).toFixed(4)),
    mae: Number((absSum / n).toFixed(4)),
    qwk: computeQwk(aiScores, humanScores),
  };
}

/**
 * Quadratic Weighted Kappa (§7.7) — ordinal agreement.
 * Linear weights: w = 1 - (|i-j| / (k-1))^2.
 *
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {number|null}
 */
export function computeQwk(a = [], b = []) {
  if (a.length !== b.length || a.length === 0) return null;
  const min = Math.min(...a, ...b);
  const max = Math.max(...a, ...b);
  const k = max - min + 1;
  if (k <= 1) return 1; // single category → perfect
  const n = a.length;

  // Confusion matrix
  const mat = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
    const ai = Math.round(av) - min;
    const bi = Math.round(bv) - min;
    if (ai < 0 || ai >= k || bi < 0 || bi >= k) return null;
    mat[ai][bi] += 1;
  }

  const weights = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => 1 - ((i - j) ** 2) / ((k - 1) ** 2))
  );

  const rowSum = mat.map((r) => r.reduce((s, v) => s + v, 0));
  const colSum = Array.from({ length: k }, (_, j) => mat.reduce((s, r) => s + r[j], 0));

  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      observed += weights[i][j] * mat[i][j];
      expected += weights[i][j] * ((rowSum[i] * colSum[j]) / n);
    }
  }
  // κ = (p_o − p_e) / (1 − p_e) with p_o = observed/n, p_e = expected/n
  // ⇒ (observed − expected) / (n − expected). Perfect agreement → 1.
  const denom = n - expected;
  if (!Number.isFinite(observed) || !Number.isFinite(expected) || denom === 0) {
    return expected === observed ? 1 : null;
  }
  return Number(((observed - expected) / denom).toFixed(4));
}

/**
 * Shadow guard — AI run hech qachon teacher finalini o'zgartirmaydi.
 * @returns {{ ok: true, message: string }}
 */
export function shadowNeverChangesFinal() {
  return { ok: true, message: 'shadow run is advisory only — teacher final is authoritative' };
}
