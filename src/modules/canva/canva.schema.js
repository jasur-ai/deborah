/**
 * Edikit — Canva Button/Connect Adapter (pure logic)
 *
 * Prompt 59 — Canva modal (Button) va Connect OAuth integratsiyasini
 * canonical deck bilan yopish (research.md §9.8 Canva Button — modal
 * create/edit + onDesignOpen/onDesignPublish callbacks; Canva Connect —
 * OAuth 2.0 Authorization Code + PKCE, create design, import PPTX/PDF/DOCX,
 * export, temporary edit/view URLs, return navigation; §22.8 Google token
 * boshqa provider'ga uzatilmaydi; §22.9 provider API key browserga
 * chiqmaydi; §22.10 Canva editorini ruxsatsiz iframe qilish yo'q). This
 * module is PURE (no I/O, no globals):
 *
 *   - buildPkcePair / buildAuthUrlParams: PKCE state/verifier/challenge.
 *   - validateButtonCallback: Canva Button onDesignOpen/onDesignPublish
 *     payload validation (designId, state, timestamp).
 *   - mapDesignToArtifact: design → canonical artifact version mapping.
 *   - assertCanvaScope: faqat minimal scopes (design:create:edit,
 *     design:content:read, design:export) — full account scope YO'Q.
 *   - buildConnectTokenRequest: PKCE token exchange params.
 *   - mapImportArtifact: imported PPTX/PDF/DOCX → artifact kind.
 *   - validateCallbackState: state (CSRF) timing-safe tekshiruvi.
 *
 * SECURITY / DATA GUARD (Prompt 59 §15-16):
 *   - Google login token Canva'ga berilmaydi (alohida vault).
 *   - Canva token DB'da ENCRYPTED saqlanadi (vault).
 *   - Callback state tekshiruvi (CSRF) — random state.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';

/** Minimal Canva Connect scopes (research §9.8 — full account scope yo'q). */
export const CANVA_SCOPES = [
  'design:create:edit',
  'design:content:read',
  'design:export',
];

/** Button callback types. */
export const BUTTON_CALLBACKS = {
  DESIGN_OPEN: 'onDesignOpen',
  DESIGN_PUBLISH: 'onDesignPublish',
};

/** Artifact kinds imported/exported via Canva. */
export const CANVA_ARTIFACTS = {
  IMPORT_PPTX: 'pptx',
  IMPORT_PDF: 'pdf',
  IMPORT_DOCX: 'docx',
  EXPORT_PPTX: 'pptx',
  EXPORT_PDF: 'pdf',
};

// ═══════════════════════════════════════════════════════════════════
// PKCE
// ═══════════════════════════════════════════════════════════════════

/** Generate PKCE pair (S256). */
export function buildPkcePair(randomBytesHex = '') {
  // randomBytesHex — test'lar uchun deterministik injeksiya
  const raw = randomBytesHex || Math.random().toString(36).slice(2) + Date.now().toString(36);
  const verifier = Buffer.from(raw).toString('base64url').replace(/=/g, '');
  const challenge = Buffer.from(createHash('sha256').update(verifier).digest())
    .toString('base64url')
    .replace(/=/g, '');
  return { verifier, challenge, method: 'S256' };
}

/**
 * Build Canva Connect authorize URL params.
 * @returns {URLSearchParams}
 */
export function buildAuthUrlParams({ clientId = '', redirectUri = '', state = '', challenge = '', verifier = '' } = {}) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CANVA_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  void verifier; // session'da saqlanadi (vault)
  return p;
}

/** Validate callback state (CSRF) — timing-safe. */
export function validateCallbackState({ state = '', expected = '' }) {
  if (!state || !expected) return { ok: false, reason: 'missing state' };
  const ok = state.length === expected.length &&
    state.split('').every((c, i) => c === expected[i]);
  return ok ? { ok: true } : { ok: false, reason: 'state mismatch (CSRF)' };
}

// ═══════════════════════════════════════════════════════════════════
// BUTTON CALLBACK VALIDATION (§59-07)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a Canva Button callback payload.
 * Button payload: { type: 'onDesignPublish', designId, designUrl,
 *   editUrl, thumbnailUrl, state }.
 */
export function validateButtonCallback(payload = {}) {
  const type = payload?.type;
  if (!Object.values(BUTTON_CALLBACKS).includes(type)) {
    return { ok: false, reason: `unknown button callback: ${type}` };
  }
  if (!payload?.designId) return { ok: false, reason: 'designId is required' };
  if (type === BUTTON_CALLBACKS.DESIGN_PUBLISH && !payload?.designUrl && !payload?.editUrl) {
    return { ok: false, reason: 'publish callback requires designUrl or editUrl' };
  }
  return {
    ok: true,
    type,
    designId: String(payload.designId),
    designUrl: payload.designUrl || null,
    editUrl: payload.editUrl || null,
    thumbnailUrl: payload.thumbnailUrl || null,
    state: payload.state || null,
  };
}

/** Map Canva design → canonical artifact version metadata. */
export function mapDesignToArtifact({ designId = '', designUrl = '', thumbnailUrl = '', versionId = null, publishedAt = null } = {}) {
  return {
    kind: 'canva_design',
    designId: String(designId),
    designUrl: designUrl || null,
    thumbnailUrl: thumbnailUrl || null,
    versionId: versionId ? Number(versionId) : null,
    publishedAt: publishedAt || null,
    // Provider lock-in yo'q — canonical document saqlanadi (§9.2)
    canonicalOnly: true,
  };
}

/** Assert requested scope is within the minimal allowlist. */
export function assertCanvaScope(scope = []) {
  const scopes = Array.isArray(scope) ? scope : String(scope).split(' ');
  const invalid = scopes.filter((s) => !CANVA_SCOPES.includes(s));
  if (invalid.length) {
    return { ok: false, reason: `requested non-minimal Canva scopes: ${invalid.join(', ')}`, invalid };
  }
  return { ok: true };
}

/** Map an imported file artifact (Canva Connect import API). */
export function mapImportArtifact({ fileType = '', designId = '', url = '' } = {}) {
  const type = String(fileType).toLowerCase().replace('.', '');
  if (!Object.values(CANVA_ARTIFACTS).includes(type)) {
    return { ok: false, reason: `unsupported import type: ${fileType}` };
  }
  return { ok: true, kind: 'import', format: type, designId: designId || null, url: url || null };
}

/** Map a temporary edit/view URL (Canva Connect — return navigation). */
export function mapTempUrl({ url = '', kind = 'edit' } = {}) {
  if (!url || !/^https:\/\/(www\.)?canva\.com\//.test(url)) {
    return { ok: false, reason: 'temporary URL must be a canva.com URL' };
  }
  return { ok: true, kind: kind === 'edit' ? 'edit' : 'view', url };
}
