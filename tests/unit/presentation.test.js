/**
 * Edikit — Canonical Presentation & Native Editor (unit tests, Prompt 56)
 *
 * Pure schema tekshiruvi (hech qanday DB/I-O yo'q):
 *   - Canonical document validation (§9.2).
 *   - Slide reorder (deterministic).
 *   - Version diff (slide/block-level §35.4).
 *   - AI design QA: overflow, contrast (WCAG), alt-text, word-count,
 *     title-length (§35.5).
 *   - Theme application.
 *   - Provider raw isolation (§15) — raw response canonical modeldan
 *     tashqariga chiqmaydi.
 *   - PPTX/PDF export skeleton.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePresentationDocument,
  validateSlideBlock,
  reorderSlides,
  diffVersions,
  checkOverflow,
  checkContrast,
  checkAltText,
  checkWordCount,
  checkTitleLength,
  runSlideQa,
  countWords,
  applyTheme,
  assertProviderRawIsolated,
  buildPptxSkeleton,
  buildPdfSkeleton,
  validateExportRequest,
  validateComment,
  BLOCK_TYPES,
  LAYOUTS,
  THEMES,
  EXPORT_FORMATS,
  QA_CHECKS,
  LAYOUT_BUDGETS,
} from '../../src/modules/presentation/index.js';

// ═══════════════════════════════════════════════════════════════════
// CANONICAL DOCUMENT VALIDATION (§9.2)
// ═══════════════════════════════════════════════════════════════════

describe('presentation — canonical document validation (Prompt 56 §07)', () => {
  const valid = {
    title: 'Fotosintez',
    audience: '8-sinf',
    language: 'uz',
    learningOutcomes: ['ATP sintezini tushuntiradi'],
    slides: [
      {
        id: 's1',
        layout: 'title-body',
        title: 'Yorug\u2018lik reaksiyalari',
        blocks: [
          { type: 'bullets', content: { items: ['ATP', 'NADPH'] } },
          { type: 'image', content: { assetId: 'a1' }, alt: 'Diagramma' },
        ],
        speakerNotes: 'Eslatma',
        citations: ['src_12'],
      },
    ],
    theme: 'default',
  };

  it('accepts a valid canonical document', () => {
    const r = validatePresentationDocument(valid);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects empty title and no slides', () => {
    expect(validatePresentationDocument({ slides: [] }).ok).toBe(false);
    expect(validatePresentationDocument({ title: 'x' }).ok).toBe(false);
  });

  it('rejects duplicate slide ids', () => {
    const dup = { ...valid, slides: [valid.slides[0], { ...valid.slides[0] }] };
    expect(validatePresentationDocument(dup).ok).toBe(false);
  });

  it('rejects unsupported layout and block type', () => {
    const badLayout = { ...valid, slides: [{ ...valid.slides[0], layout: 'magic' }] };
    expect(validatePresentationDocument(badLayout).ok).toBe(false);
    const badBlock = { ...valid, slides: [{ ...valid.slides[0], blocks: [{ type: 'embed' }] }] };
    expect(validatePresentationDocument(badBlock).ok).toBe(false);
  });

  it('rejects image block without alt text (accessibility)', () => {
    const noAlt = { ...valid, slides: [{ ...valid.slides[0], blocks: [{ type: 'image', content: { assetId: 'a1' } }] }] };
    const r = validatePresentationDocument(noAlt);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('alt'))).toBe(true);
  });

  it('rejects bad language tag', () => {
    expect(validatePresentationDocument({ ...valid, language: 'english' }).ok).toBe(false);
  });

  it('validateSlideBlock — bullets/chart/table requirements', () => {
    expect(validateSlideBlock({ type: 'bullets', content: { items: [] } }).ok).toBe(false);
    expect(validateSlideBlock({ type: 'chart', content: { chartType: 'donut' } }).ok).toBe(false);
    expect(validateSlideBlock({ type: 'chart', content: { chartType: 'pie' } }).ok).toBe(true);
    expect(validateSlideBlock({ type: 'table', content: { rows: [] } }).ok).toBe(false);
    expect(validateSlideBlock({ type: 'image', content: { url: 'x' }, alt: 'a' }).ok).toBe(true);
    expect(validateSlideBlock({ type: 'text', content: { text: ' ' } }).ok).toBe(false);
  });

  it('constants are complete', () => {
    expect(BLOCK_TYPES).toContain('image');
    expect(LAYOUTS).toContain('title-body-image');
    expect(THEMES).toContain('academic');
    expect(EXPORT_FORMATS).toEqual(['pptx', 'pdf']);
    expect(QA_CHECKS).toContain('contrast');
  });
});

// ═══════════════════════════════════════════════════════════════════
// REORDER (§35.1)
// ═══════════════════════════════════════════════════════════════════

describe('presentation — slide reorder (Prompt 56 §10)', () => {
  const slides = ['a', 'b', 'c'].map((id) => ({ id, title: id }));

  it('moves slide forward deterministically', () => {
    const r = reorderSlides(slides, 0, 2);
    expect(r.ok).toBe(true);
    expect(r.slides.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(r.slides[0].order).toBe(0);
    expect(r.slides[2].order).toBe(2);
  });

  it('moves slide backward', () => {
    const r = reorderSlides(slides, 2, 0);
    expect(r.slides.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('same index → no-op copy', () => {
    const r = reorderSlides(slides, 1, 1);
    expect(r.slides.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects out-of-range indices', () => {
    expect(reorderSlides(slides, -1, 1).ok).toBe(false);
    expect(reorderSlides(slides, 0, 5).ok).toBe(false);
    expect(reorderSlides([], 0, 0).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// VERSION DIFF (§35.4)
// ═══════════════════════════════════════════════════════════════════

describe('presentation — version diff (Prompt 56 §13)', () => {
  it('detects added/removed/changed slides', () => {
    const before = {
      slides: [
        { id: 's1', title: 'Intro', blocks: [{ type: 'text', content: { text: 'old' } }] },
        { id: 's2', title: 'Old slide', blocks: [] },
      ],
    };
    const after = {
      slides: [
        { id: 's1', title: 'Intro', blocks: [{ type: 'text', content: { text: 'new' } }] },
        { id: 's3', title: 'New slide', blocks: [] },
      ],
    };
    const r = diffVersions(before, after);
    expect(r.ok).toBe(true);
    expect(r.addedSlides.map((s) => s.id)).toEqual(['s3']);
    expect(r.removedSlides.map((s) => s.id)).toEqual(['s2']);
    expect(r.changedSlides.map((s) => s.id)).toEqual(['s1']);
    expect(r.summary).toEqual({ added: 1, removed: 1, changed: 1 });
  });

  it('identical docs → empty diff', () => {
    const r = diffVersions({ slides: [{ id: 's1', blocks: [] }] }, { slides: [{ id: 's1', blocks: [] }] });
    expect(r.summary).toEqual({ added: 0, removed: 0, changed: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// AI DESIGN QA (§35.5)
// ═══════════════════════════════════════════════════════════════════

describe('presentation — AI design QA (Prompt 56 §12)', () => {
  it('countWords counts correctly', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('a b c')).toBe(3);
    expect(countWords('  spaced   out  ')).toBe(2);
  });

  it('checkOverflow respects layout budget', () => {
    const budget = LAYOUT_BUDGETS['title-body'];
    const ok = checkOverflow({ layout: 'title-body', title: 'Qisqa', body: 'a '.repeat(budget.maxWords - 1) });
    expect(ok.ok).toBe(true);
    const over = checkOverflow({ layout: 'title-body', title: 'Qisqa', body: 'a '.repeat(budget.maxWords + 5) });
    expect(over.ok).toBe(false);
    expect(over.detail).toMatch(/words >/);
    const longTitle = checkOverflow({ layout: 'title-body', title: 'X'.repeat(80) });
    expect(longTitle.ok).toBe(false);
  });

  it('checkContrast — WCAG 4.5:1 passes for dark-on-light', () => {
    const r = checkContrast({ fg: '#1a1a2e', bg: '#ffffff', minRatio: 4.5 });
    expect(r.passes).toBe(true);
    expect(r.ratio).toBeGreaterThan(4.5);
  });

  it('checkContrast fails for low-contrast pair', () => {
    const r = checkContrast({ fg: '#888888', bg: '#ffffff', minRatio: 4.5 });
    expect(r.passes).toBe(false);
  });

  it('checkAltText flags image blocks without alt', () => {
    const r = checkAltText({ blocks: [
      { type: 'image', content: { url: 'x' } },
      { type: 'text', content: { text: 'hi' } },
      { type: 'image', content: { assetId: 'a' }, alt: 'ok' },
    ] });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([0]);
  });

  it('checkWordCount — max words per slide', () => {
    const r = checkWordCount({ slide: { title: 'T', blocks: [{ type: 'bullets', content: { items: ['a '.repeat(30)] } }] }, maxWords: 35 });
    expect(r.ok).toBe(true);
    const over = checkWordCount({ slide: { title: 'T', blocks: [{ type: 'bullets', content: { items: ['a '.repeat(70)] } }] }, maxWords: 35 });
    expect(over.ok).toBe(false);
  });

  it('checkTitleLength — <= 60 chars', () => {
    expect(checkTitleLength({ title: 'Qisqa sarlavha' }).ok).toBe(true);
    expect(checkTitleLength({ title: 'X'.repeat(61) }).ok).toBe(false);
  });

  it('runSlideQa — all checks present', () => {
    const r = runSlideQa({
      id: 's1',
      layout: 'title-body',
      title: 'Sarlavha',
      blocks: [{ type: 'text', content: { text: 'Qisqa matn' } }],
    });
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.type)).toEqual(QA_CHECKS);
  });
});

// ═══════════════════════════════════════════════════════════════════
// THEME (§35.1)
// ═══════════════════════════════════════════════════════════════════

describe('presentation — theme (Prompt 56 §10)', () => {
  it('applies theme tokens to doc', () => {
    const r = applyTheme({ theme: 'dark', doc: { title: 'X', slides: [{ id: 's1', blocks: [] }] } });
    expect(r.ok).toBe(true);
    expect(r.doc.theme).toBe('dark');
    expect(r.doc.themeTokens.bg).toBe('#0b0e1a');
    expect(r.doc.slides[0].theme).toBe('dark');
  });

  it('rejects unsupported theme', () => {
    expect(applyTheme({ theme: 'neon', doc: {} }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PROVIDER RAW ISOLATION (§15)
// ═══════════════════════════════════════════════════════════════════

describe('presentation — provider raw isolation (Prompt 56 §15)', () => {
  it('raw response fields do not leak outside canonical model', () => {
    const r = assertProviderRawIsolated({
      raw: { id: 'raw-123', secretToken: 'sk-xyz', internalScore: 0.9, title: 'deck' },
      canonical: { title: 'deck', slides: [] },
    });
    expect(r.ok).toBe(false);
    expect(r.leaked).toEqual(['id', 'secretToken', 'internalScore']);
  });

  it('allowed raw_ prefixed fields pass', () => {
    const r = assertProviderRawIsolated({
      raw: { raw_response: { nested: 1 }, provider: 'gamma', jobId: 'j1', status: 'done', title: 'deck' },
      canonical: { title: 'deck', slides: [] },
    });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXPORT SKELETON (§13, §35.2)
// ═══════════════════════════════════════════════════════════════════

describe('presentation — export skeleton (Prompt 56 §14)', () => {
  const doc = {
    title: 'Fotosintez',
    theme: 'default',
    aspectRatio: '16:9',
    slides: [
      { id: 's1', layout: 'title-body', title: 'Intro', blocks: [{ type: 'bullets', content: { items: ['A', 'B'] } }], speakerNotes: 'n', citations: ['c1'] },
    ],
  };

  it('buildPptxSkeleton — PptxGenJS structure', () => {
    const r = buildPptxSkeleton(doc);
    expect(r.ok).toBe(true);
    expect(r.skeleton.slideSize).toBe('16x9');
    expect(r.skeleton.slides[0].blocks[0].type).toBe('bullets');
    expect(r.skeleton.slides[0].speakerNotes).toBe('n');
  });

  it('buildPdfSkeleton — handout pages', () => {
    const r = buildPdfSkeleton(doc);
    expect(r.ok).toBe(true);
    expect(r.skeleton.handout).toBe(true);
    expect(r.skeleton.pages[0].textBlocks.length).toBe(1);
    expect(r.skeleton.pages[0].citations).toEqual(['c1']);
  });

  it('rejects empty deck export', () => {
    expect(buildPptxSkeleton({ slides: [] }).ok).toBe(false);
    expect(buildPdfSkeleton({ slides: [] }).ok).toBe(false);
  });

  it('validateExportRequest — pptx/pdf only', () => {
    expect(validateExportRequest({ format: 'pptx' }).ok).toBe(true);
    expect(validateExportRequest({ format: 'pdf' }).ok).toBe(true);
    expect(validateExportRequest({ format: 'docx' }).ok).toBe(false);
  });

  it('validateComment', () => {
    expect(validateComment({ body: 'Izoh' }).ok).toBe(true);
    expect(validateComment({ body: '' }).ok).toBe(false);
    expect(validateComment({ body: 'X'.repeat(2500) }).ok).toBe(false);
  });
});
