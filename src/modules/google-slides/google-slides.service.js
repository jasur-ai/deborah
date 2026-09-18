/**
 * Deborah — Google Slides Adapter (service)
 *
 * Prompt 59 — Google Slides minimum-scope integratsiyasi:
 *   - startGoogleLink: PKCE OAuth → drive.file scope authorize URL.
 *   - completeGoogleLink: code exchange → token vault (encrypted).
 *   - createFromCanonical: canonical deck → Slides create + batchUpdate.
 *   - exportGooglePresentation: Drive export (PPTX/PDF).
 *   - unlinkGoogleAccount: revoke + vault'ni tozalash.
 *
 * SECURITY / DATA GUARD (Prompt 59 §15-16):
 *   - Faqat drive.file scope (§9.9) — full Drive REJECT.
 *   - Google token Canva/Gamma/Manus/Anthropic'ga berilmaydi (§22.8).
 *   - Tokenlar encrypted vault.
 *   - Har bir write path tenant-scoped + idempotent.
 *
 * 09/2026 (BUG-CANVA-01): vault PostgreSQL'dan Firebase'ga ko'chirildi
 * (oauth-vault.js) — production'da Postgres yo'q edi va bu service
 * haqiqatda hech qachon ishlamagan.
 */

import { randomBytes } from 'crypto';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { encryptToken, decryptToken } from '../auth/token-vault.js';
import { getProviderConfig } from '../integrations/credentials.js';
import {
  loadConnection,
  saveConnection,
  patchConnection,
  deleteConnection,
  savePendingOAuth,
  consumePendingOAuth,
} from '../integrations/oauth-vault.js';

export { encryptToken, decryptToken };
import {
  isGoogleConfigured,
  googleExchangeCode,
  googleRefreshToken,
  googleRevoke,
  googleCreatePresentation,
  googleBatchUpdate,
  googleExportPresentation,
} from './google-slides.client.js';
import {
  buildPkcePair,
  buildGoogleAuthUrlParams,
  assertDriveFileScope,
  validateCallbackState,
  buildCreatePresentationRequest,
  mapCanonicalBlocksToSlides,
  buildBatchUpdateRequests,
} from './google-slides.schema.js';

export const GOOGLE_SLIDES_META = {
  configured: false,
  scope: 'https://www.googleapis.com/auth/drive.file',
  fullDrive: false,
  supports: { create: true, batchUpdate: true, exportPptx: true, exportPdf: true },
};

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

// ═══════════════════════════════════════════════════════════════════
// LINK (PKCE OAuth — drive.file only) — §59-11
// ═══════════════════════════════════════════════════════════════════

/** Start Google Slides OAuth — returns authorize URL (drive.file only). */
export async function startGoogleLink({ session = null, actorId = null } = {}) {
  if (!isGoogleConfigured()) return { ok: false, error: 'Google not configured' };
  // BUG-CANVA-02: crypto state + server-side pending store (Strict cookie
  // cross-site redirect'da kelmaydi — sessiya yetarli emas).
  const state = `g_${randomBytes(24).toString('hex')}`;
  const { challenge, verifier } = buildPkcePair();
  const linkUser = actorId ?? session?.user?.id ?? 'admin';
  await savePendingOAuth('google-slides', { state, verifier, actorId: linkUser });
  if (session) {
    session.googleSlidesState = state;
    session.googleSlidesVerifier = verifier;
  }
  // 09/2026: admin panelda kiritilgan kalitlar ham ishlaydi (faqat env emas)
  const gc = getProviderConfig('google-slides');
  const params = buildGoogleAuthUrlParams({
    clientId: gc.clientId,
    redirectUri: gc.redirectUri,
    state,
    challenge,
  });
  return { ok: true, url: `${GOOGLE_AUTH}?${params.toString()}` };
}

/** Complete Google Slides OAuth — exchange code, persist encrypted vault. */
export async function completeGoogleLink({ session = null, code = '', state = '', actorId = null, fetchImpl = null } = {}) {
  // CSRF: avval sessiya, bo'lmasa pending store (BUG-CANVA-02, bir martalik).
  let verifier = null;
  let pendingActor = null;
  const expected = session?.googleSlidesState;
  if (expected) {
    const vs = validateCallbackState({ state, expected });
    if (!vs.ok) return { ok: false, error: vs.reason };
    verifier = session?.googleSlidesVerifier;
  } else {
    const p = await consumePendingOAuth('google-slides', state);
    if (!p.ok) return { ok: false, error: p.expired ? 'OAuth state expired' : 'invalid OAuth state (CSRF)' };
    verifier = p.verifier;
    pendingActor = p.actorId;
  }
  if (!verifier) return { ok: false, error: 'missing PKCE verifier' };

  const t = await googleExchangeCode({ code, verifier, fetchImpl });
  if (!t.ok) return { ok: false, error: t.error };

  // Scope tekshiruvi — faqat drive.file (full Drive REJECT)
  const scopeOk = assertDriveFileScope(t.scope);
  if (!scopeOk.ok) return { ok: false, error: scopeOk.reason };

  const userId = actorId ?? session?.user?.id ?? pendingActor ?? 'admin';

  const expiresAt = new Date(Date.now() + (t.expiresIn || 3600) * 1000).toISOString();
  await saveConnection('google-slides', userId, {
    user_id: userId,
    google_email: null,
    access_token_enc: encryptToken(t.accessToken),
    refresh_token_enc: encryptToken(t.refreshToken),
    token_expires_at: expiresAt,
    scope: 'https://www.googleapis.com/auth/drive.file',
    status: 'active',
  });

  if (session) {
    delete session.googleSlidesState;
    delete session.googleSlidesVerifier;
  }

  await audit({ action: AUDIT_ACTIONS.GOOGLE_LINK, userId: String(userId), details: { action: 'link', scope: t.scope } });
  return { ok: true, linked: true };
}

/** Unlink Google account — revoke + clear vault. */
export async function unlinkGoogleAccount({ actorId = null, fetchImpl = null } = {}) {
  const userId = actorId ?? 'admin';

  const conn = await loadConnection('google-slides', userId);
  if (!conn) return { ok: true, linked: false };

  const refresh = decryptToken(conn.refresh_token_enc);
  await googleRevoke({ token: refresh, fetchImpl }).catch(() => {});

  await deleteConnection('google-slides', userId);

  await audit({ action: AUDIT_ACTIONS.GOOGLE_LINK, userId: String(userId), details: { action: 'unlink' } });
  return { ok: true, linked: false };
}

// ═══════════════════════════════════════════════════════════════════
// CREATE FROM CANONICAL — §59-12
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a Google Slides presentation from a canonical deck:
 *   create → batchUpdate (atomik).
 * @param {Object} params - { title, document, actorId, fetchImpl }
 */
export async function createFromCanonical({ title = '', document = null, actorId = null, fetchImpl = null } = {}) {
  if (!document || !Array.isArray(document.slides)) {
    return { ok: false, error: 'canonical document required (with slides)' };
  }
  const userId = actorId ?? 'admin';

  const conn = await loadConnection('google-slides', userId);
  if (!conn) return { ok: false, error: 'google not linked' };

  const token = decryptToken(conn.access_token_enc);
  if (!token) return { ok: false, error: 'google token unavailable' };

  // 1. Create presentation
  const createReq = buildCreatePresentationRequest({ title });
  const created = await googleCreatePresentation({ accessToken: token, title: createReq.title, fetchImpl });
  if (!created.ok) return { ok: false, error: created.error };

  // 2. Map canonical → slide texts → batchUpdate requests (atomik)
  const mapped = mapCanonicalBlocksToSlides(document);
  if (!mapped.ok) return { ok: false, error: mapped.reason };
  const requests = buildBatchUpdateRequests({ slides: mapped.slides });
  const bu = await googleBatchUpdate({ accessToken: token, presentationId: created.presentationId, requests, fetchImpl });
  if (!bu.ok) return { ok: false, error: bu.error };

  // 3. Persist presentation_id on connection
  await patchConnection('google-slides', userId, { presentation_id: created.presentationId });

  await audit({
    action: AUDIT_ACTIONS.GOOGLE_CREATE,
    userId: String(userId),
    details: { presentationId: created.presentationId, slides: mapped.slides.length, requests: requests.length },
  });
  return { ok: true, presentationId: created.presentationId, presentationUrl: created.presentationUrl, slides: mapped.slides.length };
}

/** Export a Google Slides presentation (PPTX/PDF). */
export async function exportGooglePresentation({ presentationId = null, format = 'pptx', actorId = null, fetchImpl = null } = {}) {
  if (!presentationId) return { ok: false, error: 'presentationId is required' };
  if (!['pptx', 'pdf'].includes(format)) return { ok: false, error: 'format must be pptx or pdf' };
  const userId = actorId ?? 'admin';

  const conn = await loadConnection('google-slides', userId);
  if (!conn) return { ok: false, error: 'google not linked' };
  const token = decryptToken(conn.access_token_enc);
  if (!token) return { ok: false, error: 'google token unavailable' };

  const mimeType = format === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; // pptx
  const r = await googleExportPresentation({ accessToken: token, fileId: presentationId, mimeType, fetchImpl });
  if (!r.ok) return { ok: false, error: r.error };

  await audit({ action: AUDIT_ACTIONS.GOOGLE_EXPORT, userId: String(userId), details: { presentationId, format, size: r.size } });
  return { ok: true, buffer: r.buffer, size: r.size, mimeType: r.mimeType };
}
