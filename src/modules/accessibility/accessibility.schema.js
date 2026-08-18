/**
 * Deborah — WCAG 2.2 AA & Artifact Accessibility (pure logic)
 *
 * Prompt 64 — teacher/student/admin/proctor critical journeys va generated
 * artifactlarni (PDF/DOCX/PPTX) accessible qilish (research.md §26.1
 * accessibility evidence, §29 accommodation, §28 artifact accessibility).
 * This module is PURE (no I/O, no globals):
 *
 *   - WCAG 2.2 AA contrast math: relativeLuminance (WCAG 2.x formula),
 *     contrastRatio, assertContrastAA (4.5:1 normal, 3:1 large text
 *     18pt/14pt bold — 1.4.3), non-text 3:1 (1.4.11).
 *   - axe-style automated rule set over a DOM snapshot contract:
 *     runAxeChecks({ landmarks, headings, labels, focusables, skipLinks,
 *     timers, touchTargets, dragDrops, media }) → { violations, score }.
 *     Rules: landmark (1.3.1), heading order (1.3.1/2.4.6), label
 *     (1.1.1/4.1.2), focus visible (2.4.7), skip link (2.4.1), timer +
 *     live region (2.2.1/4.1.3), touch target 44px (2.5.8), reduced
 *     motion (2.3.3), drag-drop keyboard alternative (2.5.7), alt text
 *     (1.1.1).
 *   - Artifact QA: assertArtifactReadingOrder, assertArtifactAltText,
 *     assertTaggedPdf (PDF/UA), contrastIssues list for PDF/DOCX/PPTX.
 *   - Gap classification: classifyGap(severity, journey, isTimed) →
 *     blocker flag; ACR evidence builder (buildAcrEvidence).
 *   - Security guard: assertAutomatedCheckIsNotFinal — automated checker
 *     o'zi yetarli emas; inson verification talab qilinadi (Prompt 64
 *     §15: "accessibility action strike bo'lmasin").
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const WCAG_TARGET = '2.2-AA';
export const CONTRAST_NORMAL_MIN = 4.5;   // 1.4.3
export const CONTRAST_LARGE_MIN = 3.0;    // 1.4.3 large text / 1.4.11 non-text
export const TOUCH_TARGET_MIN_PX = 44;    // 2.5.8 (WCAG 2.2 target size)
export const JOURNEYS = ['teacher', 'student', 'admin', 'proctor'];

export const GAP_SEVERITY = { BLOCKER: 'blocker', CRITICAL: 'critical', MAJOR: 'major', MINOR: 'minor' };
export const GAP_STATUS = { OPEN: 'open', IN_PROGRESS: 'in_progress', FIXED: 'fixed', VERIFIED: 'verified' };
export const ARTIFACT_TYPES = ['pdf', 'docx', 'pptx'];
export const A11Y_SETTING_DEFAULTS = {
  reducedMotion: false,
  highContrast: false,
  fontScale: 1.0,
  keyboardNav: false,
  screenReaderMode: false,
};

// ═══════════════════════════════════════════════════════════════════
// WCAG 2.x CONTRAST MATH (1.4.3 / 1.4.11)
// ═══════════════════════════════════════════════════════════════════

/** Hex (#rgb, #rrggbb) → [r,g,b] 0-255. Null on malformed input. */
export function hexToRgb(hex = '') {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance (0-1). */
export function relativeLuminance(rgb = [0, 0, 0]) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colors (1-21). */
export function contrastRatio(fg = '#000000', bg = '#ffffff') {
  const a = relativeLuminance(hexToRgb(fg) || [0, 0, 0]);
  const b = relativeLuminance(hexToRgb(bg) || [255, 255, 255]);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 1.4.3 — large text is 18pt (24px) or 14pt bold (18.66px bold). */
export function isLargeText({ fontSizePx = 16, bold = false } = {}) {
  const px = Number(fontSizePx) || 16;
  if (px >= 24) return true;
  return bold && px >= 18.66;
}

/** 1.4.3 / 1.4.11 — AA contrast assertion. */
export function assertContrastAA({ fg = '#000000', bg = '#ffffff', fontSizePx = 16, bold = false } = {}) {
  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  if (!fgRgb || !bgRgb) return { ok: false, reason: `invalid color: ${fg} / ${bg}`, ratio: 0 };
  const ratio = contrastRatio(fg, bg);
  const min = isLargeText({ fontSizePx, bold }) ? CONTRAST_LARGE_MIN : CONTRAST_NORMAL_MIN;
  const ok = ratio >= min;
  return { ok, ratio: Math.round(ratio * 100) / 100, min, large: isLargeText({ fontSizePx, bold }) };
}

// ═══════════════════════════════════════════════════════════════════
// AXE-STYLE RULE SET (automated snapshot contract)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run the automated axe-style rule set over a DOM snapshot.
 *
 * Snapshot contract (extracted by the caller from real DOM):
 *   { landmarks: ['banner'|'main'|'navigation'|'contentinfo', ...],
 *     headings: [{ level: 1..6, text }],
 *     controls: [{ id, label, hasLabel, role, targetSizePx }],
 *     focusables: [{ selector, hasFocusIndicator }],
 *     skipLinks: ['#main', ...],
 *     timers: [{ id, hasLiveRegion }],
 *     dragDrops: [{ id, hasKeyboardAlternative }],
 *     media: [{ type: 'img'|'video'|'svg', hasAlt }],
 *     prefersReducedMotion: bool }
 *
 * Returns { violations: [{ rule, impact, target, help }], score, passes }.
 * NOTE: automated checks are NOT final (assertAutomatedCheckIsNotFinal).
 */
export function runAxeChecks(snapshot = {}) {
  const violations = [];
  const s = snapshot || {};

  // 1.3.1 Landmarks — page must have main landmark (and ideally nav/contentinfo)
  const landmarks = s.landmarks || [];
  if (!landmarks.includes('main')) {
    violations.push({ rule: 'landmark-one-main', impact: 'serious', target: 'document', help: 'Page must have exactly one main landmark (1.3.1)' });
  }

  // 1.3.1 / 2.4.6 Heading order — no skipped levels between h1→h2→h3…
  const headings = (s.headings || []).map((h) => Number(h.level) || 0);
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] - headings[i - 1] > 1) {
      violations.push({
        rule: 'heading-order',
        impact: 'moderate',
        target: `heading level ${headings[i]}`,
        help: `Heading level skipped from h${headings[i - 1]} to h${headings[i]} (1.3.1/2.4.6)`,
      });
      break;
    }
  }

  // 1.1.1 / 4.1.2 — form controls must have accessible name
  for (const c of s.controls || []) {
    if (!c.hasLabel) {
      violations.push({ rule: 'label', impact: 'serious', target: c.id || c.role || 'control', help: 'Form control must have an accessible name (1.1.1/4.1.2)' });
    }
  }

  // 2.4.7 — focus visible
  for (const f of s.focusables || []) {
    if (f.hasFocusIndicator === false) {
      violations.push({ rule: 'focus-visible', impact: 'serious', target: f.selector || 'focusable', help: 'Keyboard focus must be visible (2.4.7)' });
    }
  }

  // 2.4.1 — skip link must be present when the page has interactive content
  const focusables = s.focusables || [];
  const skipLinks = s.skipLinks || [];
  if (focusables.length > 0 && skipLinks.length === 0) {
    violations.push({ rule: 'skip-link', impact: 'moderate', target: 'body', help: 'Skip link must be present to bypass repeated blocks (2.4.1)' });
  }

  // 2.2.1 / 4.1.3 — timer must have live region (warning before expiry)
  for (const t of s.timers || []) {
    if (!t.hasLiveRegion) {
      violations.push({ rule: 'timer-live-region', impact: 'critical', target: t.id || 'timer', help: 'Time limit must announce warnings via live region (2.2.1/4.1.3)' });
    }
  }

  // 2.5.8 — touch targets ≥ 44px (WCAG 2.2 AA)
  for (const c of s.controls || []) {
    const px = Number(c.targetSizePx) || 0;
    if (px > 0 && px < TOUCH_TARGET_MIN_PX) {
      violations.push({ rule: 'target-size', impact: 'moderate', target: c.id || 'control', help: `Touch target ${px}px must be ≥ ${TOUCH_TARGET_MIN_PX}px (2.5.8)` });
    }
  }

  // 2.3.3 — animation from interaction must respect reduced motion
  if (s.prefersReducedMotion && s.hasAnimation) {
    violations.push({ rule: 'reduced-motion', impact: 'moderate', target: 'animation', help: 'Animation must be disabled under prefers-reduced-motion (2.3.3)' });
  }

  // 2.5.7 — dragging must have keyboard alternative
  for (const d of s.dragDrops || []) {
    if (!d.hasKeyboardAlternative) {
      violations.push({ rule: 'drag-drop-alt', impact: 'serious', target: d.id || 'dragdrop', help: 'Dragging must have a single-pointer keyboard alternative (2.5.7)' });
    }
  }

  // 1.1.1 — media alt text
  for (const m of s.media || []) {
    if (!m.hasAlt) {
      violations.push({ rule: 'image-alt', impact: 'serious', target: m.type || 'media', help: 'Media must have text alternative (1.1.1)' });
    }
  }

  const score = Math.max(0, Math.round(100 - violations.length * 5));
  return { violations, score, passes: score, wcagTarget: WCAG_TARGET, incomplete: 0 };
}

// ═══════════════════════════════════════════════════════════════════
// ARTIFACT QA (PDF/DOCX/PPTX)
// ═══════════════════════════════════════════════════════════════════

/** Reading order — artifact must expose logical content order (PDF/UA, DOCX headings, PPTX outline). */
export function assertArtifactReadingOrder({ artifactType = '', readingOrderOk = false, notes = '' } = {}) {
  if (!ARTIFACT_TYPES.includes(artifactType)) {
    return { ok: false, reason: `unsupported artifact type: ${artifactType}` };
  }
  if (!readingOrderOk) {
    return { ok: false, reason: `${artifactType} reading order is not exposed — tagged content required (PDF/UA, WCAG 1.3.2)`, notes };
  }
  return { ok: true, notes };
}

/** Alt text — every image/figure in the artifact must have a text alternative (1.1.1). */
export function assertArtifactAltText({ images = [], missingAlt = [] } = {}) {
  const missing = (missingAlt.length ? missingAlt : (images || []).filter((img) => !img.alt)).map((img) => (typeof img === 'string' ? img : img.src || img.id || 'image'));
  return { ok: missing.length === 0, missingAlt: missing };
}

/** Contrast issues list for artifact colors (1.4.3 — check each fg/bg pair). */
export function artifactContrastIssues({ pairs = [] } = {}) {
  const issues = [];
  for (const p of pairs || []) {
    const r = assertContrastAA({ fg: p.fg, bg: p.bg, fontSizePx: p.fontSizePx, bold: p.bold });
    if (!r.ok) issues.push({ label: p.label || `${p.fg} on ${p.bg}`, ratio: r.ratio, min: r.min });
  }
  return issues;
}

/** Tagged PDF (PDF/UA) is required for screen reader fidelity. */
export function assertTaggedPdf({ tagged = false } = {}) {
  return { ok: tagged === true, reason: tagged ? undefined : 'PDF must be tagged (PDF/UA) for screen reader order (1.3.2/4.1.2)' };
}

// ═══════════════════════════════════════════════════════════════════
// GAP CLASSIFICATION + ACR EVIDENCE
// ═══════════════════════════════════════════════════════════════════

/** Blockers block timed/high-stakes journeys (stop condition, Prompt 64 §24). */
export function classifyGap({ severity = GAP_SEVERITY.MAJOR, journey = 'student', isTimed = false } = {}) {
  const blocker = severity === GAP_SEVERITY.BLOCKER || (severity === GAP_SEVERITY.CRITICAL && isTimed);
  return { isBlocked: blocker, severity, journey, isTimed };
}

/** ACR evidence block — automated snapshot + needs_review flag (automated alone is not final). */
export function buildAcrEvidence({ journey = 'student', pageUrl = '', checks = null } = {}) {
  const r = checks || runAxeChecks({});
  return {
    journey,
    pageUrl,
    wcagTarget: WCAG_TARGET,
    score: r.score,
    passes: r.passes,
    violations: r.violations,
    incomplete: r.incomplete || 0,
    needsReview: true, // §15: automated checker yetarli emas — inson review kerak
    blockerCount: (r.violations || []).filter((v) => v.impact === 'critical').length,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SECURITY / DATA GUARD (Prompt 64 §15)
// ═══════════════════════════════════════════════════════════════════

/**
 * Guard: automated checker o'zi yetarli emas. Accessibility action
 * (gap close, artifact approve, audit sign-off) automated natijaga
 * ko'r-ko'rona ishonib strike bo'lmaydi — inson verification talab
 * qilinadi. Automated-only close reject qilinadi.
 */
export function assertAutomatedCheckIsNotFinal({ verifiedBy = '', automatedOnly = false } = {}) {
  if (automatedOnly && !verifiedBy) {
    return { ok: false, reason: 'automated accessibility checks are not final — human verification (ACR sign-off) is required (§15)' };
  }
  if (!verifiedBy && automatedOnly === false) {
    return { ok: false, reason: 'human verifier is required for accessibility sign-off' };
  }
  return { ok: true };
}

/** Validate supported locale-ish params (journey, artifact type, severity, status). */
export function assertValidEnum({ journey = '', artifactType = '', severity = '', status = '' } = {}) {
  if (journey && !JOURNEYS.includes(journey)) return { ok: false, reason: `invalid journey: ${journey}` };
  if (artifactType && !ARTIFACT_TYPES.includes(artifactType)) return { ok: false, reason: `invalid artifact type: ${artifactType}` };
  if (severity && !Object.values(GAP_SEVERITY).includes(severity)) return { ok: false, reason: `invalid severity: ${severity}` };
  if (status && !Object.values(GAP_STATUS).includes(status)) return { ok: false, reason: `invalid status: ${status}` };
  return { ok: true };
}

/** GAP FSM — verified requires verified_by; verified is terminal. */
export const GAP_TRANSITIONS = {
  open: ['in_progress', 'fixed'],
  in_progress: ['open', 'fixed'],
  fixed: ['verified', 'open'],
  verified: [], // terminal
};

/** Transition validation for gap status (plus human-verification requirement). */
export function assertGapTransition({ from = '', to = '', verifiedBy = '' } = {}) {
  if (!Object.values(GAP_STATUS).includes(from)) return { ok: false, reason: `invalid current status: ${from}` };
  if (!Object.values(GAP_STATUS).includes(to)) return { ok: false, reason: `invalid target status: ${to}` };
  const allowed = GAP_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `cannot transition gap ${from} → ${to}` };
  if (to === GAP_STATUS.VERIFIED && !verifiedBy) {
    return { ok: false, reason: 'verified status requires a human verifier (ACR sign-off, §15)' };
  }
  return { ok: true };
}
