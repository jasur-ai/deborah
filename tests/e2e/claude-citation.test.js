/**
 * Edikit — Claude Native Adapter (e2e/security tests, Prompt 57)
 *
 * E2E flow: sources → messages → (mocked) Claude output → strict
 * canonical extraction → citation mapping → validated artifact.
 * Security (§15):
 *   - API key hech qachon output/attribution'da ko'rinmaydi.
 *   - Student PII default redact qilinadi.
 *   - Provider raw response canonical modeldan tashqariga chiqmaydi.
 *   - AI citations real source pack'larga bog'lanadi (§22.11).
 */

import { describe, it, expect } from 'vitest';
import {
  validateSynthesisRequest,
  requestHash,
  buildClaudeMessages,
  extractCanonicalJson,
  mapCitations,
  assertNoStudentPii,
  buildAttributionMetadata,
  mapFileToClaudeBlock,
  CLAUDE_DEFAULTS,
} from '../../src/modules/claude/index.js';

const DECK_JSON = JSON.stringify({
  title: 'Fotosintez',
  audience: '8-sinf',
  language: 'uz',
  learningOutcomes: ['ATP sintezini tushuntiradi'],
  slides: [
    { id: 's1', layout: 'title', title: 'Fotosintez', blocks: [{ type: 'text', content: { text: 'Kirish' } }], citations: [] },
    { id: 's2', layout: 'title-body-image', title: 'Yorug\u2018lik reaksiyalari', blocks: [
      { type: 'bullets', content: { items: ['ATP', 'NADPH'] } },
      { type: 'image', content: { url: 'https://cdn/x.png' }, alt: 'Fotosintez diagrammasi' },
    ], citations: ['src_1'] },
  ],
});

describe('claude — e2e citation→canonical deck (Prompt 57 §20)', () => {
  const sourcePacks = [
    { id: 1, title: 'Biologiya darslik', url: 'https://x/1' },
    { id: 2, title: 'Kimyo', url: 'https://x/2' },
  ];

  it('E2E: request → messages → Claude output → canonical → citations', () => {
    // 1. Validate request
    const v = validateSynthesisRequest({ title: 'Fotosintez', language: 'uz', slideCount: 8, sources: [1, 2] });
    expect(v.ok).toBe(true);

    // 2. Build messages (PII guard on sources text)
    const pii = assertNoStudentPii({ text: 'Student Aziza aziza@mail.uz' });
    expect(pii.redacted).not.toContain('@');
    const built = buildClaudeMessages({
      title: 'Fotosintez', language: 'uz', theme: 'academic', slideCount: 8,
      tone: 'formal', sourcesText: '[1] Biologiya darslik',
    });
    expect(built.ok).toBe(true);

    // 3. Claude output → strict canonical extraction
    const extracted = extractCanonicalJson('Natija:\n```json\n' + DECK_JSON + '\n```');
    expect(extracted.ok).toBe(true);
    expect(extracted.document.slides).toHaveLength(2);
    expect(extracted.document.provider.name).toBe('claude');

    // 4. Citation mapping — real source pack tekshiruvi
    const cited = mapCitations({ document: extracted.document, sourcePacks });
    expect(cited.attributions).toHaveLength(1);
    expect(cited.attributions[0].sourcePackId).toBe(1);
    expect(cited.attributions[0].slideId).toBe('s2');

    // 5. Attribution metadata — no API key anywhere
    const meta = buildAttributionMetadata({
      model: CLAUDE_DEFAULTS.model,
      promptRef: built.promptRef,
      usage: { input_tokens: 100, output_tokens: 40 },
      attributions: cited.attributions,
    });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toMatch(/sk-|api[_-]?key|ANTHROPIC_API_KEY/i);
  });

  it('SECURITY: idempotency hash is stable across identical requests', () => {
    const a = requestHash({ title: 'Fotosintez', language: 'uz', slideCount: 8, sources: [1, 2] });
    const b = requestHash({ title: 'Fotosintez', language: 'uz', slideCount: 8, sources: [2, 1] });
    expect(a).toBe(b);
  });

  it('SECURITY: PII never leaves the boundary (no email/phone/id in prompt)', () => {
    const dirty = 'Test: aziz.a@mail.uz +99890 123 45 67 talaba id 12 3456789';
    const pii = assertNoStudentPii({ text: dirty });
    expect(pii.detected.length).toBeGreaterThanOrEqual(2);
    for (const d of pii.detected) expect(d).not.toBeUndefined();
    // redacted text yuboriladi
    const built = buildClaudeMessages({
      title: 'Fotosintez', language: 'uz', theme: 'default', slideCount: 5, tone: 'formal',
      sourcesText: pii.redacted,
    });
    expect(built.ok).toBe(true);
    expect(JSON.stringify(built.messages)).not.toMatch(/aziz\.a@|99890/i);
  });

  it('SECURITY: office files blocked before reaching provider (stop condition)', () => {
    const r = mapFileToClaudeBlock({ name: 'x.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', base64: 'y' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/conversion required|does not accept office/i);
  });
});
