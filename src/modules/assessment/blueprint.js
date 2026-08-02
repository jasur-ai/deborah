/**
 * Edikit — Assessment Blueprint Engine (pure logic)
 *
 * Pure, DB-free functions for assessment blueprint arithmetic:
 *   - distributeCount: deterministic 50/30/20 (or any ratio) item count split
 *   - validateBlueprint: outcome/topic weight sum + distribution validation
 *   - validateScoreTimeArithmetic: score/time totals vs sections/items
 *   - selectItemsFromPool: seeded, deterministic item pool selection
 *   - renderStudentPreview: secret-safe student/author preview render
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

// ── Default 50/30/20 difficulty distribution (research.md §11) ──
export const DISTRIBUTION_RATIOS = { easy: 0.5, medium: 0.3, hard: 0.2 };

export const ASSESSMENT_TYPES = [
  'diagnostic', 'formative', 'quiz', 'midterm',
  'summative', 'practice', 'written', 'project',
];

export const ASSESSMENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

// Draft mutable → published immutable → archived (terminal read-only)
export const ASSESSMENT_STATUS_TRANSITIONS = {
  draft: ['published', 'archived'],
  published: ['archived'],
  archived: [],
};

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC DISTRIBUTION (50/30/20)
// ═══════════════════════════════════════════════════════════════════

/**
 * Split a total count deterministically by ratios using the
 * largest-remainder method (guarantees exact sum == total).
 *
 * @param {number} total - Total item count
 * @param {Object} ratios - e.g. { easy: 0.5, medium: 0.3, hard: 0.2 }
 * @returns {Object} Same keys as ratios with integer counts summing to total
 */
export function distributeCount(total, ratios = DISTRIBUTION_RATIOS) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;

  const entries = Object.entries(ratios).filter(([, r]) => Number.isFinite(r) && r > 0);
  if (entries.length === 0) {
    throw new Error('At least one distribution ratio must be > 0');
  }

  const ratioSum = entries.reduce((s, [, r]) => s + r, 0);
  if (ratioSum <= 0) {
    throw new Error('Distribution ratios must sum to a positive value');
  }

  const result = {};
  for (const [key] of entries) result[key] = 0;

  if (safeTotal === 0) return result;

  // Exact proportional values + floors
  const exact = entries.map(([key, r]) => [key, (safeTotal * r) / ratioSum]);
  let allocated = 0;
  for (const [key, v] of exact) {
    result[key] = Math.floor(v);
    allocated += result[key];
  }

  // Distribute the remaining remainder to the largest fractional parts
  let remaining = safeTotal - allocated;
  const remainders = exact
    .map(([key, v]) => [key, v - Math.floor(v)])
    .sort((a, b) => b[1] - a[1]);

  let i = 0;
  while (remaining > 0) {
    result[remainders[i % remainders.length][0]] += 1;
    remaining -= 1;
    i += 1;
  }

  return result;
}

/** Alias: 50/30/20 split helper. */
export function split502030(total) {
  return distributeCount(total, DISTRIBUTION_RATIOS);
}

/**
 * Compute per-outcome counts from a weight blueprint.
 * Weights are normalized to 100% and applied deterministically.
 *
 * @param {number} total - Total item count
 * @param {Array<{outcome_code: string, weight: number}>} weights
 * @returns {Object} { outcome_code: count, ... }
 */
export function computeBlueprintCounts(total, weights = []) {
  const valid = weights.filter((w) => w && w.outcome_code && Number.isFinite(w.weight) && w.weight > 0);
  if (valid.length === 0) return {};

  const ratioObj = {};
  for (const w of valid) ratioObj[w.outcome_code] = w.weight;
  return distributeCount(total, ratioObj);
}

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINT VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a blueprint object (weights + distribution).
 *
 * @param {Object} blueprint
 * @param {Object} [opts]
 * @param {number} [opts.expectedTotalItems] - If set, distribution counts must sum to this
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateBlueprint(blueprint = {}, opts = {}) {
  const errors = [];
  const warnings = [];

  // ── Weights must sum to 100 ──
  const weights = Array.isArray(blueprint.weights) ? blueprint.weights : [];
  if (weights.length > 0) {
    const sum = weights.reduce((s, w) => s + (Number(w.weight) || 0), 0);
    if (Math.abs(sum - 100) > 0.001) {
      errors.push(`Blueprint weights sum to ${sum}, expected 100`);
    }
    // Duplicate outcome codes
    const codes = new Set();
    for (const w of weights) {
      if (!w.outcome_code) {
        errors.push('Blueprint weight missing outcome_code');
      } else if (codes.has(w.outcome_code)) {
        errors.push(`Duplicate outcome weight: ${w.outcome_code}`);
      }
      codes.add(w.outcome_code);
    }
  }

  // ── Distribution ──
  const distribution = blueprint.distribution || {};
  const distEntries = Object.entries(distribution).filter(([, v]) => Number(v) > 0);
  if (distEntries.length > 0) {
    const distSum = distEntries.reduce((s, [, v]) => s + (Number(v) || 0), 0);
    if (opts.expectedTotalItems !== undefined) {
      if (distSum !== opts.expectedTotalItems) {
        errors.push(
          `Distribution counts sum to ${distSum}, expected ${opts.expectedTotalItems}`
        );
      }
    }
    // Warn if any negative
    for (const [key, v] of distEntries) {
      if (Number(v) < 0) errors.push(`Distribution count for ${key} is negative`);
    }
  }

  // ── Randomization config sanity ──
  const rand = blueprint.randomization || {};
  if (rand.seed !== undefined && rand.seed !== null && !Number.isInteger(rand.seed)) {
    errors.push('randomization.seed must be an integer');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// SCORE / TIME ARITHMETIC VALIDATOR
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate score/time arithmetic across an assessment.
 *
 * @param {Object} params
 * @param {number} [params.totalPoints] - Assessment total_points (0 = unset)
 * @param {number} [params.totalTimeSeconds] - Assessment total_time_seconds (0 = unset)
 * @param {Array} [params.sections] - Sections with { max_points, max_time_seconds }
 * @param {Array} [params.items] - Items with { points, time_seconds, section_id }
 * @returns {{ ok: boolean, errors: string[], totals: { points: number, timeSeconds: number } }}
 */
export function validateScoreTimeArithmetic({
  totalPoints = 0,
  totalTimeSeconds = 0,
  sections = [],
  items = [],
} = {}) {
  const errors = [];

  // Item totals
  const itemPoints = items.reduce((s, it) => s + (Number(it.points) || 0), 0);
  const itemTime = items.reduce((s, it) => s + (Number(it.time_seconds) || 0), 0);

  // Per-section caps
  for (const section of sections) {
    const secItems = items.filter((it) => it.section_id === section.id);
    const secPoints = secItems.reduce((s, it) => s + (Number(it.points) || 0), 0);
    const secTime = secItems.reduce((s, it) => s + (Number(it.time_seconds) || 0), 0);

    if (section.max_points && Number(section.max_points) > 0) {
      if (secPoints > Number(section.max_points) + 0.001) {
        errors.push(
          `Section "${section.title}" points ${secPoints} exceed max ${section.max_points}`
        );
      }
    }
    if (section.max_time_seconds && Number(section.max_time_seconds) > 0) {
      if (secTime > Number(section.max_time_seconds)) {
        errors.push(
          `Section "${section.title}" time ${secTime}s exceeds max ${section.max_time_seconds}s`
        );
      }
    }
  }

  // Assessment totals
  if (Number(totalPoints) > 0 && Math.abs(itemPoints - Number(totalPoints)) > 0.001) {
    errors.push(`Item points (${itemPoints}) do not match assessment total (${totalPoints})`);
  }
  if (Number(totalTimeSeconds) > 0 && itemTime !== Number(totalTimeSeconds)) {
    errors.push(
      `Item time (${itemTime}s) does not match assessment total (${totalTimeSeconds}s)`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    totals: { points: itemPoints, timeSeconds: itemTime },
  };
}

// ═══════════════════════════════════════════════════════════════════
// SEEDED ITEM POOL SELECTION (deterministic randomization)
// ═══════════════════════════════════════════════════════════════════

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffle an array using a seed (Fisher–Yates).
 * Same input + same seed → same output order.
 */
export function seededShuffle(array, seed = 1) {
  const arr = array.slice();
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Select a subset from an item pool honoring difficulty/type/cognitive
 * distribution and a per-item seed (student variant).
 *
 * @param {Array} pool - Items with { id, difficulty, question_type, cognitive_level }
 * @param {Object} blueprint - { distribution: { easy, medium, hard }, total_items }
 * @param {Object} [opts]
 * @param {number} [opts.seed] - Deterministic seed (student id hash recommended)
 * @returns {{ selected: Array, skipped: string[], deterministic: boolean }}
 */
export function selectItemsFromPool(pool, blueprint = {}, opts = {}) {
  const seed = Number.isInteger(opts.seed) ? opts.seed : 1;
  const distribution = blueprint.distribution || {};
  const totalItems = Number(blueprint.total_items) || 0;

  if (!Array.isArray(pool) || pool.length === 0) {
    return { selected: [], skipped: ['Item pool is empty'], deterministic: true };
  }

  // Distribute the total across difficulty buckets
  const bucketCounts = distributeCount(totalItems, {
    easy: distribution.easy ?? DISTRIBUTION_RATIOS.easy,
    medium: distribution.medium ?? DISTRIBUTION_RATIOS.medium,
    hard: distribution.hard ?? DISTRIBUTION_RATIOS.hard,
  });

  const skipped = [];
  const selected = [];

  for (const [difficulty, count] of Object.entries(bucketCounts)) {
    const candidates = pool.filter((it) => it.difficulty === difficulty);
    if (candidates.length < count) {
      skipped.push(
        `Not enough ${difficulty} items: need ${count}, have ${candidates.length}`
      );
    }
    const picked = seededShuffle(candidates, seed + difficulty.length).slice(0, count);
    selected.push(...picked);
  }

  // If total selection falls short of total_items, top up from the rest (deterministic)
  if (selected.length < totalItems) {
    const usedIds = new Set(selected.map((it) => it.id));
    const rest = seededShuffle(pool.filter((it) => !usedIds.has(it.id)), seed + 7);
    selected.push(...rest.slice(0, totalItems - selected.length));
  }

  return {
    selected: selected.slice(0, totalItems || selected.length),
    skipped,
    deterministic: true,
  };
}

// ═══════════════════════════════════════════════════════════════════
// STUDENT / AUTHOR PREVIEW RENDER (secret-safe)
// ═══════════════════════════════════════════════════════════════════

/** Escape untrusted text for HTML (XSS guard). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderItem(item, { includePrivateKey = false } = {}) {
  const pub = item.public_data || {};
  const stemText =
    typeof pub.stem === 'string'
      ? pub.stem
      : pub.stem?.text || '';

  let html = `<div class="a-item">
  <div class="a-item-head"><span class="a-item-type">${escapeHtml(item.question_type || 'item')}</span>
  <span class="a-item-points">${Number(item.points) || 1} pts</span></div>
  <div class="a-item-stem">${escapeHtml(stemText)}</div>`;

  const options = Array.isArray(pub.options) ? pub.options : [];
  if (options.length > 0) {
    html += '<ol class="a-options">';
    for (const opt of options) {
      html += `<li>${escapeHtml(opt.text ?? opt.key ?? '')}</li>`;
    }
    html += '</ol>';
  }

  // Private key is ONLY rendered when explicitly requested by an authorized author.
  if (includePrivateKey) {
    const priv = item.private_data || {};
    const correct = Array.isArray(priv.correctKeys) ? priv.correctKeys : null;
    html += '<div class="a-answer-key">';
    html += '<strong>Answer key (author only):</strong> ';
    html += escapeHtml(correct ? correct.join(', ') : priv.correctAnswer ?? 'N/A');
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Render a full HTML student preview document.
 * NEVER includes private scoring data unless includePrivateKey === true
 * AND authorized === true (defense in depth).
 *
 * @param {Object} assessment - { title, description, assessment_type, total_points, total_time_seconds }
 * @param {Array} sections - Sections with { title, items }
 * @param {Object} [opts]
 * @param {boolean} [opts.includePrivateKey]
 * @param {boolean} [opts.authorized]
 * @returns {string} Full HTML document
 */
export function renderStudentPreview(assessment = {}, sections = [], opts = {}) {
  const showPrivate = opts.includePrivateKey === true && opts.authorized === true;

  const esc = (v) => escapeHtml(v);

  let body = `<main class="a-preview">
  <header class="a-preview-head">
    <h1>${esc(assessment.title || 'Untitled assessment')}</h1>
    ${assessment.description ? `<p>${esc(assessment.description)}</p>` : ''}
    <div class="a-meta">
      <span>Type: ${esc(assessment.assessment_type || 'formative')}</span>
      <span>Points: ${esc(Number(assessment.total_points) || 0)}</span>
      <span>Time: ${esc(Number(assessment.total_time_seconds) || 0)}s</span>
    </div>
  </header>`;

  let itemNumber = 1;
  for (const section of sections) {
    body += `<section class="a-section">
      <h2>${esc(section.title || 'Section')}</h2>`;
    if (section.description) body += `<p class="a-section-desc">${esc(section.description)}</p>`;
    for (const item of section.items || []) {
      const rendered = renderItem(item, { includePrivateKey: showPrivate });
      // Number items sequentially
      body += `<div class="a-number">${itemNumber}.</div>${rendered}`;
      itemNumber += 1;
    }
    body += '</section>';
  }

  if (showPrivate) {
    body += '<footer class="a-private-banner">This preview includes the ANSWER KEY — author only.</footer>';
  } else {
    body += '<footer class="a-public-banner">Student preview — answer key hidden.</footer>';
  }

  body += '</main>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(assessment.title || 'Assessment preview')} — Preview</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f4f6fb;color:#1a2033;margin:0;padding:24px}
.a-preview{max-width:760px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 10px 30px rgba(16,24,40,.08)}
.a-preview-head{border-bottom:2px solid #2563eb;padding-bottom:16px;margin-bottom:20px}
.a-meta{display:flex;gap:16px;color:#5b6478;font-size:13px;margin-top:8px}
.a-section{border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:18px;background:#fafbff}
.a-item{background:#fff;border:1px solid #eef1f7;border-radius:8px;padding:12px;margin:8px 0 8px 28px;position:relative}
.a-number{font-weight:700;color:#2563eb;font-size:13px;margin-top:10px}
.a-item-head{display:flex;justify-content:space-between;font-size:12px;color:#5b6478}
.a-item-type{text-transform:uppercase;letter-spacing:.4px;color:#2563eb;font-weight:600}
.a-item-stem{font-size:15px;margin:8px 0}
.a-options li{margin:4px 0}
.a-answer-key{background:#fff1f2;border:1px dashed #f43f5e;color:#be123c;padding:8px;border-radius:6px;margin-top:8px;font-size:13px}
.a-public-banner{color:#64748b;font-size:12px;text-align:center;margin-top:20px}
.a-private-banner{background:#0f172a;color:#fbbf24;font-size:12px;text-align:center;padding:10px;border-radius:8px;margin-top:20px}
</style>
</head>
<body>${body}</body>
</html>`;
}
