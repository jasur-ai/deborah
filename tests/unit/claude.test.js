/**
 * Edikit — Claude Native Adapter (unit tests, Prompt 57)
 *
 * Pure schema tekshiruvi (no DB/network):
 *   - validateSynthesisRequest + requestHash (idempotency)
 *   - buildClaudeMessages + mapFileToClaudeBlock (Files/text conversion)
 *   - parseSseChunk (Anthropic SSE events)
 *   - extractCanonicalJson (strict canonical §9.2)
 *   - mapCitations (citation → source_pack, §22.11)
 *   - computeRetryDelay / shouldRetryError / evaluateCircuitState
 *   - computeUsageCost
 *   - assertNoStudentPii (§15)
 *   - buildAttributionMetadata + validateJobStatusTransition
 *   - Provider client mocked contract (createMessage / streamMessage)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateSynthesisRequest,
  requestHash,
  buildClaudeMessages,
  mapFileToClaudeBlock,
  parseSseChunk,
  extractCanonicalJson,
  mapCitations,
  computeRetryDelay,
  shouldRetryError,
  evaluateCircuitState,
  computeUsageCost,
  assertNoStudentPii,
  buildAttributionMetadata,
  validateJobStatusTransition,
  createMessage,
  streamMessage,
  CLAUDE_MODELS,
  JOB_STATUS,
  SSE_EVENTS,
  PDF_LIMITS,
} from '../../src/modules/claude/index.js';

// ═══════════════════════════════════════════════════════════════════
// REQUEST VALIDATION + IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

describe('claude — request validation & idempotency (Prompt 57 §05/16)', () => {
  const valid = { title: 'Fotosintez', language: 'uz', slideCount: 10, sources: [1, 2] };

  it('accepts a valid synthesis request', () => {
    const r = validateSynthesisRequest(valid);
    expect(r.ok).toBe(true);
    expect(r.normalized.slideCount).toBe(10);
  });

  it('rejects missing title', () => {
    expect(validateSynthesisRequest({ ...valid, title: '' }).ok).toBe(false);
  });

  it('rejects unsupported language/theme/tone', () => {
    expect(validateSynthesisRequest({ ...valid, language: 'xx' }).ok).toBe(false);
    expect(validateSynthesisRequest({ ...valid, theme: 'neon' }).ok).toBe(false);
    expect(validateSynthesisRequest({ ...valid, tone: 'shouty' }).ok).toBe(false);
  });

  it('rejects slideCount out of range', () => {
    expect(validateSynthesisRequest({ ...valid, slideCount: 0 }).ok).toBe(false);
    expect(validateSynthesisRequest({ ...valid, slideCount: 99 }).ok).toBe(false);
  });

  it('rejects empty sources / too many sources', () => {
    expect(validateSynthesisRequest({ ...valid, sources: [] }).ok).toBe(false);
    expect(validateSynthesisRequest({ ...valid, sources: Array(21).fill(1) }).ok).toBe(false);
  });

  it('requestHash is deterministic and order-insensitive for sources', () => {
    const a = requestHash({ title: 'X', language: 'uz', slideCount: 5, sources: [1, 2] });
    const b = requestHash({ title: 'X', language: 'uz', slideCount: 5, sources: [2, 1] });
    expect(a).toBe(b);
    const c = requestHash({ title: 'Y', language: 'uz', slideCount: 5, sources: [1, 2] });
    expect(a).not.toBe(c);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FILES/TEXT CONVERSION MAPPING (§57-09)
// ═══════════════════════════════════════════════════════════════════

describe('claude — files/text conversion mapping (Prompt 57 §09)', () => {
  it('maps PDF to a base64 document block', () => {
    const r = mapFileToClaudeBlock({ name: 'guide.pdf', mimeType: 'application/pdf', base64: 'JVBERi0x' });
    expect(r.ok).toBe(true);
    expect(r.block.type).toBe('document');
    expect(r.block.source.media_type).toBe('application/pdf');
  });

  it('rejects PDF over 32MB limit', () => {
    const big = 'A'.repeat(Math.ceil((PDF_LIMITS.maxBytes * 4) / 3) + 100);
    const r = mapFileToClaudeBlock({ name: 'big.pdf', mimeType: 'application/pdf', base64: big });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/32MB limit/i);
  });

  it('maps text/markdown to a text block', () => {
    const r = mapFileToClaudeBlock({ name: 'notes.md', mimeType: 'text/markdown', text: 'Hello world' });
    expect(r.ok).toBe(true);
    expect(r.block.type).toBe('text');
    expect(r.block.text).toContain('Hello');
  });

  it('REJECTS DOCX/PPTX — conversion required (stop condition)', () => {
    const r = mapFileToClaudeBlock({ name: 'doc.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: 'x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/conversion required|does not accept office/i);
  });

  it('buildClaudeMessages builds system + user message', () => {
    const r = buildClaudeMessages({
      title: 'Fotosintez', audience: '8-sinf', language: 'uz', theme: 'academic',
      slideCount: 8, tone: 'formal', sourcesText: '[1] Biologiya darslik',
    });
    expect(r.ok).toBe(true);
    expect(r.system).toContain('canonical JSON');
    expect(r.messages[0].role).toBe('user');
    expect(r.messages[0].content[0].text).toContain('Fotosintez');
    expect(r.promptRef).toMatch(/^claude:synthesis:/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SSE PARSING (§57-10)
// ═══════════════════════════════════════════════════════════════════

describe('claude — SSE parsing (Prompt 57 §10)', () => {
  it('parses content_block_delta text_delta', () => {
    const chunk = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Fot"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"osintez"}}\n\n';
    const events = parseSseChunk(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe(SSE_EVENTS.CONTENT_BLOCK_DELTA);
    expect(events[0].data.delta.text).toBe('Fot');
  });

  it('parses message_start with usage', () => {
    const events = parseSseChunk('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"},"usage":{"input_tokens":10}}\n\n');
    expect(events[0].event).toBe(SSE_EVENTS.MESSAGE_START);
    expect(events[0].data.usage.input_tokens).toBe(10);
  });

  it('handles ping frames', () => {
    const events = parseSseChunk('event: ping\ndata: {"type":"ping"}\n\n');
    expect(events[0].event).toBe('ping');
  });
});

// ═══════════════════════════════════════════════════════════════════
// STRICT CANONICAL JSON (§57-12, §9.2)
// ═══════════════════════════════════════════════════════════════════

describe('claude — strict canonical extraction (Prompt 57 §12)', () => {
  const validDeck = JSON.stringify({
    title: 'Fotosintez',
    audience: '8-sinf',
    language: 'uz',
    learningOutcomes: ['ATP'],
    slides: [
      { id: 's1', layout: 'title', title: 'Fotosintez', blocks: [{ type: 'text', content: { text: 'x' } }], citations: [] },
      { id: 's2', layout: 'closing', title: 'Xulosa', blocks: [{ type: 'bullets', content: { items: ['a'] } }], citations: ['src_1'] },
    ],
  });

  it('extracts valid canonical deck from ```json fence', () => {
    const r = extractCanonicalJson('Here is the deck:\n```json\n' + validDeck + '\n```\nEnjoy!');
    expect(r.ok).toBe(true);
    expect(r.document.slides).toHaveLength(2);
    expect(r.document.provider.name).toBe('claude');
  });

  it('rejects output with no JSON', () => {
    expect(extractCanonicalJson('just some text').ok).toBe(false);
  });

  it('rejects invalid JSON', () => {
    expect(extractCanonicalJson('```json\n{invalid}\n```').ok).toBe(false);
  });

  it('rejects canonical missing title/slides', () => {
    expect(extractCanonicalJson('```json\n{"slides":[]}\n```').ok).toBe(false);
    expect(extractCanonicalJson('```json\n{"title":"X"}\n```').ok).toBe(false);
  });

  it('rejects image block without alt text (accessibility)', () => {
    const bad = JSON.stringify({ title: 'X', slides: [{ id: 's1', blocks: [{ type: 'image', content: { url: 'u' } }] }] });
    expect(extractCanonicalJson('```json\n' + bad + '\n```').ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CITATION MAPPING (§57-11, §22.11)
// ═══════════════════════════════════════════════════════════════════

describe('claude — citation mapping (Prompt 57 §11)', () => {
  const document = {
    slides: [
      { id: 's1', citations: ['src_1'] },
      { id: 's2', citations: ['2'] },
      { id: 's3', citations: ['ghost_99'] },
    ],
  };
  const sourcePacks = [
    { id: 1, title: 'Biologiya', url: 'https://x/1' },
    { id: 2, title: 'Kimyo', url: 'https://x/2' },
  ];

  it('maps citations to source packs (real DB check)', () => {
    const r = mapCitations({ document, sourcePacks });
    expect(r.ok).toBe(true);
    expect(r.attributions).toHaveLength(2);
    expect(r.attributions[0].sourcePackId).toBe(1);
    expect(r.attributions[1].sourcePackId).toBe(2);
  });

  it('warns on citations that match no source pack (no fake refs)', () => {
    const r = mapCitations({ document, sourcePacks });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/ghost_99/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RETRY / CIRCUIT / COST (§57-13)
// ═══════════════════════════════════════════════════════════════════

describe('claude — retry/circuit/cost (Prompt 57 §13)', () => {
  it('shouldRetryError on 429/500/529/504, not on 400', () => {
    expect(shouldRetryError({ status: 429 })).toBe(true);
    expect(shouldRetryError({ status: 500 })).toBe(true);
    expect(shouldRetryError({ status: 529 })).toBe(true);
    expect(shouldRetryError({ status: 504 })).toBe(true);
    expect(shouldRetryError({ status: 400 })).toBe(false);
    expect(shouldRetryError({ status: 429, retryCount: 3, maxRetries: 3 })).toBe(false);
  });

  it('computeRetryDelay grows exponentially with cap', () => {
    expect(computeRetryDelay({ retryCount: 0 })).toBeGreaterThanOrEqual(1000);
    expect(computeRetryDelay({ retryCount: 10, maxMs: 1000 })).toBeLessThanOrEqual(1000);
  });

  it('circuit breaker open → half_open → closed', () => {
    expect(evaluateCircuitState({ failureCount: 0 }).state).toBe('closed');
    expect(evaluateCircuitState({ failureCount: 7, threshold: 5 }).state).toBe('open');
    expect(evaluateCircuitState({ failureCount: 7, threshold: 5, openUntil: new Date(Date.now() - 1000) }).state).toBe('half_open');
    expect(evaluateCircuitState({ failureCount: 7, threshold: 5, openUntil: new Date(Date.now() + 5000) }).state).toBe('open');
  });

  it('computeUsageCost estimates cost per model', () => {
    const r = computeUsageCost({ model: 'claude-sonnet-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(r.ok).toBe(true);
    expect(r.cost).toBeCloseTo(18.0, 1); // $3 in + $15 out
  });
});

// ═══════════════════════════════════════════════════════════════════
// PII GUARD (§57-15)
// ═══════════════════════════════════════════════════════════════════

describe('claude — PII guard (Prompt 57 §15)', () => {
  it('redacts email, phone, student id by default', () => {
    const r = assertNoStudentPii({ text: 'Student Aziza aziza@mail.uz +998901234567 id 12 3456789 matni' });
    expect(r.detected.length).toBeGreaterThan(0);
    expect(r.redacted).not.toContain('aziza@mail.uz');
    expect(r.redacted).not.toContain('+998901234567');
    expect(r.redacted).toContain('[redacted-pii]');
  });

  it('clean text passes without changes', () => {
    const r = assertNoStudentPii({ text: 'Fotosintez jarayoni ATP sintez qiladi.' });
    expect(r.detected).toHaveLength(0);
    expect(r.redacted).toContain('Fotosintez');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ATTRIBUTION + JOB FSM
// ═══════════════════════════════════════════════════════════════════

describe('claude — attribution metadata & job FSM (Prompt 57 §14)', () => {
  it('buildAttributionMetadata includes provider/model/prompt/usage', () => {
    const a = buildAttributionMetadata({ model: 'claude-sonnet-5', promptRef: 'ref', usage: { input_tokens: 1 }, attributions: [{ x: 1 }] });
    expect(a.provider).toBe('claude');
    expect(a.model).toBe('claude-sonnet-5');
    expect(a.promptRef).toBe('ref');
    expect(a.attribution).toHaveLength(1);
  });

  it('validates job transitions', () => {
    expect(validateJobStatusTransition(JOB_STATUS.QUEUED, JOB_STATUS.RUNNING).ok).toBe(true);
    expect(validateJobStatusTransition(JOB_STATUS.RUNNING, JOB_STATUS.COMPLETED).ok).toBe(true);
    expect(validateJobStatusTransition(JOB_STATUS.COMPLETED, JOB_STATUS.RUNNING).ok).toBe(false);
    expect(validateJobStatusTransition(JOB_STATUS.QUEUED, JOB_STATUS.COMPLETED).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PROVIDER CLIENT — MOCKED CONTRACT TEST (§57-18)
// ═══════════════════════════════════════════════════════════════════

describe('claude — provider client mocked contract (Prompt 57 §18)', () => {
  it('createMessage — missing api key → not configured', async () => {
    const r = await createMessage({ apiKey: null, messages: [{ role: 'user', content: 'x' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/i);
  });

  it('createMessage — missing messages → error', async () => {
    const r = await createMessage({ apiKey: 'sk-test', messages: [] });
    expect(r.ok).toBe(false);
  });

  it('createMessage — 429 then success → retries once (contract)', async () => {
    let calls = 0;
    const fakeFetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return { status: 429, ok: false };
      return {
        status: 200,
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '{"title":"X","slides":[{"id":"s1","blocks":[]}]}' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }),
      };
    });
    const r = await createMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'x' }],
      maxRetries: 2,
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    expect(r.text).toContain('title'); // text passthrough
    expect(r.attempts).toBe(2);
  });

  it('streamMessage — parses SSE frames and accumulates text', async () => {
    const sse = [
      'event: message_start\ndata: {"type":"message_start","usage":{"input_tokens":5}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"World"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const body = new ReadableStream({
      start(controller) {
        for (const f of sse) controller.enqueue(new TextEncoder().encode(f));
        controller.close();
      },
    });
    const fakeFetch = vi.fn(async () => ({ status: 200, ok: true, body }));
    const onEvent = vi.fn();
    const r = await streamMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl: fakeFetch,
      onEvent,
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Hello World');
    expect(r.stopReason).toBe('end_turn');
    expect(onEvent).toHaveBeenCalled();
  });
});
