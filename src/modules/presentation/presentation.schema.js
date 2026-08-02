/**
 * Edikit — Canonical Presentation & Native Editor MVP (pure logic)
 *
 * Prompt 56 — provider-independent slide document, outline flow va
 * accessible native editor (research.md §9.2 canonical document, §35
 * native editor, §35.5 AI design QA). This module is PURE (no I/O):
 *
 *   - validatePresentationDocument: canonical schema validation (§9.2).
 *   - reorderSlides: deterministic slide reorder.
 *   - diffVersions: slide/block/source-level diff (§35.4).
 *   - QA checks: overflow, contrast (WCAG), alt-text, word-count,
 *     title-length (§35.5).
 *   - applyTheme: theme → colors/fonts application.
 *   - assertProviderRawIsolated: provider raw response canonical modeldan
 *     tashqariga chiqmaydi (§15).
 *   - buildPptxSkeleton / buildPdfSkeleton: export worker skeleton.
 *
 * SECURITY / DATA GUARD (Prompt 56 §15-17):
 *   - Provider raw response faqat canonical document ichida saqlanadi.
 *   - Published version immutable — rollback yangi version yaratadi.
 *   - Har bir write path tenant-scoped + idempotent.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Presentation status. */
export const PRESENTATION_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

/** Version status — publish = immutable snapshot (§35.4). */
export const VERSION_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
};

/** Supported block types (§35.1). */
export const BLOCK_TYPES = ['text', 'heading', 'bullets', 'image', 'chart', 'table'];

/** Supported layouts. */
export const LAYOUTS = [
  'title',
  'title-body',
  'title-body-image',
  'title-image',
  'section-header',
  'quote',
  'agenda',
  'closing',
];

/** Supported themes. */
export const THEMES = ['default', 'dark', 'light', 'academic', 'playful'];

/** Supported export formats. */
export const EXPORT_FORMATS = ['pptx', 'pdf'];

/** QA check types (§35.5). */
export const QA_CHECKS = ['overflow', 'contrast', 'alt_text', 'word_count', 'title_length'];

/** Default layout budgets (words/chars per layout) — overflow detector. */
export const LAYOUT_BUDGETS = {
  title: { maxWords: 12, maxTitleChars: 60 },
  'title-body': { maxWords: 40, maxTitleChars: 60 },
  'title-body-image': { maxWords: 32, maxTitleChars: 60 },
  'title-image': { maxWords: 12, maxTitleChars: 60 },
  'section-header': { maxWords: 8, maxTitleChars: 50 },
  quote: { maxWords: 30, maxTitleChars: 80 },
  agenda: { maxWords: 24, maxTitleChars: 60 },
  closing: { maxWords: 20, maxTitleChars: 60 },
};

/** Theme palette — foreground/background for contrast QA. */
export const THEME_PALETTES = {
  default: { fg: '#1a1a2e', bg: '#ffffff' },
  dark: { fg: '#f5f5f7', bg: '#0b0e1a' },
  light: { fg: '#1a1a2e', bg: '#f5f5f7' },
  academic: { fg: '#1e293b', bg: '#f8fafc' },
  playful: { fg: '#4c1d95', bg: '#fdf4ff' },
};

// ═══════════════════════════════════════════════════════════════════
// CANONICAL DOCUMENT VALIDATION (§9.2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a canonical presentation document (§9.2).
 * @param {Object} doc - { title, audience, language, learningOutcomes, slides, theme }
 * @returns {{ ok: boolean, errors: Array<string>, reason?: string }}
 */
export function validatePresentationDocument(doc = {}) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['document is required'] };
  if (!doc.title || typeof doc.title !== 'string' || !doc.title.trim()) {
    errors.push('title is required');
  }
  if (doc.title && String(doc.title).length > 200) errors.push('title exceeds 200 chars');
  if (doc.language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(doc.language)) errors.push('language must be a BCP-47 tag');
  if (!Array.isArray(doc.slides)) {
    errors.push('slides must be an array');
    return { ok: false, errors };
  }
  if (doc.slides.length === 0) errors.push('at least one slide is required');
  if (doc.slides.length > 200) errors.push('too many slides (max 200)');

  const slideIds = new Set();
  doc.slides.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      errors.push(`slide ${i}: must be an object`);
      return;
    }
    if (!s.id) errors.push(`slide ${i}: id is required`);
    if (slideIds.has(s.id)) errors.push(`slide ${i}: duplicate id ${s.id}`);
    slideIds.add(s.id);
    if (s.layout && !LAYOUTS.includes(s.layout)) {
      errors.push(`slide ${i}: unsupported layout ${s.layout}`);
    }
    if (s.title && String(s.title).length > 200) errors.push(`slide ${i}: title exceeds 200 chars`);
    if (!Array.isArray(s.blocks)) {
      errors.push(`slide ${i}: blocks must be an array`);
      return;
    }
    s.blocks.forEach((b, j) => {
      if (!b || typeof b !== 'object') {
        errors.push(`slide ${i} block ${j}: must be an object`);
        return;
      }
      if (!BLOCK_TYPES.includes(b.type)) {
        errors.push(`slide ${i} block ${j}: unsupported type ${b.type}`);
      }
      // Image alt: top-level alt yoki content.alt (validateSlideBlock bilan mos)
      if (b.type === 'image' && !b.alt && !b.content?.alt) {
        errors.push(`slide ${i} block ${j}: image requires alt text`);
      }
    });
  });
  return { ok: errors.length === 0, errors, reason: errors.length ? errors.join('; ') : undefined };
}

/**
 * Validate a single slide block.
 * @param {Object} block - { type, content }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateSlideBlock(block = {}) {
  if (!block || typeof block !== 'object') return { ok: false, reason: 'block is required' };
  if (!BLOCK_TYPES.includes(block.type)) {
    return { ok: false, reason: `unsupported block type ${block.type}` };
  }
  const c = block.content || {};
  switch (block.type) {
    case 'bullets':
      if (!Array.isArray(c.items) || c.items.length === 0) {
        return { ok: false, reason: 'bullets block requires items array' };
      }
      break;
    case 'image':
      if (!c.assetId && !c.url) return { ok: false, reason: 'image block requires assetId or url' };
      if (!block.alt && !c.alt) return { ok: false, reason: 'image block requires alt text' };
      break;
    case 'chart':
      if (!c.chartType || !['bar', 'line', 'pie'].includes(c.chartType)) {
        return { ok: false, reason: 'chart block requires valid chartType' };
      }
      break;
    case 'table':
      if (!Array.isArray(c.rows) || c.rows.length === 0) {
        return { ok: false, reason: 'table block requires rows array' };
      }
      break;
    default:
      if (typeof c.text !== 'string' || !c.text.trim()) {
        return { ok: false, reason: `${block.type} block requires content.text` };
      }
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// REORDER / DIFF (§35.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministic slide reorder (0-based indices).
 * @param {Array<Object>} slides
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {{ ok: boolean, slides: Array<Object>, reason?: string }}
 */
export function reorderSlides(slides = [], fromIndex = -1, toIndex = -1) {
  if (!Array.isArray(slides) || slides.length === 0) return { ok: false, reason: 'slides are required' };
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return { ok: false, reason: 'indices must be integers' };
  if (from < 0 || from >= slides.length) return { ok: false, reason: `fromIndex out of range 0..${slides.length - 1}` };
  if (to < 0 || to >= slides.length) return { ok: false, reason: `toIndex out of range 0..${slides.length - 1}` };
  if (from === to) return { ok: true, slides: [...slides] };
  const arr = [...slides];
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  // Normalize slide order (0..n-1)
  arr.forEach((s, i) => { if (s && typeof s === 'object') s.order = i; });
  return { ok: true, slides: arr };
}

/**
 * Diff two version documents at slide/block level (§35.4).
 * @param {Object} before
 * @param {Object} after
 * @returns {{ ok: boolean, addedSlides: Array, removedSlides: Array, changedSlides: Array, summary: Object }}
 */
export function diffVersions(before = {}, after = {}) {
  const bSlides = Array.isArray(before.slides) ? before.slides : [];
  const aSlides = Array.isArray(after.slides) ? after.slides : [];
  const bMap = new Map(bSlides.map((s) => [s.id, s]));
  const aMap = new Map(aSlides.map((s) => [s.id, s]));
  const addedSlides = aSlides.filter((s) => !bMap.has(s.id));
  const removedSlides = bSlides.filter((s) => !aMap.has(s.id));
  const changedSlides = [];
  for (const s of aSlides) {
    const b = bMap.get(s.id);
    if (b && JSON.stringify(b.blocks || []) !== JSON.stringify(s.blocks || [])) {
      changedSlides.push({ id: s.id, title: s.title });
    }
  }
  return {
    ok: true,
    addedSlides,
    removedSlides,
    changedSlides,
    summary: {
      added: addedSlides.length,
      removed: removedSlides.length,
      changed: changedSlides.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// AI DESIGN QA (§35.5)
// ═══════════════════════════════════════════════════════════════════

/** Count words in a text string. */
export function countWords(text = '') {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Overflow detector — layout budget bo'yicha words/chars tekshiruvi.
 * @param {Object} params - { layout, title, body }
 * @returns {{ ok: boolean, detail?: string }}
 */
export function checkOverflow({ layout = 'title-body', title = '', body = '' } = {}) {
  const budget = LAYOUT_BUDGETS[layout] || LAYOUT_BUDGETS['title-body'];
  const words = countWords(body);
  const titleLen = String(title || '').length;
  if (titleLen > budget.maxTitleChars) {
    return { ok: false, detail: `title ${titleLen} chars > ${budget.maxTitleChars} max` };
  }
  if (words > budget.maxWords) {
    return { ok: false, detail: `${words} words > ${budget.maxWords} max for ${layout}` };
  }
  return { ok: true, detail: `${words} words, title ${titleLen} chars` };
}

/**
 * WCAG contrast ratio (1..21). Simple luminance-based.
 * @param {Object} params - { fg, bg } hex colors
 * @returns {{ ok: boolean, ratio: number, passes: boolean, detail?: string }}
 */
export function checkContrast({ fg = '#ffffff', bg = '#000000', minRatio = 4.5 } = {}) {
  const lum = (hex) => {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = parseInt(full.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(fg);
  const l2 = lum(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const passes = ratio >= minRatio;
  return { ok: true, ratio: Number(ratio.toFixed(2)), passes, detail: passes ? undefined : `contrast ${ratio.toFixed(2)} < ${minRatio}` };
}

/**
 * Alt-text check — image blocks alt talab qiladi (accessibility).
 * @param {Object} params - { blocks }
 * @returns {{ ok: boolean, missing: Array<number>, detail?: string }}
 */
export function checkAltText({ blocks = [] } = {}) {
  const missing = [];
  (Array.isArray(blocks) ? blocks : []).forEach((b, i) => {
    if (b?.type === 'image' && !b.alt && !b.content?.alt) missing.push(i);
  });
  return {
    ok: missing.length === 0,
    missing,
    detail: missing.length ? `image blocks missing alt: ${missing.join(', ')}` : undefined,
  };
}

/**
 * Word-count QA — per-slide budget (§35.5 max words/slide).
 * @param {Object} params - { slide, maxWords }
 * @returns {{ ok: boolean, words: number, detail?: string }}
 */
export function checkWordCount({ slide = {}, maxWords = 60 } = {}) {
  const parts = [slide.title || ''];
  for (const b of slide.blocks || []) {
    if (b.type === 'bullets' && Array.isArray(b.content?.items)) parts.push(b.content.items.join(' '));
    if (typeof b.content?.text === 'string') parts.push(b.content.text);
    if (b.type === 'table' && Array.isArray(b.content?.rows)) {
      parts.push(b.content.rows.flat().join(' '));
    }
  }
  const words = countWords(parts.join(' '));
  return { ok: words <= maxWords, words, detail: words > maxWords ? `${words} words > ${maxWords} max` : undefined };
}

/**
 * Title-length QA — slide title <= 60 chars (§35.5).
 * @param {Object} params - { title }
 * @returns {{ ok: boolean, length: number, detail?: string }}
 */
export function checkTitleLength({ title = '', maxChars = 60 } = {}) {
  const len = String(title || '').length;
  return { ok: len <= maxChars, length: len, detail: len > maxChars ? `title ${len} chars > ${maxChars} max` : undefined };
}

/**
 * Run all QA checks on a slide (§35.5).
 * @param {Object} slide
 * @returns {{ ok: boolean, checks: Array<{ type: string, ok: boolean, detail?: string }> }}
 */
export function runSlideQa(slide = {}) {
  const layout = slide.layout || 'title-body';
  const checks = [
    { type: 'overflow', ...checkOverflow({ layout, title: slide.title, body: slide.blocks?.map((b) => b.content?.text || '').join(' ') || '' }) },
    { type: 'contrast', ...checkContrast({ fg: THEME_PALETTES.default.fg, bg: THEME_PALETTES.default.bg }) },
    { type: 'alt_text', ...checkAltText({ blocks: slide.blocks }) },
    { type: 'word_count', ...checkWordCount({ slide }) },
    { type: 'title_length', ...checkTitleLength({ title: slide.title }) },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

// ═══════════════════════════════════════════════════════════════════
// THEME (§35.1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Apply theme — canonical doc'ga theme tokens qo'shadi.
 * @param {Object} params - { theme, doc }
 * @returns {{ ok: boolean, doc?: Object, reason?: string }}
 */
export function applyTheme({ theme = 'default', doc = {} } = {}) {
  if (!THEMES.includes(theme)) return { ok: false, reason: `unsupported theme ${theme}` };
  const palette = THEME_PALETTES[theme];
  const out = { ...doc, theme, themeTokens: palette };
  // Slides theme bilan bog'lanadi (o'zgartirilmaydi — faqat token qo'shiladi)
  if (Array.isArray(doc.slides)) {
    out.slides = doc.slides.map((s) => ({ ...s, theme: s.theme || theme }));
  }
  return { ok: true, doc: out };
}

// ═══════════════════════════════════════════════════════════════════
// PROVIDER RAW ISOLATION (§15, §19)
// ═══════════════════════════════════════════════════════════════════

/**
 * Provider raw response canonical modeldan tashqariga chiqmasligi shart.
 * Raw response faqat canonical document ichida saqlanadi; raw'da bo'lgan
 * lekin canonical'da yo'q maydonlar sizib chiqmaydi.
 *
 * @param {Object} params - { raw, canonical }
 * @returns {{ ok: boolean, reason?: string, leaked?: Array<string> }}
 */
export function assertProviderRawIsolated({ raw = {}, canonical = {} } = {}) {
  const rawKeys = new Set(Object.keys(raw || {}));
  const allowedPrefixes = ['raw_', 'provider', 'jobId', 'status'];
  const leaked = [...rawKeys].filter(
    (k) => !allowedPrefixes.some((p) => k.startsWith(p)) && !(k in (canonical || {}))
  );
  if (leaked.length > 0) {
    return { ok: false, reason: `provider raw fields leak outside canonical model: ${leaked.join(', ')}`, leaked };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT SKELETON (§35.2, §13)
// ═══════════════════════════════════════════════════════════════════

/**
 * PPTX export skeleton — PptxGenJS structure (export worker uchun).
 * @param {Object} doc - canonical document
 * @returns {{ ok: boolean, skeleton?: Object, reason?: string }}
 */
export function buildPptxSkeleton(doc = {}) {
  if (!Array.isArray(doc.slides) || doc.slides.length === 0) {
    return { ok: false, reason: 'cannot export empty deck' };
  }
  const skeleton = {
    title: doc.title,
    theme: doc.theme || 'default',
    slideSize: doc.aspectRatio === '4:3' ? '4x3' : '16x9',
    slides: doc.slides.map((s) => ({
      id: s.id,
      layout: s.layout,
      title: s.title,
      blocks: (s.blocks || []).map((b) => ({
        type: b.type,
        content: b.content || {},
        alt: b.alt || b.content?.alt || null,
      })),
      speakerNotes: s.speakerNotes || '',
      citations: s.citations || [],
    })),
  };
  return { ok: true, skeleton };
}

/**
 * PDF export skeleton — print handout mapping (§35.2).
 * @param {Object} doc - canonical document
 * @returns {{ ok: boolean, skeleton?: Object, reason?: string }}
 */
export function buildPdfSkeleton(doc = {}) {
  if (!Array.isArray(doc.slides) || doc.slides.length === 0) {
    return { ok: false, reason: 'cannot export empty deck' };
  }
  const skeleton = {
    title: doc.title,
    theme: doc.theme || 'default',
    handout: true,
    pages: doc.slides.map((s) => ({
      id: s.id,
      title: s.title,
      textBlocks: (s.blocks || []).filter((b) => ['text', 'heading', 'bullets'].includes(b.type)),
      images: (s.blocks || []).filter((b) => b.type === 'image'),
      citations: s.citations || [],
    })),
  };
  return { ok: true, skeleton };
}

/**
 * Validate export request.
 * @param {Object} params - { format, versionStatus }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateExportRequest({ format = '', versionStatus = 'draft' } = {}) {
  if (!EXPORT_FORMATS.includes(format)) {
    return { ok: false, reason: `unsupported export format ${format} — allowed: ${EXPORT_FORMATS.join('|')}` };
  }
  // Published immutable version export uchun tavsiya; draft ham mumkin (preview)
  return { ok: true };
}

/**
 * Validate comment body.
 * @param {Object} params - { body }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateComment({ body = '' } = {}) {
  if (!body || typeof body !== 'string' || !body.trim()) {
    return { ok: false, reason: 'comment body is required' };
  }
  if (String(body).length > 2000) return { ok: false, reason: 'comment exceeds 2000 chars' };
  return { ok: true };
}
