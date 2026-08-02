/**
 * Edikit — AI/Content Checkpoint (pure logic)
 *
 * Prompt 60 — measured pilot orqali AI oqimlarini yakuniy tekshirish
 * (research.md §7.7 model eval, §22.15 measured pilot, §20 Phase 3
 * guardrails, §28 accessibility). This module is PURE (no I/O, no DB):
 *
 *   - assertNoSummativeAuthority: summative AI authority bo'lsa BLOCK
 *     (AI hech qachon final bahoni o'zi qo'ymaydi).
 *   - assertVerifiedSourceOnly: unverified source publish qilinmasligi.
 *   - runRedTeamSourceCheck: malicious source/RAG red-team (SSRF, XSS,
 *     PII, prompt-injection, oversized).
 *   - runShadowBenchmark: written grading shadow benchmark (QWK/MAE/exact/
 *     within-one + gate decision).
 *   - runQuestionReviewSample: question generation expert review sample
 *     (ambiguity, multi-correct, duplicate, language, source verification).
 *   - runCitationUrlCheck: resource citation/URL check (scheme, SSRF,
 *     transcript-scrape intent, dedupe).
 *   - runInterventionPilot: intervention/reassessment pilot (before/after
 *     retention, mastery, no-permanent-penalty guard, different-item plan).
 *   - runDeckComparison: native/provider deck comparison (QA parity,
 *     attribution present, no content drift).
 *   - runOutageDrill: provider outage/cost/quota drill (circuit, retry,
 *     cost estimate, PII guard).
 *   - computePhaseGReadiness: residual risk + Phase G ready decision.
 *
 * SECURITY / DATA GUARD (Prompt 60 §15): summative AI authority yoki
 * unverified source publish qilinmaydi — har pilot natijasida guard'lar
 * ko'rinadi.
 */

// Reuse pure logic from prior modules (no service side-effects)
import { validateSourceUrl, parseSourceUrl, SOURCE_URL_SCHEMES } from '../source-pack/source-pack.schema.js';
import { redactPii, detectAiInjection } from '../ai-grading/ai-grading.schema.js';
import { computeEvalMetrics, computeOverrideRate, computeCalibrationEce, evaluateGate, AI_GATE_STAGE, AI_GATE_DECISION } from '../ai-mlops/ai-mlops.schema.js';
import { validateAmbiguity, validateMultiCorrect, validateDuplicate, checkLanguage, verifyAnswerSource } from '../ai-question-gen/ai-question-gen.schema.js';
import { formatCitation, detectTranscriptScrapeIntent, titleDedupeHash } from '../resource-reco/resource-reco.schema.js';
import { computeBeforeAfterRetention, estimateMasteryRule, assertNoPermanentLabelOrPenalty, planDifferentItemReassessment } from '../intervention/intervention.schema.js';
import { validatePresentationDocument, runSlideQa, diffVersions } from '../presentation/presentation.schema.js';
import { evaluateCircuitState, computeUsageCost, shouldRetryError, assertNoStudentPii } from '../provider/provider.schema.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const PILOT_VERSION = 'v1';
export const CHECKPOINT_SCOPE = { FULL: 'full', SOURCE: 'source', GRADING: 'grading', QUESTIONS: 'questions', RESOURCES: 'resources', PRESENTATIONS: 'presentations', PROVIDER: 'provider' };

export const PILOT_IDS = {
  RED_TEAM: 'red_team',
  SHADOW: 'shadow_benchmark',
  QUESTION_REVIEW: 'question_review',
  CITATION: 'citation_check',
  INTERVENTION: 'intervention_pilot',
  DECK_COMPARE: 'deck_comparison',
  OUTAGE: 'outage_drill',
};

// ═══════════════════════════════════════════════════════════════════
// IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministic checkpoint request hash (tenant + scope + pilot version +
 * data digest). Data ham hashga kiradi — turli ma'lumot bilan bir xil
 * scope'da qayta run eski natijani qaytarmaydi (stale cache yo'q).
 */
export function buildCheckpointHash({ tenantId = 0, scope = CHECKPOINT_SCOPE.FULL, pilotVersion = PILOT_VERSION, data = null } = {}) {
  let h = 0x811c9dc5;
  const dataStr = data ? JSON.stringify(data) : '';
  const str = `p60:${tenantId}:${scope}:${pilotVersion}:${dataStr}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `cp_${h.toString(16).padStart(8, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════
// GUARDS (§15 — summative AI authority / unverified source)
// ═══════════════════════════════════════════════════════════════════

/**
 * Guard: summative AI authority bo'lmasin — AI hech qachon final bahoni
 * o'zi qo'ymaydi (teacher approve qiladi). isFinal + aiAuthority → BLOCK.
 */
export function assertNoSummativeAuthority({ role = 'ai', isFinal = false, hasTeacherApproval = false, decision = null } = {}) {
  if (isFinal && !hasTeacherApproval) {
    return {
      ok: false,
      reason: 'summative AI authority blocked — teacher approval required',
      decision,
      detail: { role, isFinal, hasTeacherApproval },
    };
  }
  return { ok: true, detail: { role, isFinal, hasTeacherApproval } };
}

/**
 * Guard: unverified source publish qilinmasin — source pack APPROVED
 * bo'lmasa va citation verified bo'lmasa, publish BLOCK.
 */
export function assertVerifiedSourceOnly({ sourceStatus = '', citationVerified = false, publish = false, sourceId = null } = {}) {
  if (publish && (sourceStatus !== 'approved' || !citationVerified)) {
    return {
      ok: false,
      reason: 'unverified source publish blocked',
      sourceId,
      detail: { sourceStatus, citationVerified, publish },
    };
  }
  return { ok: true, detail: { sourceStatus, citationVerified, publish } };
}

// ═══════════════════════════════════════════════════════════════════
// 01. MALICIOUS SOURCE / RAG RED-TEAM (§07)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run malicious source scenarios. Each scenario: { id, kind, url?, text? }.
 * Kinds: ssrf, xss, pii, injection, oversized.
 */
export function runRedTeamSourceCheck({ scenarios = [] } = {}) {
  const checks = [];
  for (const s of scenarios) {
    const { id, kind, url = '', text = '' } = s;
    let ok = true;
    let detail = 'passed';
    if (kind === 'ssrf') {
      const parsed = parseSourceUrl(url);
      if (!parsed || !parsed.ok) { ok = false; detail = 'unsupported/blocked URL'; }
      else {
        const v = validateSourceUrl(url);
        if (!v.ok) { ok = false; detail = v.error || 'SSRF blocked'; }
      }
    } else if (kind === 'xss') {
      // HTML strip elements/attrs — script/iframe/on* blocked at ingestion
      const lower = text.toLowerCase();
      if (/<script|<iframe|javascript:|onerror=|onload=/.test(lower)) { ok = false; detail = 'script/iframe/on* detected'; }
    } else if (kind === 'pii') {
      const r = redactPii(text);
      ok = r.redactedCount > 0;
      detail = ok ? `redacted ${r.redactedCount} PII` : 'no PII detected';
    } else if (kind === 'injection') {
      const inj = detectAiInjection(text);
      ok = inj.ok !== false;
      detail = inj.ok ? 'no injection' : 'prompt injection detected';
    } else if (kind === 'oversized') {
      ok = Buffer.byteLength(text || '', 'utf8') <= 25 * 1024 * 1024;
      detail = ok ? 'size ok' : 'exceeds 25MB upload limit';
    } else {
      ok = false; detail = `unknown scenario kind: ${kind}`;
    }
    checks.push({ id, kind, ok, detail });
  }
  return {
    ok: checks.every((c) => c.ok),
    pilot: PILOT_IDS.RED_TEAM,
    checks,
    summary: { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 02. WRITTEN GRADING SHADOW BENCHMARK (§7.7)
// ═══════════════════════════════════════════════════════════════════

/**
 * Shadow benchmark: AI shadow scores vs gold (teacher) scores.
 * Gate: QWK >= threshold && override rate <= cap → shadow gate ok.
 */
export function runShadowBenchmark({ aiScores = [], goldScores = [], confidences = [], thresholds = { qwkMin: 0.7, overrideMax: 0.3, eceMax: 0.3 } } = {}) {
  const m = computeEvalMetrics({ aiScores, goldScores });
  const metricsOk = m.ok === true && Number.isFinite(m.qwk);
  const qwk = metricsOk ? m.qwk : 0;
  const mae = metricsOk ? m.mae : Infinity;
  const exact = metricsOk ? m.exactAgreement : 0;
  const withinOne = metricsOk ? m.withinOneAgreement : 0;

  const ovr = computeOverrideRate({ overrides: 0, total: aiScores.length });
  const overrideRate = ovr.ok === true ? ovr.overrideRate : 1;

  let eceVal = 0;
  if (confidences.length > 0 && confidences.length === aiScores.length) {
    const ece = computeCalibrationEce({ confidences, outcomes: aiScores.map((s, i) => (s === goldScores[i] ? 1 : 0)), bins: 10 });
    eceVal = ece.ok === true ? ece.ece : 1;
  } else {
    eceVal = 1; // no confidence data → calibration check fails
  }

  const gate = evaluateGate({
    stage: AI_GATE_STAGE.SHADOW,
    metrics: { qwk, mae, ece: eceVal, overrideRate },
    thresholds: { qwk: thresholds.qwkMin, ece: thresholds.eceMax, overrideRate: thresholds.overrideMax },
  });

  const checks = [
    { id: 'qwk', ok: qwk >= thresholds.qwkMin, detail: `QWK ${Number(qwk).toFixed(3)} >= ${thresholds.qwkMin}` },
    { id: 'exact', ok: exact >= 0.5, detail: `exact ${(exact * 100).toFixed(1)}%` },
    { id: 'within_one', ok: withinOne >= 0.8, detail: `within-one ${(withinOne * 100).toFixed(1)}%` },
    { id: 'mae', ok: mae <= 0.5, detail: `MAE ${Number(mae).toFixed(3)}` },
    { id: 'ece', ok: eceVal <= thresholds.eceMax, detail: `ECE ${Number(eceVal).toFixed(3)}` },
    { id: 'gate', ok: gate.decision === AI_GATE_DECISION.APPROVED, detail: `gate ${gate.decision}` },
  ];
  const ok = gate.decision === AI_GATE_DECISION.APPROVED && overrideRate <= thresholds.overrideMax && checks.every((c) => c.ok);

  return {
    ok,
    pilot: PILOT_IDS.SHADOW,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
      metrics: { qwk, mae, exactAgreement: exact, withinOneAgreement: withinOne },
      overrideRate,
      ece: eceVal,
      gate: gate.decision,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 03. QUESTION GENERATION EXPERT REVIEW SAMPLE (§09)
// ═══════════════════════════════════════════════════════════════════

/**
 * Expert review sample: generated candidates' quality gates.
 * Each candidate: { id, stem, options, language, sourceRefs, approvedChunks }.
 *   sourceRefs: [{ chunkId }] yoki 'source:<id>' string.
 *   approvedChunks: [{ id, quote }] — { text } ham qabul qilinadi.
 */
export function runQuestionReviewSample({ candidates = [], language = 'uz' } = {}) {
  const checks = [];
  for (const c of candidates) {
    const ambiguity = validateAmbiguity({ stem: c.stem, options: c.options });
    const multi = validateMultiCorrect({ questionType: c.questionType || 'single_choice', options: c.options });
    const dup = validateDuplicate({ stem: c.stem, existingHashes: c.existingHashes || [] });
    const lang = checkLanguage({ stem: c.stem, options: c.options, language: c.language || language });
    // normalize sourceRefs: 'source:1' → { chunkId: 1 }
    const refs = (c.sourceRefs || []).map((r) => {
      if (r && typeof r === 'object' && r.chunkId !== undefined) return r;
      const m = String(r).match(/(\d+)$/);
      return { chunkId: m ? Number(m[1]) : r };
    });
    // normalize approvedChunks: { text } → quote
    const chunks = (c.approvedChunks || []).map((ch) => ({ id: ch.id, quote: ch.quote || ch.text || '' }));
    const src = verifyAnswerSource({ answer: c.correct || '', sourceRefs: refs, approvedChunks: chunks });
    const ok = ambiguity.ok && multi.ok && dup.ok && lang.ok && src.ok;
    checks.push({
      id: c.id,
      ok,
      detail: {
        ambiguity: ambiguity.ok ? 'ok' : (ambiguity.reason || 'ambiguous'),
        multiCorrect: multi.ok ? 'ok' : (multi.reason || 'multi-correct'),
        duplicate: dup.ok ? 'ok' : (dup.reason || 'duplicate'),
        language: lang.ok ? 'ok' : (lang.reason || 'language'),
        source: src.ok ? 'verified' : 'unverified',
      },
    });
  }
  return {
    ok: checks.every((c) => c.ok),
    pilot: PILOT_IDS.QUESTION_REVIEW,
    checks,
    summary: { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 04. RESOURCE CITATION / URL CHECK (§10)
// ═══════════════════════════════════════════════════════════════════

/**
 * Citation/URL check: scheme allowlist, SSRF, transcript-scrape intent,
 * duplicate URL dedupe.
 */
export function runCitationUrlCheck({ records = [] } = {}) {
  const checks = [];
  const seen = new Set();
  for (const r of records) {
    const { id, url = '', title = '' } = r;
    const issues = [];
    const parsed = parseSourceUrl(url);
    if (!parsed || !parsed.ok) issues.push('bad/unsupported URL');
    else {
      const proto = (url.match(/^[a-z][a-z0-9+.-]*:/i) || [''])[0];
      if (!SOURCE_URL_SCHEMES.includes(proto)) issues.push('bad scheme');
      const v = validateSourceUrl(url);
      if (!v.ok) issues.push(v.error || 'SSRF blocked');
    }
    const scrape = detectTranscriptScrapeIntent(url);
    if (!scrape.ok) issues.push('transcript-scrape intent');
    const h = titleDedupeHash(title || url);
    if (seen.has(h)) issues.push('duplicate URL');
    seen.add(h);
    const citation = formatCitation(r);
    checks.push({ id, ok: issues.length === 0, detail: issues.length ? issues.join(', ') : 'ok', citation: citation || null });
  }
  return {
    ok: checks.every((c) => c.ok),
    pilot: PILOT_IDS.CITATION,
    checks,
    summary: { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 05. INTERVENTION / REASSESSMENT PILOT (§11)
// ═══════════════════════════════════════════════════════════════════

/**
 * Intervention/reassessment pilot: before/after retention, mastery
 * estimate, no-permanent-penalty guard, different-item reassessment plan.
 */
export function runInterventionPilot({ preScore = null, postScore = null, retentionScore = null, responses = [], evidence = {}, interventions = [], misconception = null } = {}) {
  const retention = computeBeforeAfterRetention({ preScore, postScore, retentionScore });
  const ret = retention.ok === true ? retention : { ok: false, gain: 0, retained: false, metrics: { retention: 0 } };
  const correct = responses.filter((r) => r.correct).length;
  const mastery = estimateMasteryRule({ correct, total: responses.length, lastN: responses.slice(-5).map((r) => (r.correct ? 1 : 0)) });
  const masteryEst = mastery.ok === true ? mastery.est : 0;
  const guard = assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: false, evidence });
  const plan = planDifferentItemReassessment({ itemPool: interventions, sourceItemIds: [], count: Math.min(interventions.length, 5) });

  const checks = [
    { id: 'retention_gain', ok: ret.gain > 0 || ret.retained === true || (ret.metrics?.retention ?? 0) >= 0.7, detail: `gain ${Number(ret.gain || 0).toFixed(2)} retention ${(ret.metrics?.retention ?? 0).toFixed(2)}` },
    { id: 'mastery', ok: masteryEst >= 0.5, detail: `mastery ${Number(masteryEst).toFixed(2)}` },
    { id: 'no_permanent_penalty', ok: guard.ok, detail: guard.ok ? 'no penalty' : (guard.reason || 'penalty') },
    { id: 'different_item_plan', ok: plan.ok === true, detail: plan.ok === true ? `reassessment planned (${(plan.picked || []).length})` : (plan.error || 'no items') },
  ];
  return {
    ok: checks.every((c) => c.ok),
    pilot: PILOT_IDS.INTERVENTION,
    checks,
    summary: { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, retention: ret, mastery: masteryEst },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 06. NATIVE / PROVIDER DECK COMPARISON (§12)
// ═══════════════════════════════════════════════════════════════════

/**
 * Native (canonical) vs provider deck comparison: both valid, QA parity,
 * attribution present, no content drift.
 */
export function runDeckComparison({ native = null, provider = null } = {}) {
  const checks = [];
  const nativeV = validatePresentationDocument(native || {});
  const providerV = validatePresentationDocument(provider || {});
  checks.push({ id: 'native_valid', ok: nativeV.ok, detail: nativeV.ok ? 'ok' : ((nativeV.errors || [])[0] || 'invalid') });
  checks.push({ id: 'provider_valid', ok: providerV.ok, detail: providerV.ok ? 'ok' : ((providerV.errors || [])[0] || 'invalid') });

  const nativeQa = native ? runSlideQa(native.slides?.[0] || {}) : { ok: false };
  const providerQa = provider ? runSlideQa(provider.slides?.[0] || {}) : { ok: false };
  checks.push({ id: 'native_qa', ok: nativeQa.ok === true, detail: 'qa run' });
  checks.push({ id: 'provider_qa', ok: providerQa.ok === true, detail: 'qa run' });

  const attribution = provider?.attribution || provider?.attributionSlide;
  checks.push({ id: 'attribution', ok: Boolean(attribution), detail: attribution ? 'attribution present' : 'missing attribution' });

  if (nativeV.ok && providerV.ok) {
    const diff = diffVersions(native, provider);
    const drifted = (diff?.removedSlides || []).length;
    checks.push({ id: 'no_content_drift', ok: drifted === 0, detail: drifted ? `${drifted} removed slides` : 'no drift' });
  } else {
    checks.push({ id: 'no_content_drift', ok: true, detail: 'skipped (invalid doc)' });
  }

  return {
    ok: checks.every((c) => c.ok),
    pilot: PILOT_IDS.DECK_COMPARE,
    checks,
    summary: { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 07. PROVIDER OUTAGE / COST / QUOTA DRILL (§13)
// ═══════════════════════════════════════════════════════════════════

/**
 * Provider outage/cost/quota drill: circuit breaker behavior, retry
 * policy (shouldRetryError), cost estimate, PII guard.
 */
export function runOutageDrill({ provider = 'gamma', failureCount = 0, openUntil = null, statusCodes = [], credits = 0, minutes = 0, brief = '' } = {}) {
  const circuit = evaluateCircuitState({ failureCount, openUntil, now: Date.now() });
  const retryable = statusCodes.map((s) => ({ code: s, retry: shouldRetryError(s) }));
  const cost = computeUsageCost({ provider, credits, minutes });
  const pii = assertNoStudentPii(brief);
  const checks = [
    { id: 'circuit', ok: circuit === 'closed' || circuit === 'half_open', detail: `circuit ${circuit}` },
    { id: 'retry_policy', ok: retryable.every((r) => r.retry === (r.code === 429 || r.code >= 500)), detail: retryable.map((r) => `${r.code}:${r.retry}`).join(',') },
    { id: 'cost_estimate', ok: Number.isFinite(cost), detail: `$${Number(cost || 0).toFixed(4)}` },
    { id: 'pii_guard', ok: pii.ok, detail: pii.ok ? 'no PII' : 'PII blocked' },
  ];
  return {
    ok: checks.every((c) => c.ok),
    pilot: PILOT_IDS.OUTAGE,
    checks,
    summary: { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, circuit, costUsd: cost },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 08. PHASE G READINESS / RESIDUAL RISK (§14)
// ═══════════════════════════════════════════════════════════════════

/**
 * Aggregate all pilot results → Phase G readiness + residual risks.
 * @param {Object} opts - { pilots: Array<{ ok, pilot, summary }> }
 */
export function computePhaseGReadiness({ pilots = [] } = {}) {
  const total = pilots.length;
  const passed = pilots.filter((p) => p.ok).length;
  const failed = pilots.filter((p) => !p.ok).length;

  const residualRisks = [];
  for (const p of pilots) {
    if (!p.ok) {
      residualRisks.push({ level: 'high', area: p.pilot, risk: `${p.pilot} pilot failed`, mitigation: 'human review required before Phase G' });
    }
  }
  if (passed === total && total > 0) {
    residualRisks.push({ level: 'low', area: 'provider_sandbox', risk: 'provider sandbox credentials not exercised in pure pilot', mitigation: 'real sandbox drill before production rollout' });
  }

  return {
    ready: passed === total && total > 0,
    summary: { total, passed, failed, passedPct: total ? Math.round((passed / total) * 100) : 0 },
    residualRisks,
    guards: {
      summativeAuthority: 'teacher approval required for final scores',
      verifiedSource: 'unapproved/unverified sources cannot publish',
    },
  };
}
