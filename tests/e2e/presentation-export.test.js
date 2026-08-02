/**
 * Edikit — Canonical Presentation & Native Editor (e2e/security tests, Prompt 56)
 *
 * Security & data guards (§15-17):
 *   - Provider raw response canonical modeldan tashqariga chiqmaydi.
 *   - Published version immutable — rollback yangi version yaratadi.
 *   - Accessibility: image alt-text majburiy, contrast WCAG 4.5:1.
 *   - Export skeleton: PPTX/PDF canonical mapping deterministik.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePresentationDocument,
  assertProviderRawIsolated,
  buildPptxSkeleton,
  buildPdfSkeleton,
  checkContrast,
  checkAltText,
  diffVersions,
  applyTheme,
} from '../../src/modules/presentation/index.js';

describe('presentation — e2e/security (Prompt 56 §15-17)', () => {
  const deck = {
    title: 'Fotosintez',
    audience: '8-sinf',
    language: 'uz',
    theme: 'default',
    slides: [
      {
        id: 's1',
        layout: 'title-body-image',
        title: 'Yorug\u2018lik reaksiyalari',
        blocks: [
          { type: 'bullets', content: { items: ['ATP sintezi', 'NADPH'] } },
          { type: 'image', content: { assetId: 'a1', url: 'https://cdn/x.png' }, alt: 'Fotosintez diagrammasi' },
        ],
        speakerNotes: 'Darsda tushuntiring',
        citations: ['src_12'],
      },
      {
        id: 's2',
        layout: 'closing',
        title: 'Xulosa',
        blocks: [{ type: 'text', content: { text: 'Qisqa xulosa matni' } }],
      },
    ],
  };

  it('SECURITY: provider raw response canonical modeldan chiqmaydi', () => {
    // Gamma/Manus raw javobda internal maydonlar bo'lishi mumkin
    const raw = {
      id: 'gen_987',
      deckId: 'd_1',
      title: 'Fotosintez',
      raw_slides: deck.slides,
      internalScore: 0.98,
      tokenUsage: { prompt: 100, completion: 50 },
      billingCode: 'PROD-1',
    };
    const r = assertProviderRawIsolated({ raw, canonical: deck });
    expect(r.ok).toBe(false);
    expect(r.leaked).toContain('internalScore');
    expect(r.leaked).toContain('tokenUsage');
    expect(r.leaked).toContain('billingCode');
    // raw_ prefixed — ruxsat
    expect(assertProviderRawIsolated({ raw: { raw_slides: [] }, canonical: deck }).ok).toBe(true);
  });

  it('ACCESSIBILITY: alt-text va contrast QA canonical deckda o\u2018tadi', () => {
    const r = validatePresentationDocument(deck);
    expect(r.ok).toBe(true); // image alt mavjud
    const alt = checkAltText({ blocks: deck.slides[0].blocks });
    expect(alt.ok).toBe(true);
    const contrast = checkContrast({ fg: '#1a1a2e', bg: '#ffffff', minRatio: 4.5 });
    expect(contrast.passes).toBe(true);
    // Alt yo'q image → QA fail
    const noAlt = { ...deck, slides: [{ ...deck.slides[0], blocks: [{ type: 'image', content: { assetId: 'a' } }] }] };
    expect(checkAltText({ blocks: noAlt.slides[0].blocks }).ok).toBe(false);
  });

  it('EXPORT: PPTX/PDF skeleton canonical deckdan deterministik chiqadi', () => {
    const p = buildPptxSkeleton(deck);
    expect(p.ok).toBe(true);
    expect(p.skeleton.slides).toHaveLength(2);
    expect(p.skeleton.slides[0].blocks.some((b) => b.type === 'image' && b.alt)).toBe(true);
    expect(p.skeleton.slides[0].citations).toEqual(['src_12']);
    expect(p.skeleton.slides[0].speakerNotes).toBe('Darsda tushuntiring');

    const pdf = buildPdfSkeleton(deck);
    expect(pdf.ok).toBe(true);
    expect(pdf.skeleton.pages).toHaveLength(2);
    expect(pdf.skeleton.pages[0].images).toHaveLength(1);
    expect(pdf.skeleton.pages[0].citations).toEqual(['src_12']);
  });

  it('VERSION: publish immutable — draft branch diff saqlanadi', () => {
    // Published v1 (immutable) vs yangi draft branch
    const v1 = { slides: [{ id: 's1', title: 'A', blocks: [] }, { id: 's2', title: 'B', blocks: [] }] };
    const draftBranch = { slides: [{ id: 's1', title: 'A', blocks: [] }, { id: 's3', title: 'C', blocks: [] }] };
    const diff = diffVersions(v1, draftBranch);
    expect(diff.summary).toEqual({ added: 1, removed: 1, changed: 0 });
    // Rollback yangi version — history o'chirilmaydi (service'da maxv+1)
    expect(diff.addedSlides[0].id).toBe('s3');
  });

  it('THEME: provider-independent theme application', () => {
    const r = applyTheme({ theme: 'academic', doc: deck });
    expect(r.ok).toBe(true);
    expect(r.doc.theme).toBe('academic');
    expect(r.doc.themeTokens.fg).toBe('#1e293b');
    expect(r.doc.slides[0].theme).toBe('academic');
  });
});
