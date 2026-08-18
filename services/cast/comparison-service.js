/**
 * Deborah — Cast Comparison Service (C5-03)
 * -----------------------------------------
 * Ikki session'ni solishtirishdan oldin config compatibility tekshiriladi.
 * Incompatible bo'lsa — direct delta/rank BLOKLANADI (misleading ko'rsatish
 * yo'q), compatible bo'lsa — descriptive side-by-side beriladi.
 *
 * Contract:
 *   { compatible, differences, allowedViews }
 *   allowedViews: ['SIDE_BY_SIDE'] | ['SEPARATE_REPORTS']
 *
 * Tugallanish sharti: incompatible session uchun misleading direct rank/delta
 * ko'rsatilmaydi.
 */

export const COMPARISON_VERSION = 'comparison_v1';

export const COMPARISON_VIEWS = Object.freeze({
  SIDE_BY_SIDE: 'SIDE_BY_SIDE',
  SEPARATE_REPORTS: 'SEPARATE_REPORTS',
});

/**
 * Comparability tekshiriladigan config maydonlari (item 10):
 * same test version, timer, scoring, reveal, locale, delivery.
 * @param {object} config — session config (snapshot)
 * @returns {Array<string>} comparable field paths
 */
export function comparableFieldPaths(config = {}) {
  const paths = [];
  // Test version
  paths.push('source.version');
  // Timer
  if (config?.timer) paths.push('timer.mode', 'timer.defaultSeconds');
  // Scoring
  if (config?.scoring) {
    paths.push('scoring.mode', 'scoring.version', 'scoring.correctBase', 'scoring.speedBonusMax', 'scoring.scorePolicy');
  }
  // Reveal — playback.advanceMode + closeTrigger (javob ko'rsatish tartibi)
  if (config?.playback) paths.push('playback.advanceMode', 'playback.closeTrigger');
  // Locale
  if (config?.localization) paths.push('localization.locale', 'localization.rtl');
  // Delivery
  if (config?.participation) paths.push('participation.delivery');
  return paths;
}

/** Nested path o'qish. */
function getPath(obj, path) {
  if (!obj || !path) return undefined;
  let node = obj;
  for (const part of path.split('.')) {
    if (node === undefined || node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

/** Array'ni canonical string (tartib bo'yicha). */
function canonicalValue(v) {
  if (Array.isArray(v)) return JSON.stringify([...v].sort());
  return JSON.stringify(v);
}

/**
 * Compatible check (item 9–12).
 * @param {object} a — {config, testVersion}
 * @param {object} b
 * @returns {{compatible:boolean, differences:string[], allowedViews:string[]}}
 */
export function checkCompatibility(a, b) {
  const differences = [];
  const paths = new Set([...comparableFieldPaths(a?.config), ...comparableFieldPaths(b?.config)]);
  for (const path of paths) {
    const va = canonicalValue(getPath(a?.config, path));
    const vb = canonicalValue(getPath(b?.config, path));
    if (va !== vb) differences.push(path);
  }
  // Test version farqi → avtomatik incompatible (item 13: different form)
  const ta = a?.testVersion ?? a?.config?.source?.version ?? null;
  const tb = b?.testVersion ?? b?.config?.source?.version ?? null;
  if (ta !== tb) differences.push('test_version');

  const compatible = differences.length === 0;
  return {
    compatible,
    differences: [...new Set(differences)],
    allowedViews: compatible ? [COMPARISON_VIEWS.SIDE_BY_SIDE] : [COMPARISON_VIEWS.SEPARATE_REPORTS],
  };
}

/**
 * Side-by-side (item 12) — faqat COMPATIBLE sessionlar uchun.
 * Faqat aggregate metrics — student identity / rank YO'Q.
 * @param {object} a — {sessionId, accuracy, participation, generatedAt}
 * @param {object} b
 * @returns {object} side-by-side projection
 */
export function sideBySide(a, b) {
  return {
    version: COMPARISON_VERSION,
    type: 'side_by_side',
    columns: ['A', 'B'],
    rows: [
      { metric: 'accuracy', a: a?.accuracy ?? null, b: b?.accuracy ?? null },
      { metric: 'accepted', a: a?.accepted ?? null, b: b?.accepted ?? null },
      { metric: 'technicalFailures', a: a?.technicalFailures ?? null, b: b?.technicalFailures ?? null },
    ],
  };
}

/**
 * Equating feature flag (item 13) — different test form uchun doim OFF.
 * @param {object} input — {testVersionA, testVersionB}
 * @returns {{equating:boolean, reason:string}}
 */
export function equatingStatus({ testVersionA, testVersionB }) {
  // Review fix (C5-03): null/undefined normalize — ikkalasi ham yo'q bo'lsa
  // DIFFERENT_TEST_FORM emas (false-positive oldini olish).
  const va = testVersionA ?? null;
  const vb = testVersionB ?? null;
  if (va !== vb) {
    return { equating: false, reason: 'DIFFERENT_TEST_FORM' };
  }
  // Hozirgi versiyada equating umuman yoq — feature flag default off
  return { equating: false, reason: 'FEATURE_FLAG_OFF' };
}

/**
 * Personal longitudinal comparability (item 15) — comparable content tag +
 * coverage tekshiruvi. `progressA`/`progressB` — computePersonalProgress
 * natijalari (fingerprint bilan).
 */
export function longitudinalComparable({ fpA, fpB, coverageA = 0, coverageB = 0, minCoverage = 0.5 }) {
  if (!fpA || !fpB || fpA !== fpB) {
    return { comparable: false, reason: 'INCOMPATIBLE_CONFIG' };
  }
  if (coverageA < minCoverage || coverageB < minCoverage) {
    return { comparable: false, reason: 'LOW_COVERAGE' };
  }
  return { comparable: true, reason: null };
}

export default {
  COMPARISON_VERSION,
  COMPARISON_VIEWS,
  comparableFieldPaths,
  checkCompatibility,
  sideBySide,
  equatingStatus,
  longitudinalComparable,
};
