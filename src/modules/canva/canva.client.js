/**
 * Deborah — Canva Connect Client (server-side)
 *
 * Prompt 59 — Canva Connect API (research §9.8): OAuth 2.0 Authorization
 * Code + PKCE, create presentation design, list/get design, import
 * PPTX/PDF/DOCX, export, temporary edit/view URLs, return navigation.
 *
 * Token vault: access/refresh tokenlar DB'da ENCRYPTED (AES-256-GCM),
 * key env'da (ENCRYPTION_KEY || SESSION_SECRET derived). Hech qachon
 * response'ga chiqmaydi (§22.9).
 */

import { CANVA_SCOPES } from './canva.schema.js';
import { encryptToken, decryptToken } from '../auth/token-vault.js';

export { encryptToken, decryptToken };

const CANVA_API = 'https://api.canva.com/rest';
const CANVA_AUTH = 'https://www.canva.com/api/oauth2/authorize';

function getConfig() {
  return {
    clientId: process.env.CANVA_CLIENT_ID || '',
    clientSecret: process.env.CANVA_CLIENT_SECRET || '',
    redirectUri: process.env.CANVA_REDIRECT_URI || '',
  };
}

export function isCanvaConfigured() {
  const c = getConfig();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

export function getCanvaAuthUrl({ state = '', challenge = '' } = {}) {
  const c = getConfig();
  if (!isCanvaConfigured()) return null;
  const p = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: CANVA_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${CANVA_AUTH}?${p.toString()}`;
}

/**
 * Exchange authorization code for tokens (PKCE).
 * @param {Object} params - { code, verifier, fetchImpl }
 */
export async function canvaExchangeCode({ code = '', verifier = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const c = getConfig();
  const res = await fn('https://api.canva.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirectUri,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code_verifier: verifier,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    return { ok: false, error: `Canva token exchange failed (${res.status})`, raw: json };
  }
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresIn: json.expires_in || 3600,
  };
}

/** Refresh an expired Canva token. */
export async function canvaRefreshToken({ refreshToken = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const c = getConfig();
  const res = await fn('https://api.canva.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    return { ok: false, error: `Canva token refresh failed (${res.status})` };
  }
  return { ok: true, accessToken: json.access_token, refreshToken: json.refresh_token || refreshToken, expiresIn: json.expires_in || 3600 };
}

/** Revoke Canva tokens. */
export async function canvaRevoke({ accessToken = '', refreshToken = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const c = getConfig();
  if (refreshToken) {
    await fn('https://api.canva.com/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        token: refreshToken,
      }),
    }).catch(() => {});
  }
  void accessToken;
  return { ok: true };
}

/** Create a Canva design from a canonical deck brief. */
export async function canvaCreateDesign({ accessToken = '', title = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const res = await fn(`${CANVA_API}/designs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      design_type: 'presentation',
      title: title || 'Deborah deck',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.design?.id) {
    return { ok: false, error: `Canva create design failed (${res.status})` };
  }
  return { ok: true, designId: json.design.id, designUrl: json.design.urls?.edit_url || null, raw: json };
}

/** Import PPTX/PDF/DOCX into a Canva design. */
export async function canvaImportDesign({ accessToken = '', designId = '', fileType = 'pptx', fileBase64 = '', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const res = await fn(`${CANVA_API}/designs/${encodeURIComponent(designId)}/imports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_type: fileType,
      file: fileBase64,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `Canva import failed (${res.status})` };
  return { ok: true, raw: json };
}

/** Export a Canva design to PPTX/PDF. */
export async function canvaExportDesign({ accessToken = '', designId = '', exportType = 'pdf', fetchImpl = null } = {}) {
  const fn = fetchImpl || globalThis.fetch;
  const res = await fn(`${CANVA_API}/designs/${encodeURIComponent(designId)}/exports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ export_type: exportType, export_format: exportType }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `Canva export failed (${res.status})` };
  return { ok: true, raw: json };
}
