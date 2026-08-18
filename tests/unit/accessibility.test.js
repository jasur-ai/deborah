/**
 * Deborah — WCAG 2.2 AA & Artifact Accessibility (unit tests, Prompt 64)
 *
 * PURE schema testlari: contrast math (1.4.3/1.4.11), axe-style rule set
 * (landmark/heading/label/focus/skip-link/timer/target-size/reduced-motion/
 * drag-drop/alt), artifact QA (reading order/alt/contrast/tagged PDF),
 * gap classification + FSM, automated-check-not-final guard (§15).
 */

import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  isLargeText,
  assertContrastAA,
  runAxeChecks,
  assertArtifactReadingOrder,
  assertArtifactAltText,
  artifactContrastIssues,
  assertTaggedPdf,
  classifyGap,
  buildAcrEvidence,
  assertAutomatedCheckIsNotFinal,
  assertValidEnum,
  assertGapTransition,
  GAP_STATUS,
  GAP_SEVERITY,
  TOUCH_TARGET_MIN_PX,
} from '../../src/modules/accessibility/accessibility.schema.js';

describe('accessibility — WCAG contrast math (1.4.3/1.4.11)', () => {
  it('computes relative luminance from hex', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#000')).toEqual([0, 0, 0]);
    expect(hexToRgb('not-a-color')).toBeNull();
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 3);
  });

  it('contrast ratio — black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('AA contrast passes for 4.5:1 normal text', () => {
    // #333 on #fff ≈ 12.6:1
    expect(assertContrastAA({ fg: '#333333', bg: '#ffffff', fontSizePx: 16 }).ok).toBe(true);
    // #888 on #fff ≈ 3.5:1 — fails for normal text
    expect(assertContrastAA({ fg: '#888888', bg: '#ffffff', fontSizePx: 16 }).ok).toBe(false);
  });

  it('large text threshold — 3:1 for 24px or 18.66px bold', () => {
    expect(isLargeText({ fontSizePx: 24 })).toBe(true);
    expect(isLargeText({ fontSizePx: 18.66, bold: true })).toBe(true);
    expect(isLargeText({ fontSizePx: 16 })).toBe(false);
    // #888 on #fff fails normal but passes as large text
    expect(assertContrastAA({ fg: '#888888', bg: '#ffffff', fontSizePx: 24 }).ok).toBe(true);
  });
});

describe('accessibility — axe-style rule set', () => {
  it('clean snapshot passes', () => {
    const r = runAxeChecks({
      landmarks: ['banner', 'main', 'contentinfo'],
      headings: [{ level: 1 }, { level: 2 }, { level: 3 }],
      controls: [{ id: 'name', hasLabel: true, targetSizePx: 44 }],
      focusables: [{ selector: 'a', hasFocusIndicator: true }],
      skipLinks: ['#main'],
      timers: [{ id: 't1', hasLiveRegion: true }],
      dragDrops: [{ id: 'd1', hasKeyboardAlternative: true }],
      media: [{ type: 'img', hasAlt: true }],
    });
    expect(r.violations).toHaveLength(0);
    expect(r.wcagTarget).toBe('2.2-AA');
  });

  it('flags missing main landmark (1.3.1)', () => {
    const r = runAxeChecks({ landmarks: ['banner'] });
    expect(r.violations.some((v) => v.rule === 'landmark-one-main')).toBe(true);
  });

  it('flags heading level skip (2.4.6)', () => {
    const r = runAxeChecks({ headings: [{ level: 1 }, { level: 3 }] });
    expect(r.violations.some((v) => v.rule === 'heading-order')).toBe(true);
  });

  it('flags unlabeled controls (1.1.1/4.1.2)', () => {
    const r = runAxeChecks({ controls: [{ id: 'x', hasLabel: false, targetSizePx: 44 }] });
    expect(r.violations.some((v) => v.rule === 'label')).toBe(true);
  });

  it('flags invisible focus (2.4.7)', () => {
    const r = runAxeChecks({ focusables: [{ selector: 'button', hasFocusIndicator: false }] });
    expect(r.violations.some((v) => v.rule === 'focus-visible')).toBe(true);
  });

  it('flags missing skip link when page has focusables (2.4.1)', () => {
    const r = runAxeChecks({ focusables: [{ selector: 'a', hasFocusIndicator: true }], skipLinks: [] });
    expect(r.violations.some((v) => v.rule === 'skip-link')).toBe(true);
    // Clean page with skip link passes
    const ok = runAxeChecks({ focusables: [{ selector: 'a', hasFocusIndicator: true }], skipLinks: ['#main'] });
    expect(ok.violations.some((v) => v.rule === 'skip-link')).toBe(false);
  });

  it('flags timer without live region (2.2.1/4.1.3) as critical', () => {
    const r = runAxeChecks({ timers: [{ id: 'quizTimer', hasLiveRegion: false }] });
    expect(r.violations.some((v) => v.rule === 'timer-live-region' && v.impact === 'critical')).toBe(true);
  });

  it('flags touch targets below 44px (2.5.8)', () => {
    const r = runAxeChecks({ controls: [{ id: 'small', hasLabel: true, targetSizePx: 24 }] });
    expect(r.violations.some((v) => v.rule === 'target-size')).toBe(true);
    expect(TOUCH_TARGET_MIN_PX).toBe(44);
  });

  it('flags animation under reduced motion (2.3.3)', () => {
    const r = runAxeChecks({ prefersReducedMotion: true, hasAnimation: true });
    expect(r.violations.some((v) => v.rule === 'reduced-motion')).toBe(true);
  });

  it('flags drag-drop without keyboard alternative (2.5.7)', () => {
    const r = runAxeChecks({ dragDrops: [{ id: 'sort', hasKeyboardAlternative: false }] });
    expect(r.violations.some((v) => v.rule === 'drag-drop-alt')).toBe(true);
  });

  it('flags media without alt text (1.1.1)', () => {
    const r = runAxeChecks({ media: [{ type: 'img', hasAlt: false }] });
    expect(r.violations.some((v) => v.rule === 'image-alt')).toBe(true);
  });
});

describe('accessibility — artifact QA (PDF/DOCX/PPTX)', () => {
  it('validates artifact type', () => {
    expect(assertArtifactReadingOrder({ artifactType: 'pdf', readingOrderOk: false }).ok).toBe(false);
    expect(assertArtifactReadingOrder({ artifactType: 'docx', readingOrderOk: true }).ok).toBe(true);
    expect(assertArtifactReadingOrder({ artifactType: 'exe', readingOrderOk: true }).ok).toBe(false);
  });

  it('requires reading order for tagged content (1.3.2)', () => {
    const r = assertArtifactReadingOrder({ artifactType: 'pdf', readingOrderOk: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/reading order/i);
  });

  it('collects missing alt text (1.1.1)', () => {
    const r = assertArtifactAltText({ images: [{ src: 'a.png', alt: 'x' }, { src: 'b.png', alt: '' }] });
    expect(r.ok).toBe(false);
    expect(r.missingAlt).toContain('b.png');
  });

  it('finds contrast issues in artifact color pairs (1.4.3)', () => {
    const issues = artifactContrastIssues({ pairs: [
      { fg: '#333333', bg: '#ffffff', fontSizePx: 16, label: 'body' },
      { fg: '#888888', bg: '#ffffff', fontSizePx: 12, label: 'muted' },
    ] });
    expect(issues).toHaveLength(1);
    expect(issues[0].label).toBe('muted');
  });

  it('requires tagged PDF (PDF/UA)', () => {
    expect(assertTaggedPdf({ tagged: false }).ok).toBe(false);
    expect(assertTaggedPdf({ tagged: true }).ok).toBe(true);
  });
});

describe('accessibility — gap classification + ACR + guards', () => {
  it('blocker classification for timed critical journeys', () => {
    expect(classifyGap({ severity: GAP_SEVERITY.BLOCKER }).isBlocked).toBe(true);
    expect(classifyGap({ severity: GAP_SEVERITY.CRITICAL, isTimed: true }).isBlocked).toBe(true);
    expect(classifyGap({ severity: GAP_SEVERITY.MINOR }).isBlocked).toBe(false);
  });

  it('ACR evidence always requires human review (§15)', () => {
    const ev = buildAcrEvidence({ journey: 'student', pageUrl: '/exam', checks: runAxeChecks({}) });
    expect(ev.needsReview).toBe(true);
    expect(ev.wcagTarget).toBe('2.2-AA');
  });

  it('automated-only checks are never final (§15)', () => {
    expect(assertAutomatedCheckIsNotFinal({ automatedOnly: true }).ok).toBe(false);
    expect(assertAutomatedCheckIsNotFinal({ verifiedBy: 'admin' }).ok).toBe(true);
  });

  it('enum validation', () => {
    expect(assertValidEnum({ journey: 'proctor' }).ok).toBe(true);
    expect(assertValidEnum({ journey: 'robot' }).ok).toBe(false);
    expect(assertValidEnum({ artifactType: 'pptx' }).ok).toBe(true);
    expect(assertValidEnum({ severity: 'critical' }).ok).toBe(true);
  });

  it('gap FSM — verified requires human verifier', () => {
    expect(assertGapTransition({ from: 'open', to: 'verified' }).ok).toBe(false);
    expect(assertGapTransition({ from: 'open', to: 'in_progress' }).ok).toBe(true);
    expect(assertGapTransition({ from: 'fixed', to: 'verified', verifiedBy: 'admin' }).ok).toBe(true);
    expect(assertGapTransition({ from: 'verified', to: 'open' }).ok).toBe(false); // terminal
    expect(assertGapTransition({ from: 'open', to: 'bogus' }).ok).toBe(false);
    expect(GAP_STATUS.VERIFIED).toBe('verified');
  });
});
