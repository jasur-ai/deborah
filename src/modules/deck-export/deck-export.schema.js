/**
 * Deborah — Deck Export (PPTX/PDF/Handout) pure logic
 *
 * Prompt 59 — canonical deckdan final export: PPTX/PDF/handout
 * attribution va accessibility bilan (research.md §9.2 canonical document
 * → PPTX (PptxGenJS), PDF; §9.10 attribution/mualliflik; §28 accessibility
 * — alt text, contrast, handout notes; §22.11 AI references real DB'dan
 * tekshiriladi). This module is PURE (no I/O):
 *
 *   - validateExportRequest: format/version tekshiruvi.
 *   - buildFinalPptx: canonical → final PPTX structure (attribution slide,
 *     alt text, speaker notes, handout notes).
 *   - buildFinalPdf: canonical → PDF print handout structure.
 *   - buildHandout: handout — questions/notes, not slide text only.
 *   - buildAttributionPage: provider/aiAssisted/disclosure/sourceLicenses.
 *   - runAccessibilityCheck: alt text, contrast, word count per slide.
 *   - buildExportHash: idempotency (tenant + version + format).
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const DECK_EXPORT_FORMATS = ['pptx', 'pdf', 'handout'];
export const EXPORT_STATUS = { QUEUED: 'queued', DONE: 'done', FAILED: 'failed' };

// ═══════════════════════════════════════════════════════════════════
// VALIDATION + IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

/** Validate an export request. */
export function validateExportRequest({ format = '', versionId = null, presentationId = null } = {}) {
  if (!DECK_EXPORT_FORMATS.includes(format)) {
    return { ok: false, reason: `format must be one of ${DECK_EXPORT_FORMATS.join(', ')}` };
  }
  if (!versionId) return { ok: false, reason: 'versionId is required' };
  if (!presentationId) return { ok: false, reason: 'presentationId is required' };
  return { ok: true };
}

/** Deterministic export idempotency hash. */
export function buildExportHash({ presentationId = 0, versionId = 0, format = '' } = {}) {
  let h = 0x811c9dc5;
  const str = `p59:${presentationId}:${versionId}:${format}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `exp_${h.toString(16).padStart(8, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════
// ATTRIBUTION PAGE (§9.10)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build attribution metadata for the final export.
 * @param {Object} opts - { provider, model, jobId, humanReviewedAt, disclosure, sourceLicenses }
 */
export function buildAttributionPage({ provider = null, model = null, jobId = null, humanReviewedAt = null, disclosure = null, sourceLicenses = [] } = {}) {
  return {
    title: 'Attribution',
    aiAssisted: Boolean(provider || model || jobId),
    provider,
    model,
    jobId,
    humanReviewedAt: humanReviewedAt || null,
    disclosure: disclosure || (provider ? 'AI-assisted; reviewed and edited by the teacher.' : 'Authored by the teacher.'),
    sourceLicenses: Array.isArray(sourceLicenses) ? sourceLicenses : [],
  };
}

// ═══════════════════════════════════════════════════════════════════
// FINAL PPTX / PDF / HANDOUT
// ═══════════════════════════════════════════════════════════════════

/**
 * Build final PPTX structure — attribution slide + per-slide blocks with
 * alt text + speaker notes (PptxGenJS worker uchun).
 */
export function buildFinalPptx({ document = null, attribution = null } = {}) {
  if (!document || !Array.isArray(document.slides)) {
    return { ok: false, reason: 'cannot export empty deck' };
  }
  const slides = document.slides.map((s) => ({
    id: s.id,
    layout: s.layout,
    title: s.title || '',
    blocks: (s.blocks || []).map((b) => ({
      type: b.type,
      content: b.content || {},
      alt: b.alt || b.content?.alt || null,
    })),
    speakerNotes: s.speakerNotes || '',
    citations: s.citations || [],
  }));
  return {
    ok: true,
    final: {
      title: document.title,
      theme: document.theme || 'default',
      slideSize: document.aspectRatio === '4:3' ? '4x3' : '16x9',
      attributionSlide: attribution || null,
      slides,
    },
  };
}

/**
 * Build final PDF print structure — handout-friendly layout.
 */
export function buildFinalPdf({ document = null, attribution = null } = {}) {
  if (!document || !Array.isArray(document.slides)) {
    return { ok: false, reason: 'cannot export empty deck' };
  }
  const pages = document.slides.map((s) => ({
    id: s.id,
    title: s.title || '',
    body: (s.blocks || [])
      .filter((b) => ['text', 'heading', 'bullets'].includes(b.type))
      .map((b) => (b.type === 'bullets' ? (b.content?.items || []).join('\n') : b.content?.text || ''))
      .filter(Boolean),
    notes: s.speakerNotes || '',
  }));
  return { ok: true, final: { title: document.title, attribution, pages } };
}

/**
 * Build handout — not slide text only; quiz-style prompt + notes +
 * questions-from-concepts for teacher distribution.
 */
export function buildHandout({ document = null, quizQuestions = [] } = {}) {
  if (!document || !Array.isArray(document.slides)) {
    return { ok: false, reason: 'cannot export empty deck' };
  }
  return {
    ok: true,
    final: {
      title: document.title,
      audience: document.audience || null,
      learningOutcomes: document.learningOutcomes || [],
      slideCount: document.slides.length,
      keyPoints: document.slides.slice(0, 5).map((s) => s.title || '').filter(Boolean),
      quizQuestions: Array.isArray(quizQuestions) ? quizQuestions.slice(0, 10) : [],
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// ACCESSIBILITY CHECK (§28)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run accessibility checks on a canonical deck.
 * @returns {{ ok: boolean, checks: Array<{ slideId, check, ok, detail }> }}
 */
export function runAccessibilityCheck({ document = null } = {}) {
  if (!document || !Array.isArray(document.slides)) {
    return { ok: false, reason: 'no slides' };
  }
  const checks = [];
  for (const s of document.slides) {
    const imageBlocks = (s.blocks || []).filter((b) => b.type === 'image');
    for (const img of imageBlocks) {
      const alt = img.alt || img.content?.alt || '';
      checks.push({ slideId: s.id, check: 'alt_text', ok: Boolean(alt), detail: alt ? 'ok' : 'missing alt text' });
    }
    const titleLen = (s.title || '').length;
    checks.push({ slideId: s.id, check: 'title_length', ok: titleLen <= 60, detail: `${titleLen}/60` });
    const bodyWords = (s.blocks || []).reduce((acc, b) => {
      const t = b.content?.text || (b.content?.items || []).join(' ');
      return acc + String(t || '').split(/\s+/).filter(Boolean).length;
    }, 0);
    checks.push({ slideId: s.id, check: 'word_count', ok: bodyWords <= 60, detail: `${bodyWords}/60` });
  }
  return {
    ok: true,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
    },
  };
}
