/**
 * Edikit — Unified Provider Async Clients (Gamma + Manus)
 *
 * Prompt 58 — server-side provider clients. API keys faqat env'da
 * (GAMMA_API_KEY, MANUS_API_KEY, MANUS_WEBHOOK_SECRET) — hech qachon
 * browserga yoki DB'ga chiqmaydi (research §22.9). Har bir call
 * fetchImpl injeksiyasini qo'llab-quvvatlaydi (testlar uchun).
 *
 * Gamma (research §9.5): POST /v1.0/generations (X-API-KEY), async
 * polling, format=presentation, numCards, theme, audience, language.
 * Manus (research §9.6): v2 file/project/task API, signed webhook,
 * follow-up sendMessage.
 */

import { createHmac } from 'crypto';
import {
  GAMMA_DEFAULTS,
  MANUS_DEFAULTS,
  shouldRetryError,
  constantTimeEqual,
} from './provider.schema.js';

// ── Provider telemetry (Prompt 69 §13 — latency/cost/error, guarded) ──
import { incrementCounter, observeHistogram } from '../../telemetry/index.js';

// ── API key retrieval (env only, never exposed) ──
export function getGammaApiKey() {
  return process.env.GAMMA_API_KEY || null;
}

export function getManusApiKey() {
  return process.env.MANUS_API_KEY || null;
}

export function getManusWebhookSecret() {
  return process.env.MANUS_WEBHOOK_SECRET || null;
}

// ── Fetch helper with retry (429/5xx/529) ──
function providerLabel(url) {
  if (/manus/i.test(url || '')) return 'manus';
  if (/gamma/i.test(url || '')) return 'gamma';
  return 'unknown';
}

async function fetchWithRetry(url, options = {}, { fetchImpl = globalThis.fetch, maxAttempts = 3, timeoutMs = 30000 } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  if (!fn) throw new Error('fetch unavailable');
  let lastError = null;
  const provider = providerLabel(url);
  const started = Date.now();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const res = await fn(url, {
        ...options,
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      // ── Provider telemetry (guarded — hech qachon request'ni buzmaydi) ──
      try {
        incrementCounter('edikit_provider_requests_total', { help: 'Provider requests' }, { value: 1, labels: { provider, status: String(res.status) } });
        observeHistogram('edikit_provider_latency_ms', Date.now() - started, { help: 'Provider latency', labels: { provider } });
        if (!res.ok) {
          incrementCounter('edikit_provider_errors_total', { help: 'Provider errors' }, { value: 1, labels: { provider, status: String(res.status) } });
        }
      } catch (_) { /* telemetry xatosi request'ni buzmasin */ }
      if (shouldRetryError(res.status) && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      // Mock'lar res.json() beradi, real fetch res.text() — ikkalasini ham qo'llab-quvvatlaymiz
      let json = null;
      let text = '';
      try {
        if (typeof res.json === 'function') {
          json = await res.json();
        } else {
          text = await res.text();
          try { json = JSON.parse(text); } catch (_) { /* non-JSON */ }
        }
      } catch (_) {
        try { text = await res.text(); } catch (_2) { /* ignore */ }
      }
      return { ok: Boolean(res.ok), status: res.status, json, text };
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('provider fetch failed');
}

// ═══════════════════════════════════════════════════════════════════
// GAMMA CLIENT
// ═══════════════════════════════════════════════════════════════════

/** POST /v1.0/generations — create async generation. */
export async function gammaCreate({ payload, apiKey = null, fetchImpl = null } = {}) {
  const key = apiKey || getGammaApiKey();
  if (!key) return { ok: false, error: 'Gamma not configured (GAMMA_API_KEY missing)' };
  const base = process.env.GAMMA_BASE_URL || GAMMA_DEFAULTS.baseUrl;
  const res = await fetchWithRetry(`${base}/v1.0/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': key,
      'X-API-Version': '1.0',
    },
    body: JSON.stringify(payload),
  }, { fetchImpl });
  if (!res.ok) return { ok: false, error: `Gamma create failed (${res.status}): ${res.text?.slice?.(0, 300) || ''}`, status: res.status };
  const genId = res.json?.id || res.json?.generationId || res.json?.data?.id;
  if (!genId) return { ok: false, error: 'Gamma create response missing generation id', raw: res.json };
  return { ok: true, providerJobId: String(genId), raw: res.json };
}

/** GET /v1.0/generations/:id — async polling status. */
export async function gammaPoll({ providerJobId, apiKey = null, fetchImpl = null } = {}) {
  const key = apiKey || getGammaApiKey();
  if (!key) return { ok: false, error: 'Gamma not configured (GAMMA_API_KEY missing)' };
  const base = process.env.GAMMA_BASE_URL || GAMMA_DEFAULTS.baseUrl;
  const res = await fetchWithRetry(`${base}/v1.0/generations/${encodeURIComponent(providerJobId)}`, {
    method: 'GET',
    headers: { 'X-API-KEY': key, 'X-API-Version': '1.0' },
  }, { fetchImpl });
  if (!res.ok) return { ok: false, error: `Gamma poll failed (${res.status}): ${res.text?.slice?.(0, 300) || ''}`, status: res.status };
  return { ok: true, raw: res.json || {} };
}

/** DELETE /v1.0/generations/:id — cancel. */
export async function gammaCancel({ providerJobId, apiKey = null, fetchImpl = null } = {}) {
  const key = apiKey || getGammaApiKey();
  if (!key) return { ok: false, error: 'Gamma not configured (GAMMA_API_KEY missing)' };
  const base = process.env.GAMMA_BASE_URL || GAMMA_DEFAULTS.baseUrl;
  const res = await fetchWithRetry(`${base}/v1.0/generations/${encodeURIComponent(providerJobId)}`, {
    method: 'DELETE',
    headers: { 'X-API-KEY': key, 'X-API-Version': '1.0' },
  }, { fetchImpl });
  if (!res.ok && res.status !== 404) {
    return { ok: false, error: `Gamma cancel failed (${res.status}): ${res.text?.slice?.(0, 300) || ''}`, status: res.status };
  }
  return { ok: true, raw: res.json || {} };
}

// ═══════════════════════════════════════════════════════════════════
// MANUS CLIENT
// ═══════════════════════════════════════════════════════════════════

/** POST /v2/files — upload source file (research §9.6 step 1). */
export async function manusUploadFile({ name = '', content = null, apiKey = null, fetchImpl = null } = {}) {
  const key = apiKey || getManusApiKey();
  if (!key) return { ok: false, error: 'Manus not configured (MANUS_API_KEY missing)' };
  const base = process.env.MANUS_BASE_URL || MANUS_DEFAULTS.baseUrl;
  const res = await fetchWithRetry(`${base}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
    },
    body: content || new Uint8Array(0),
  }, { fetchImpl, timeoutMs: 60000 });
  if (!res.ok) return { ok: false, error: `Manus file upload failed (${res.status}): ${res.text?.slice?.(0, 300) || ''}`, status: res.status };
  const fileId = res.json?.id || res.json?.fileId || res.json?.data?.id;
  if (!fileId) return { ok: false, error: 'Manus file upload missing file id', raw: res.json };
  return { ok: true, fileId: String(fileId), raw: res.json };
}

/** POST /v2/projects — project per course/teacher (research §9.6 step 2). */
export async function manusCreateProject({ name = '', apiKey = null, fetchImpl = null } = {}) {
  const key = apiKey || getManusApiKey();
  if (!key) return { ok: false, error: 'Manus not configured (MANUS_API_KEY missing)' };
  const base = process.env.MANUS_BASE_URL || MANUS_DEFAULTS.baseUrl;
  const res = await fetchWithRetry(`${base}/projects`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }, { fetchImpl });
  if (!res.ok) return { ok: false, error: `Manus project create failed (${res.status}): ${res.text?.slice?.(0, 300) || ''}`, status: res.status };
  const projectId = res.json?.id || res.json?.projectId || res.json?.data?.id;
  if (!projectId) return { ok: false, error: 'Manus project create missing id', raw: res.json };
  return { ok: true, projectId: String(projectId), raw: res.json };
}

/** POST /v2/tasks — create task (research §9.6 step 3). */
export async function manusCreateTask({ payload, apiKey = null, fetchImpl = null } = {}) {
  const key = apiKey || getManusApiKey();
  if (!key) return { ok: false, error: 'Manus not configured (MANUS_API_KEY missing)' };
  const base = process.env.MANUS_BASE_URL || MANUS_DEFAULTS.baseUrl;
  const res = await fetchWithRetry(`${base}/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, { fetchImpl });
  if (!res.ok) return { ok: false, error: `Manus task create failed (${res.status}): ${res.text?.slice?.(0, 300) || ''}`, status: res.status };
  const taskId = res.json?.id || res.json?.taskId || res.json?.data?.id;
  if (!taskId) return { ok: false, error: 'Manus task create missing id', raw: res.json };
  return { ok: true, providerJobId: String(taskId), raw: res.json };
}

/** POST /v2/tasks/:id/messages — teacher follow-up (research §9.6 step 8). */
export async function manusSendFollowUp({ providerJobId, message = '', apiKey = null, fetchImpl = null } = {}) {
  const key = apiKey || getManusApiKey();
  if (!key) return { ok: false, error: 'Manus not configured (MANUS_API_KEY missing)' };
  const base = process.env.MANUS_BASE_URL || MANUS_DEFAULTS.baseUrl;
  const res = await fetchWithRetry(`${base}/tasks/${encodeURIComponent(providerJobId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  }, { fetchImpl });
  if (!res.ok) return { ok: false, error: `Manus follow-up failed (${res.status}): ${res.text?.slice?.(0, 300) || ''}`, status: res.status };
  return { ok: true, raw: res.json || {} };
}

// ═══════════════════════════════════════════════════════════════════
// SHARED — artifact download + webhook verification
// ═══════════════════════════════════════════════════════════════════

/** Download an expiring provider artifact (for object storage copy). */
export async function downloadArtifact({ url, fetchImpl = null, timeoutMs = 60000 } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  if (!fn) throw new Error('fetch unavailable');
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fn(url, { signal: controller ? controller.signal : undefined });
    if (timer) clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `artifact download failed (${res.status})`, status: res.status };
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer, size: buffer.length, contentType: res.headers?.get?.('content-type') || null };
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Verify Manus webhook signature (timing-safe, HMAC-SHA256 via node:crypto).
 * Signature header format: "sha256=<hex>".
 * secret berilmasa getManusWebhookSecret() env'idan olinadi (test'lar uchun
 * secret param orqali injeksiya qilinadi — modul mock'ida internal binding
 * o'zgarmaydi).
 */
export function verifyManusWebhook({ signature = null, body = '', secret = null } = {}) {
  const sec = secret || getManusWebhookSecret();
  if (!sec) return { ok: false, reason: 'MANUS_WEBHOOK_SECRET not configured' };
  if (!signature || !signature.startsWith('sha256=')) {
    return { ok: false, reason: 'invalid signature header' };
  }
  const expected = createHmac('sha256', sec).update(body || '', 'utf8').digest('hex');
  const ok = constantTimeEqual(signature.slice(7), expected);
  return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}
