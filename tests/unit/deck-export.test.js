/**
 * Deborah — Deck Export (unit tests, Prompt 59)
 *
 * Pure schema: export request validation + idempotency hash, attribution
 * page (§9.10), final PPTX/PDF/handout builders, accessibility check
 * (§28 — alt text, title length, word count).
 */

import { describe, it, expect } from 'vitest';
import {
  validateExportRequest,
  buildExportHash,
  buildAttributionPage,
  buildFinalPptx,
  buildFinalPdf,
  buildHandout,
  runAccessibilityCheck,
  DECK_EXPORT_FORMATS,
} from '../../src/modules/deck-export/index.js';

const doc = {
  title: 'Fotosintez',
  theme: 'academic',
  aspectRatio: '16:9',
  learningOutcomes: ['Fotosintez jarayonini tushuntirish'],
  slides: [
    {
      id: 's1',
      title: 'Kirish',
      layout: 'title',
      speakerNotes: 'Fotosintez — o\'simliklarda energiya ishlab chiqarish.',
      blocks: [
        { type: 'heading', content: { heading: 'Fotosintez' }, alt: null },
        { type: 'bullets', content: { items: ['Xlorofill', 'Quyosh nuri'] } },
        { type: 'image', content: { url: 'x', alt: 'Fotosintez diagrammasi' }, alt: 'Fotosintez diagrammasi' },
      ],
      citations: [{ id: 1 }],
    },
    { id: 's2', title: 'Xulosa', layout: 'content', speakerNotes: '', blocks: [{ type: 'text', content: { text: 'Short' } }], citations: [] },
  ],
};

describe('deck-export — validation + idempotency', () => {
  it('accepts all supported formats', () => {
    for (const f of DECK_EXPORT_FORMATS) {
      expect(validateExportRequest({ format: f, versionId: 1, presentationId: 1 }).ok).toBe(true);
    }
  });

  it('rejects unknown format', () => {
    const r = validateExportRequest({ format: 'exe', versionId: 1, presentationId: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/format must be/i);
  });

  it('rejects missing version/presentation', () => {
    expect(validateExportRequest({ format: 'pptx' }).ok).toBe(false);
  });

  it('produces deterministic hash (idempotency)', () => {
    const a = buildExportHash({ presentationId: 7, versionId: 3, format: 'pptx' });
    const b = buildExportHash({ presentationId: 7, versionId: 3, format: 'pptx' });
    const c = buildExportHash({ presentationId: 7, versionId: 4, format: 'pptx' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^exp_/);
  });
});

describe('deck-export — attribution page (§9.10)', () => {
  it('marks AI-assisted when provider present', () => {
    const a = buildAttributionPage({ provider: 'claude', model: 'claude-3', jobId: 9, humanReviewedAt: '2026-01-01' });
    expect(a.aiAssisted).toBe(true);
    expect(a.provider).toBe('claude');
    expect(a.disclosure).toMatch(/AI-assisted/i);
  });

  it('marks human-authored when no provider', () => {
    const a = buildAttributionPage({});
    expect(a.aiAssisted).toBe(false);
    expect(a.disclosure).toMatch(/Authored by the teacher/i);
  });

  it('preserves source licenses', () => {
    const a = buildAttributionPage({ sourceLicenses: ['CC BY 4.0'] });
    expect(a.sourceLicenses).toContain('CC BY 4.0');
  });
});

describe('deck-export — final PPTX/PDF/handout', () => {
  it('builds final PPTX with alt text + speaker notes', () => {
    const r = buildFinalPptx({ document: doc, attribution: buildAttributionPage({ provider: 'claude' }) });
    expect(r.ok).toBe(true);
    expect(r.final.slideSize).toBe('16x9');
    expect(r.final.attributionSlide.aiAssisted).toBe(true);
    expect(r.final.slides).toHaveLength(2);
    expect(r.final.slides[0].blocks.some((b) => b.alt === 'Fotosintez diagrammasi')).toBe(true);
  });

  it('rejects empty deck', () => {
    expect(buildFinalPptx({ document: {} }).ok).toBe(false);
  });

  it('builds final PDF pages with notes', () => {
    const r = buildFinalPdf({ document: doc });
    expect(r.ok).toBe(true);
    expect(r.final.pages[0].notes).toMatch(/Fotosintez/);
    expect(r.final.pages[0].body.some((b) => b.includes('Xlorofill'))).toBe(true);
  });

  it('builds handout with quiz questions (max 10)', () => {
    const r = buildHandout({ document: doc, quizQuestions: Array.from({ length: 15 }, (_, i) => ({ id: i })) });
    expect(r.ok).toBe(true);
    expect(r.final.quizQuestions).toHaveLength(10);
    expect(r.final.slideCount).toBe(2);
  });
});

describe('deck-export — accessibility check (§28)', () => {
  it('passes with alt text and short slides', () => {
    const r = runAccessibilityCheck({ document: doc });
    expect(r.ok).toBe(true);
    expect(r.summary.passed).toBeGreaterThan(0);
    const altCheck = r.checks.find((c) => c.check === 'alt_text');
    expect(altCheck.ok).toBe(true);
  });

  it('flags missing alt text', () => {
    const bad = {
      slides: [{ id: 's1', title: '', blocks: [{ type: 'image', content: { url: 'x' } }] }],
    };
    const r = runAccessibilityCheck({ document: bad });
    const altCheck = r.checks.find((c) => c.check === 'alt_text');
    expect(altCheck.ok).toBe(false);
    expect(altCheck.detail).toMatch(/missing alt text/i);
  });

  it('rejects document without slides', () => {
    expect(runAccessibilityCheck({ document: {} }).ok).toBe(false);
  });
});
