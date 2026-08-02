/**
 * Edikit — Google Slides Client (server-side)
 *
 * Prompt 59 — Google Slides API (research §9.9): create presentation,
 * presentations.batchUpdate atomik update, Drive API export. Tokenlar
 * vault'da encrypted; scope faqat drive.file.
 *
 * fetchImpl injeksiyasi testlar uchun.
 */

import { SLIDES_API, buildExportRequest } from './google-slides.schema.js';

const GOOGLE_AUTH = 'https://oauth2.googleapis.com';
const GOOGLE_DRIVE = 'https://www.googleapis.com/drive/v3';

function getConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  };
}

export function isGoogleConfigured() {
  const c = getConfig();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

/**
 * Exchange authorization code for tokens (PKCE).
 * @param {Object} params - { code, verifier, fetchImpl }
 */
export async function googleExchangeCode({ code = '', verifier = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const c = getConfig();
  const res = await fn(`${GOOGLE_AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    return { ok: false, error: `Google token exchange failed (${res.status})`, raw: json };
  }
  return { ok: true, accessToken: json.access_token, refreshToken: json.refresh_token || null, expiresIn: json.expires_in || 3600, scope: json.scope || '' };
}

/** Refresh a Google token. */
export async function googleRefreshToken({ refreshToken = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const c = getConfig();
  const res = await fn(`${GOOGLE_AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) return { ok: false, error: `Google token refresh failed (${res.status})` };
  return { ok: true, accessToken: json.access_token, expiresIn: json.expires_in || 3600 };
}

/** Revoke Google token. */
export async function googleRevoke({ token = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  await fn(`${GOOGLE_AUTH}/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  return { ok: true };
}

/** Create a Google Slides presentation (drive.file scope). */
export async function googleCreatePresentation({ accessToken = '', title = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const res = await fn(SLIDES_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: String(title).slice(0, 100) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.presentationId) {
    return { ok: false, error: `Google create presentation failed (${res.status})`, raw: json };
  }
  return { ok: true, presentationId: json.presentationId, presentationUrl: json.presentationUrl || null, raw: json };
}

/** Run presentations.batchUpdate — atomik update. */
export async function googleBatchUpdate({ accessToken = '', presentationId = '', requests = [], fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const res = await fn(`${SLIDES_API}/${encodeURIComponent(presentationId)}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests: requests || [] }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `Google batchUpdate failed (${res.status})`, raw: json };
  return { ok: true, raw: json };
}

/** Export a Google Slides presentation via Drive API (PPTX/PDF). */
export async function googleExportPresentation({ accessToken = '', fileId = '', mimeType = 'application/vnd.google-apps.presentation', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const p = buildExportRequest({ fileId, mimeType });
  const exportMime = mimeType === 'application/pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const res = await fn(`${GOOGLE_DRIVE}/files/${encodeURIComponent(p.fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { ok: false, error: `Google export failed (${res.status})` };
  const buffer = Buffer.from(await res.arrayBuffer());
  return { ok: true, buffer, size: buffer.length, mimeType: exportMime };
}
