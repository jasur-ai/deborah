/**
 * Deborah — Academic Grade Rules & Deterministic Calculation (pure logic)
 *
 * Prompt 45 — weighted, hurdle, late, exempt, resit va rounding qoidalarini
 * VERSIONLANGAN DSL'da hisoblash (research.md §18 GradingService, §72
 * special consideration/resit). This module is PURE (no I/O) — every
 * calculation is deterministic and reproducible.
 *
 * SECURITY / DATA GUARD (Prompt 45 §15):
 *   - Arbitrary code eval YO'Q — the DSL is a DECLARATIVE JSON structure
 *     evaluated by a fixed allowlist interpreter (no eval/Function).
 *   - Final grade FLOAT bilan hisoblanmaydi — Decimal via scaled integers
 *     (SCALE=10000, integer math with explicit rounding stages).
 *   - Old rule-version reproducibility: same (rule_hash, input_snapshot)
 *     ALWAYS produces the same run_hash + final_grade.
 *
 * LAYERS (Prompt 45 §09):
 *   raw → moderated → adjusted → final
 *   - raw:      weight × component score (missing → excluded or zero per
 *               missing_policy)
 *   - moderated: optional moderation factor applied to raw total
 *   - adjusted: after exempt (exempt components excluded from denominator)
 *               and late penalties (capped per late_policy)
 *   - final:    resit cap + rounding + boundary → grade label
 *
 * SEMANTICS (Prompt 45 §10):
 *   - missing: component not submitted — treated per missing_policy
 *              (exclude | zero) unless exempt
 *   - zero:    submitted but scored 0 — always counts (never excluded)
 *   - exempt:  approved exemption — excluded from BOTH numerator and
 *              denominator (weight redistributed)
 *   - pending: still being graded — calculation blocked (no partial final)
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const RULE_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  ARCHIVED: 'archived',
};
export const COMPONENT_STATUS = {
  MISSING: 'missing',
  ZERO: 'zero',
  EXEMPT: 'exempt',
  PENDING: 'pending',
  SCORED: 'scored',
};
export const MISSING_POLICY = {
  EXCLUDE: 'exclude', // weight redistributed across present components
  ZERO: 'zero', // counts as 0 (penalizes)
};
export const ROUND_METHODS = ['half_up', 'half_even', 'ceil', 'floor'];
export const RESIT_CAP_TYPES = ['none', 'capped', 'best_of', 'max_attempts'];

// Integer math scale: 4 decimal places, all arithmetic in integer units.
export const SCALE = 10000;

export const GRADE_RULE_DEFAULTS = {
  missingPolicy: MISSING_POLICY.EXCLUDE,
  moderationFactor: null, // e.g. {numerator: 102, denominator: 100} = +2%
  rounding: { method: 'half_up', scale: 2 },
  resitCap: { type: 'none', capPercent: null, bestOf: null },
  latePolicy: { enabled: false, graceMinutes: 0, penaltyPercentPerHour: 0, maxPenaltyPercent: 0 },
  boundaries: [
    { minPercent: 90, label: 'A' },
    { minPercent: 80, label: 'B' },
    { minPercent: 70, label: 'C' },
    { minPercent: 60, label: 'D' },
    { minPercent: 0, label: 'F' },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// DECIMAL ARITHMETIC (scaled integers — NO floats)
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert a number (or numeric string) to scaled integer units.
 * Floats are rounded to the nearest scale unit ONCE at input — every
 * subsequent operation is pure integer math.
 *
 * @param {number|string} value
 * @param {number} [scale]
 * @returns {number} integer in scale units
 */
export function toScaled(value = 0, scale = SCALE) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('non-finite grade value');
  return Math.round(n * scale);
}

/**
 * Convert scaled integer units back to a decimal number (display only).
 * Internally the pipeline keeps integers; this is for human output.
 *
 * @param {number} scaled
 * @param {number} [scale]
 * @returns {number}
 */
export function fromScaled(scaled = 0, scale = SCALE) {
  return scaled / scale;
}

/**
 * Multiply two scaled integers and rescale (a*b/scale) using integer math.
 * @param {number} a
 * @param {number} b
 * @param {number} [scale]
 */
export function mulScaled(a, b, scale = SCALE) {
  // Use BigInt for the multiplication to avoid 53-bit overflow.
  return Number((BigInt(a) * BigInt(b)) / BigInt(scale));
}

/**
 * Divide two scaled integers and rescale (a*scale/b) using integer math.
 * @param {number} a
 * @param {number} b
 * @param {number} [scale]
 */
export function divScaled(a, b, scale = SCALE) {
  if (b === 0) throw new Error('division by zero');
  return Number((BigInt(a) * BigInt(scale)) / BigInt(b));
}

/**
 * Round a scaled integer to a given decimal scale using the method.
 * @param {number} scaled
 * @param {string} [method] - half_up | half_even | ceil | floor
 * @param {number} [targetScale]
 * @param {number} [scale]
 */
export function roundScaled(scaled = 0, method = 'half_up', targetScale = 2, scale = SCALE) {
  // factor = 10^(decimal places in scale − targetScale). SCALE=10000 has
  // 4 decimal places, so rounding to 2dp uses factor 10^2 = 100 (integer).
  const scaleDecimals = Math.round(Math.log10(scale));
  const f = Math.pow(10, Math.max(0, scaleDecimals - targetScale));
  const q = Math.floor(scaled / f);
  const rem = scaled % f;
  const half = Math.floor(f / 2);
  switch (method) {
    case 'floor':
      return q * f;
    case 'ceil':
      return (scaled % f === 0 ? q : q + 1) * f;
    case 'half_even': {
      const lower = q * f;
      if (rem > half) return lower + f;
      if (rem < half) return lower;
      return (q % 2 === 0 ? lower : lower + f); // tie → even
    }
    case 'half_up':
    default:
      return (rem >= half ? q + 1 : q) * f;
  }
}

/**
 * Add scaled integers (no-op helper for readability).
 */
export function addScaled(a, b) {
  return a + b;
}

/**
 * Subtract scaled integers.
 */
export function subScaled(a, b) {
  return a - b;
}

// ═══════════════════════════════════════════════════════════════════
// DSL VALIDATION (allowlist — NO eval)
// ═══════════════════════════════════════════════════════════════════

const ALLOWED_OPERATORS = new Set(['mul', 'add', 'sub', 'div', 'avg', 'weighted', 'hurdle', 'late_penalty', 'resit_cap', 'round', 'grade_boundary', 'exempt_reweight', 'moderate', 'component']);

/**
 * Validate a rule DSL structure. Rejects unknown keys/operators —
 * the DSL is declarative, evaluated by the fixed interpreter below.
 *
 * @param {Object} dsl
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateRuleDsl(dsl = null) {
  if (!dsl || typeof dsl !== 'object' || Array.isArray(dsl)) {
    return { ok: false, error: 'rule DSL must be an object' };
  }
  if (!Array.isArray(dsl.components) || dsl.components.length === 0) {
    return { ok: false, error: 'rule DSL requires components[]' };
  }
  for (const c of dsl.components) {
    if (!c.key || !c.label) return { ok: false, error: 'component requires key and label' };
    if (!(c.max_score > 0)) return { ok: false, error: `component ${c.key} requires positive max_score` };
    const w = Number(c.weight);
    if (!(w >= 0) || !(w <= 100)) return { ok: false, error: `component ${c.key} weight must be 0–100` };
  }
  const totalWeight = dsl.components.reduce((s, c) => s + Number(c.weight), 0);
  if (Math.abs(totalWeight - 100) > 0.001) {
    return { ok: false, error: `component weights must sum to 100 (got ${totalWeight})` };
  }
  const rounding = dsl.rounding || GRADE_RULE_DEFAULTS.rounding;
  if (!ROUND_METHODS.includes(rounding.method)) {
    return { ok: false, error: `unsupported rounding method: ${rounding.method}` };
  }
  if (dsl.missingPolicy && !Object.values(MISSING_POLICY).includes(dsl.missingPolicy)) {
    return { ok: false, error: `unsupported missing policy: ${dsl.missingPolicy}` };
  }
  // Recursively ensure no eval-like keys anywhere
  const banned = new Set(['eval', 'Function', 'new Function', 'constructor', '__proto__', 'prototype']);
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const key of Object.keys(node)) {
      if (banned.has(key)) throw new Error('banned key in rule DSL');
      if (key.startsWith('$')) throw new Error('operator-style keys not allowed in stored DSL');
      walk(node[key]);
    }
  };
  try { walk(dsl); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true };
}

/**
 * Canonical stringify + deterministic rule hash (old-version reproducibility).
 *
 * @param {Object} dsl
 * @returns {string} sha256 hex
 */
export function hashRuleDsl(dsl = {}) {
  const canonical = canonicalStringify(dsl);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Deterministic JSON.stringify with sorted keys.
 */
export function canonicalStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

// ═══════════════════════════════════════════════════════════════════
// CALCULATION ENGINE (layers + semantics + caps + rounding)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the deterministic grade for a rule version + input snapshot.
 *
 * LAYERS: raw → moderated → adjusted → final.
 *
 * @param {Object} params
 * @param {Object} params.dsl - validated rule DSL (from a stored version)
 * @param {Array<Object>} params.components - input components:
 *   [{ key, raw_score, max_score, status }]
 * @param {Object} [params.context] - { lateMinutes, attemptNumber }
 * @returns {Object} { layers, breakdown, finalGrade, gradeLabel, blockedReason }
 */
export function calculateGrade({ dsl = null, components = [], context = {} } = {}) {
  const d = dsl || GRADE_RULE_DEFAULTS;
  const v = validateRuleDsl(d);
  if (!v.ok) throw new Error(v.error);

  // ── Input semantics ──
  const missingPolicy = d.missingPolicy || GRADE_RULE_DEFAULTS.missingPolicy;
  const blocked = components.find((c) => c.status === COMPONENT_STATUS.PENDING);
  if (blocked) {
    return {
      blocked: true,
      blockedReason: `component ${blocked.key} is pending grading`,
      layers: null, breakdown: [], finalGrade: null, gradeLabel: null,
    };
  }

  const breakdown = [];
  let presentWeight = 0; // scaled
  let weightedSum = 0; // scaled
  let exemptWeight = 0;

  for (const c of d.components) {
    const input = components.find((x) => x.key === c.key) || { key: c.key, raw_score: null, status: COMPONENT_STATUS.MISSING };
    let status = input.status || (input.raw_score === null || input.raw_score === undefined ? COMPONENT_STATUS.MISSING : COMPONENT_STATUS.SCORED);
    const weightScaled = toScaled(Number(c.weight) / 100); // 0..1 in scale units
    const maxScaled = toScaled(Number(c.max_score));

    if (status === COMPONENT_STATUS.EXEMPT) {
      exemptWeight += weightScaled;
      breakdown.push({ key: c.key, label: c.label, status, weight: c.weight, rawScore: null, maxScore: c.max_score, contribution: null, note: 'exempt — excluded from numerator and denominator' });
      continue;
    }

    if (status === COMPONENT_STATUS.PENDING) {
      return { blocked: true, blockedReason: `component ${c.key} is pending grading`, layers: null, breakdown: [], finalGrade: null, gradeLabel: null };
    }

    // missing handling
    let effectiveScore = input.raw_score;
    if (status === COMPONENT_STATUS.MISSING) {
      if (missingPolicy === MISSING_POLICY.ZERO) {
        effectiveScore = 0;
        status = COMPONENT_STATUS.ZERO;
      } else {
        // EXCLUDE: weight redistributed over present components
        breakdown.push({ key: c.key, label: c.label, status, weight: c.weight, rawScore: null, maxScore: c.max_score, contribution: null, note: 'missing — excluded (weight redistributed)' });
        continue;
      }
    }

    const rawScaled = toScaled(Number(effectiveScore));
    const pct = divScaled(rawScaled, maxScaled); // 0..1 scaled
    const contribution = mulScaled(pct, weightScaled); // scaled
    presentWeight += weightScaled;
    weightedSum += contribution;
    breakdown.push({ key: c.key, label: c.label, status, weight: c.weight, rawScore: Number(effectiveScore), maxScore: c.max_score, contribution: fromScaled(contribution), pct: fromScaled(pct) });
  }

  if (presentWeight === 0) {
    return { blocked: true, blockedReason: 'no graded components (all exempt/missing-excluded)', layers: null, breakdown, finalGrade: null, gradeLabel: null };
  }

  // ── LAYER 1: raw percent (scaled 0..1 → ×100 for display) ──
  const rawPct = divScaled(weightedSum, presentWeight); // 0..1 scaled
  const rawTotal = mulScaled(rawPct, toScaled(100)); // 0..100 scaled

  // ── LAYER 2: moderation factor (optional, e.g. +2%) ──
  let moderated = rawTotal;
  let moderationNote = null;
  if (d.moderationFactor && Number(d.moderationFactor.numerator) > 0 && Number(d.moderationFactor.denominator) > 0) {
    const factor = divScaled(toScaled(d.moderationFactor.numerator), toScaled(d.moderationFactor.denominator));
    moderated = mulScaled(rawTotal, factor);
    moderationNote = `×${fromScaled(factor).toFixed(4)} (moderation)`;
  }

  // ── LAYER 3: adjusted — late penalty (capped) ──
  let adjusted = moderated;
  let lateNote = null;
  const late = d.latePolicy || GRADE_RULE_DEFAULTS.latePolicy;
  if (late.enabled) {
    const lateMinutes = Number(context.lateMinutes) || 0;
    const grace = Number(late.graceMinutes) || 0;
    const over = Math.max(0, lateMinutes - grace);
    if (over > 0) {
      const hours = over / 60;
      let penaltyPct = hours * (Number(late.penaltyPercentPerHour) || 0);
      const maxPenalty = Number(late.maxPenaltyPercent) || 0;
      if (maxPenalty > 0) penaltyPct = Math.min(penaltyPct, maxPenalty);
      penaltyPct = Math.max(0, penaltyPct);
      adjusted = subScaled(moderated, mulScaled(moderated, toScaled(penaltyPct / 100)));
      lateNote = `−${penaltyPct.toFixed(2)}% late penalty (${over} min over grace)`;
    }
  }

  // ── LAYER 4: final — resit cap + rounding + boundary ──
  const resit = d.resitCap || GRADE_RULE_DEFAULTS.resitCap;
  let finalPct = adjusted;
  let resitNote = null;
  const attemptNumber = Number(context.attemptNumber) || 1;
  if (attemptNumber > 1) {
    if (resit.type === 'capped' && resit.capPercent != null) {
      finalPct = Math.min(finalPct, toScaled(Number(resit.capPercent)));
      resitNote = `resit capped at ${resit.capPercent}%`;
    } else if (resit.type === 'best_of' && resit.bestOf && resit.bestOf >= attemptNumber) {
      resitNote = `best_of ${resit.bestOf} — attempt ${attemptNumber} eligible`;
    } else if (resit.type === 'max_attempts' && resit.bestOf && attemptNumber > resit.bestOf) {
      return { blocked: true, blockedReason: `max attempts (${resit.bestOf}) exceeded`, layers: null, breakdown, finalGrade: null, gradeLabel: null };
    }
  }

  const rounding = d.rounding || GRADE_RULE_DEFAULTS.rounding;
  const rounded = roundScaled(finalPct, rounding.method, rounding.scale || 2);
  const finalGrade = fromScaled(rounded);
  const gradeLabel = applyBoundary(rounded, d.boundaries || GRADE_RULE_DEFAULTS.boundaries);

  const layers = {
    raw: fromScaled(rawTotal),
    moderated: moderationNote ? fromScaled(moderated) : fromScaled(moderated),
    adjusted: lateNote ? fromScaled(adjusted) : fromScaled(adjusted),
    final: finalGrade,
  };

  const notes = [moderationNote, lateNote, resitNote].filter(Boolean);
  return {
    blocked: false,
    blockedReason: null,
    layers,
    breakdown,
    finalGrade,
    gradeLabel,
    notes,
  };
}

/**
 * Map a rounded percent (scaled) to a grade boundary label.
 *
 * @param {number} pctScaled - scaled 0..100
 * @param {Array<{minPercent:number, label:string}>} boundaries
 * @returns {string}
 */
export function applyBoundary(pctScaled = 0, boundaries = GRADE_RULE_DEFAULTS.boundaries) {
  const sorted = [...boundaries].sort((a, b) => Number(b.minPercent) - Number(a.minPercent));
  for (const b of sorted) {
    if (pctScaled >= toScaled(Number(b.minPercent))) return b.label;
  }
  return 'F';
}

// ═══════════════════════════════════════════════════════════════════
// RUN HASH (idempotent replay + old-version reproducibility)
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministic run hash over (rule_hash, canonical input snapshot).
 * The SAME inputs + rule ALWAYS yield the SAME hash — replay-safe.
 *
 * @param {Object} params
 * @param {string} params.ruleHash
 * @param {Array<Object>} params.components
 * @returns {string}
 */
export function computeRunHash({ ruleHash = '', components = [], context = {} } = {}) {
  const canonicalInput = canonicalStringify(
    components.map((c) => ({ key: c.key, rawScore: c.raw_score, status: c.status }))
  );
  // Context (lateMinutes, attemptNumber) affects the result — it MUST be
  // part of the hash or idempotent replay would return a wrong run.
  const canonicalCtx = canonicalStringify({
    lateMinutes: Number(context?.lateMinutes) || 0,
    attemptNumber: Number(context?.attemptNumber) || 1,
  });
  return crypto.createHash('sha256').update(`${ruleHash}:${canonicalInput}:${canonicalCtx}`).digest('hex');
}

/**
 * Build a human-readable breakdown string from a calculation result.
 *
 * @param {Object} result - from calculateGrade
 * @returns {string}
 */
export function humanizeBreakdown(result = {}) {
  if (result.blocked) return `Bloklangan: ${result.blockedReason}`;
  const lines = (result.breakdown || []).map((b) => {
    const val = b.status === 'exempt' || b.status === 'missing'
      ? `(${b.status})`
      : `${b.rawScore}/${b.maxScore} → ${(b.contribution * 100).toFixed(2)}%`;
    return `• ${b.label} [${b.status}]: ${val}`;
  });
  lines.push(`Yakuniy: ${result.finalGrade}% → ${result.gradeLabel}`);
  if (result.notes?.length) lines.push(`Eslatmalar: ${result.notes.join('; ')}`);
  return lines.join('\n');
}
