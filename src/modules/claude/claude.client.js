/**
 * Deborah — Claude Native Adapter (server-side provider client)
 *
 * Prompt 57 — Claude Messages API client. SERVER-ONLY: API key env'dan
 * (ANTHROPIC_API_KEY) olinadi, hech qachon browserga/response'ga
 * chiqmaydi (research.md §22.9). fetch-based (no SDK dependency),
 * retry (429/500/529/504 + backoff), SSE streaming parsing.
 *
 *   - getApiKey(): KMS/env retrieval (production: secret manager).
 *   - createMessage(): non-streaming Messages API call.
 *   - streamMessage(): SSE streaming with onEvent callback.
 *
 * SECURITY / DATA GUARD (Prompt 57 §15):
 *   - API key faqat server env'da — response/attribution hech qachon
 *     key ni o'z ichiga olmaydi.
 *   - Student PII guard schema'da (assertNoStudentPii) — client
 *     faqat tayyor (redacted) contentni yuboradi.
 *   - Circuit breaker state service'da saqlanadi; client faqat
 *     transient error'larni retry qiladi.
 */

import {
  CLAUDE_DEFAULTS,
  computeRetryDelay,
  shouldRetryError,
  parseSseChunk,
  SSE_EVENTS,
} from './claude.schema.js';

const API_BASE = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * KMS/API key retrieval. Production'da secret manager (AWS KMS/Secrets
 * Manager) dan olinishi kerak; development'da ANTHROPIC_API_KEY env.
 * @returns {string|null}
 */
export function getApiKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || null;
}

/**
 * Non-streaming Messages API call with retry.
 *
 * @param {Object} params - { model, system, messages, maxTokens, temperature, apiKey, maxRetries, timeoutMs }
 * @returns {Promise<{ ok: boolean, text?: string, usage?: Object, stopReason?: string, model?: string, error?: string, attempts?: number }>}
 */
export async function createMessage({
  model = CLAUDE_DEFAULTS.model,
  system = '',
  messages = [],
  maxTokens = CLAUDE_DEFAULTS.maxTokens,
  temperature = CLAUDE_DEFAULTS.temperature,
  apiKey = null,
  maxRetries = 3,
  timeoutMs = 60000,
  fetchImpl = fetch,
} = {}) {
  const key = apiKey || getApiKey();
  if (!key) return { ok: false, error: 'provider not configured (ANTHROPIC_API_KEY missing)' };
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'messages are required' };
  }

  let attempts = 0;
  let lastErr = '';
  for (attempts = 0; attempts <= maxRetries; attempts++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetchImpl(API_BASE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({ model, system, messages, max_tokens: maxTokens, temperature }),
        signal: controller.signal,
      });
      clearTimeout(t);

      if (shouldRetryError({ status: res.status, retryCount: attempts, maxRetries })) {
        lastErr = `HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, computeRetryDelay({ retryCount: attempts })));
        continue;
      }
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 300)}`, attempts: attempts + 1 };
      }

      const raw = await res.json();
      const text = (Array.isArray(raw.content) ? raw.content : [])
        .filter((b) => b?.type === 'text')
        .map((b) => b.text || '')
        .join('');
      return {
        ok: true,
        text,
        usage: raw.usage || {},
        stopReason: raw.stop_reason || null,
        model: raw.model || model,
        attempts: attempts + 1,
      };
    } catch (e) {
      lastErr = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e);
      if (shouldRetryError({ error: lastErr, retryCount: attempts, maxRetries })) {
        await new Promise((r) => setTimeout(r, computeRetryDelay({ retryCount: attempts })));
        continue;
      }
      return { ok: false, error: lastErr, attempts: attempts + 1 };
    }
  }
  return { ok: false, error: lastErr || 'failed after retries', attempts };
}

/**
 * Streaming Messages API call (SSE). Parses Anthropic SSE events and
 * calls onEvent({ event, data }) for each frame; accumulates text.
 * Stream interruption → throws/returns error (integration test: retry).
 *
 * @param {Object} params - { model, system, messages, maxTokens, temperature, apiKey, maxRetries, timeoutMs, onEvent, signal }
 * @returns {Promise<{ ok: boolean, text?: string, usage?: Object, stopReason?: string, error?: string, events?: number }>}
 */
export async function streamMessage({
  model = CLAUDE_DEFAULTS.model,
  system = '',
  messages = [],
  maxTokens = CLAUDE_DEFAULTS.maxTokens,
  temperature = CLAUDE_DEFAULTS.temperature,
  apiKey = null,
  maxRetries = 3,
  timeoutMs = 120000,
  onEvent = null,
  signal = null,
  fetchImpl = fetch,
} = {}) {
  const key = apiKey || getApiKey();
  if (!key) return { ok: false, error: 'provider not configured (ANTHROPIC_API_KEY missing)' };
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'messages are required' };
  }

  let attempts = 0;
  for (attempts = 0; attempts <= maxRetries; attempts++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      if (signal) signal.addEventListener('abort', () => controller.abort());
      const res = await fetchImpl(API_BASE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({ model, system, messages, max_tokens: maxTokens, temperature, stream: true }),
        signal: controller.signal,
      });
      clearTimeout(t);

      if (shouldRetryError({ status: res.status, retryCount: attempts, maxRetries })) {
        await new Promise((r) => setTimeout(r, computeRetryDelay({ retryCount: attempts })));
        continue;
      }
      if (!res.ok || !res.body) {
        return { ok: false, error: `HTTP ${res.status}: stream unavailable`, attempts: attempts + 1 };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let usage = {};
      let stopReason = null;
      let events = 0;

      const handleFrame = (frame) => {
        for (const ev of parseSseChunk(frame)) {
          events++;
          if (ev.event === SSE_EVENTS.CONTENT_BLOCK_DELTA && ev.data?.delta?.type === 'text_delta') {
            text += ev.data.delta.text || '';
          }
          if (ev.event === SSE_EVENTS.MESSAGE_DELTA) {
            stopReason = ev.data?.delta?.stop_reason || stopReason;
            usage = ev.data?.usage || usage;
          }
          if (ev.event === SSE_EVENTS.MESSAGE_START && ev.data?.usage) {
            usage = ev.data.usage;
          }
          if (onEvent) {
            try { onEvent({ event: ev.event, data: ev.data }); } catch { /* consumer error ignored */ }
          }
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split on SSE frame boundary
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) handleFrame(frame);
      }
      // Flush remaining buffer
      if (buffer.trim()) handleFrame(buffer);

      return { ok: true, text, usage, stopReason, model, attempts: attempts + 1, events };
    } catch (e) {
      const err = e?.name === 'AbortError' ? 'stream interrupted (timeout/abort)' : String(e?.message || e);
      if (shouldRetryError({ error: err, retryCount: attempts, maxRetries })) {
        await new Promise((r) => setTimeout(r, computeRetryDelay({ retryCount: attempts })));
        continue;
      }
      return { ok: false, error: err, attempts: attempts + 1 };
    }
  }
  return { ok: false, error: 'stream failed after retries', attempts };
}
