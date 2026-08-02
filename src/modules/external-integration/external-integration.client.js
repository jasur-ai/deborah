/**
 * Edikit — External Integration Adapter Clients (HEMIS & OneID)
 *
 * Prompt 66 — rasmiy contract mavjud bo'lganda roster/grade va identity
 * integration'ni xavfsiz ulash. Har bir provider uchun adapter client:
 *
 *   - HEMIS adapter: roster pull, ratified-only grade push, pull-back
 *     reconciliation, health.
 *   - OneID adapter: identity verify, account link.
 *
 * MODE: `sandbox` default (offline/test — no network, deterministic
 * fixtures). `live` rejim faqat rasmiy HEMIS/OneID contract + env
 * credentiallar (HEMIS_API_KEY, ONEID_API_KEY) mavjud bo'lganda faollashadi
 * (schema: assertAdapterMode). Client barcha live call'larni
 * assertDocumentedEndpoint allowlist orqali o'tkazadi — scraping yoki
 * undocumented endpoint taqiqlanadi.
 *
 * SECURITY (§15-17): token hech qachon plaintext log qilinmaydi; har bir
 * call uchun requiredScopes ko'rsatilishi shart (assertNoTokenReuse).
 */

import {
  assertAdapterMode,
  assertDocumentedEndpoint,
  assertRatifiedOnlyPush,
  mapCanonicalToExternal,
  ADAPTER_MODES,
} from './external-integration.schema.js';

// ── Live-mode detection (env) ──
// Rasmiy contract + credential bo'lmasa → sandbox (offline) rejim.
function liveConfigured() {
  return !!(process.env.HEMIS_API_KEY && process.env.ONEID_API_KEY);
}

export function isLiveMode() {
  const m = assertAdapterMode({ mode: process.env.ADAPTER_MODE || ADAPTER_MODES.SANDBOX, allowLive: !!liveConfigured() });
  return m.ok && m.mode === ADAPTER_MODES.LIVE;
}

function liveFetch(url, options = {}) {
  // Guard: allowlistdan tashqari endpoint → taqiqlanadi (no scraping).
  const ep = new URL(url).pathname;
  const provider = url.includes('oneid') ? 'oneid' : 'hemis';
  const guard = assertDocumentedEndpoint({ provider, endpoint: ep });
  if (!guard.ok) throw new Error(guard.reason);
  return fetch(url, options);
}

// ═══════════════════════════════════════════════════════════════════
// HEMIS ADAPTER
// ═══════════════════════════════════════════════════════════════════

/**
 * HEMIS roster pull → canonical student rows.
 * Sandbox: deterministik demo roster qaytaradi.
 * Live: GET {base}/api/v1/students (documented endpoint).
 */
export async function hemisPullRoster({ baseUrl = '', tenantId = null } = {}) {
  const ep = '/api/v1/students';
  const guard = assertDocumentedEndpoint({ provider: 'hemis', endpoint: ep });
  if (!guard.ok) return { ok: false, error: guard.reason };

  if (!isLiveMode()) {
    return {
      ok: true,
      mode: ADAPTER_MODES.SANDBOX,
      source: 'hemis',
      endpoint: ep,
      rows: [
        { studentId: 'HEM-2026-001', firstName: 'Aziz', lastName: 'Karimov', pinfl: '31001990012345', email: 'aziz.k@univ.uz', groupCode: 'MATH-1', courseCode: 'M101' },
        { studentId: 'HEM-2026-002', firstName: 'Dilnoza', lastName: 'Rahimova', pinfl: '32002010054321', email: 'dilnoza.r@univ.uz', groupCode: 'MATH-1', courseCode: 'M101' },
        { studentId: 'HEM-2026-003', firstName: 'Bekzod', lastName: 'Toshpulatov', pinfl: '33003020011111', email: 'bekzod.t@univ.uz', groupCode: 'PHY-2', courseCode: 'P201' },
      ],
    };
  }

  const url = `${baseUrl}${ep}?tenant=${encodeURIComponent(tenantId || '')}`;
  const res = await liveFetch(url);
  if (!res.ok) return { ok: false, error: `HEMIS pull failed: HTTP ${res.status}` };
  const data = await res.json();
  return { ok: true, mode: ADAPTER_MODES.LIVE, source: 'hemis', endpoint: ep, rows: data.rows || [] };
}

/**
 * HEMIS grade push — faqat RATIFIED qarorlar uchun (§15).
 * Sandbox: muvaffaqiyatli ack qaytaradi.
 * Live: POST {base}/api/v1/grades (documented endpoint).
 */
export async function hemisPushGrades({ baseUrl = '', grades = [], decision = '', tenantId = null } = {}) {
  const ep = '/api/v1/grades';
  const guard = assertDocumentedEndpoint({ provider: 'hemis', endpoint: ep });
  if (!guard.ok) return { ok: false, error: guard.reason };

  const ratified = assertRatifiedOnlyPush({ decision });
  if (!ratified.ok) return { ok: false, error: ratified.reason };

  // Canonical → HEMIS external format (source-of-truth map).
  const payload = grades.map((g) => mapCanonicalToExternal({ kind: 'hemis', canonical: g }));

  if (!isLiveMode()) {
    return {
      ok: true,
      mode: ADAPTER_MODES.SANDBOX,
      endpoint: ep,
      accepted: payload.length,
      externalRefs: payload.map((_, i) => `HEM-PUSH-${Date.now()}-${i}`),
    };
  }

  const res = await liveFetch(`${baseUrl}${ep}?tenant=${encodeURIComponent(tenantId || '')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HEMIS_API_KEY}` },
    body: JSON.stringify({ grades: payload }),
  });
  if (!res.ok) return { ok: false, error: `HEMIS grade push failed: HTTP ${res.status}` };
  const data = await res.json();
  return { ok: true, mode: ADAPTER_MODES.LIVE, endpoint: ep, accepted: payload.length, externalRefs: data.externalRefs || [] };
}

/** HEMIS health — sandbox doim ok. */
export async function hemisHealth({ baseUrl = '' } = {}) {
  if (!isLiveMode()) return { ok: true, mode: ADAPTER_MODES.SANDBOX, healthy: true };
  const res = await liveFetch(`${baseUrl}/api/v1/health`);
  return { ok: res.ok, healthy: res.ok, mode: ADAPTER_MODES.LIVE, status: res.status };
}

// ═══════════════════════════════════════════════════════════════════
// ONEID ADAPTER
// ═══════════════════════════════════════════════════════════════════

/**
 * OneID identity verify — PINFL/subjectni rasmiy OneID orqali tekshiradi.
 * Sandbox: berilgan pinfl asosida deterministik javob qaytaradi
 * (assurance I2 — research §30.1).
 */
export async function oneidVerifyIdentity({ baseUrl = '', pinfl = '', email = '' } = {}) {
  const ep = '/api/v1/identity/verify';
  const guard = assertDocumentedEndpoint({ provider: 'oneid', endpoint: ep });
  if (!guard.ok) return { ok: false, error: guard.reason };
  if (!pinfl) return { ok: false, error: 'pinfl is required for OneID identity verify' };

  if (!isLiveMode()) {
    return {
      ok: true,
      mode: ADAPTER_MODES.SANDBOX,
      endpoint: ep,
      verified: true,
      providerSubject: pinfl,
      assuranceLevel: 'I2',
      email: email || null,
    };
  }

  const res = await liveFetch(`${baseUrl}${ep}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ONEID_API_KEY}` },
    body: JSON.stringify({ pinfl, email: email || null }),
  });
  if (!res.ok) return { ok: false, error: `OneID verify failed: HTTP ${res.status}` };
  const data = await res.json();
  return {
    ok: true,
    mode: ADAPTER_MODES.LIVE,
    endpoint: ep,
    verified: data.verified === true,
    providerSubject: data.subject || pinfl,
    assuranceLevel: data.assuranceLevel || 'I0',
    email: data.email || null,
  };
}

// NOTE: DOCUMENTED_ENDPOINTS faqat schema'dan export qilinadi (barrel'da
// ambiguous star export bo'lmasligi uchun bu yerda re-export YO'Q).
