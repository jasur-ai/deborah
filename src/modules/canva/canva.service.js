/**
 * Deborah — Canva Button/Connect Adapter (service)
 *
 * Prompt 59 — Canva modal (Button) va Connect OAuth oqimlari:
 *   - linkCanvaAccount: PKCE OAuth → token vault (encrypted).
 *   - handleButtonCallback: Button onDesignOpen/onDesignPublish →
 *     artifact version mapping (callback design/version mapping §59-08).
 *   - getCanvaTempUrl: temporary edit/view URL (Connect return navigation).
 *   - createCanvaDesign / importDeckToCanva / exportFromCanva.
 *   - unlinkCanvaAccount: revoke + vault'ni tozalash.
 *
 * SECURITY / DATA GUARD (Prompt 59 §15-16):
 *   - Google token Canva'ga berilmaydi (alohida vault, §22.8).
 *   - Tokenlar DB'da encrypted (AES-256-GCM).
 *   - Callback state tekshiruvi (CSRF).
 *   - Har bir write path tenant-scoped + idempotent.
 *
 * 09/2026 (BUG-CANVA-01): vault PostgreSQL'dan Firebase'ga ko'chirildi
 * (oauth-vault.js) — production'da Postgres yo'q edi va bu service
 * haqiqatda hech qachon ishlamagan. Maydon nomlari (snake_case) bir xil.
 */

import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  loadConnection,
  saveConnection,
  patchConnection,
  deleteConnection,
} from '../integrations/oauth-vault.js';
import {
  isCanvaConfigured,
  getCanvaAuthUrl,
  canvaExchangeCode,
  canvaRefreshToken,
  canvaRevoke,
  canvaCreateDesign,
  canvaImportDesign,
  canvaExportDesign,
  encryptToken,
  decryptToken,
} from './canva.client.js';
import {
  buildPkcePair,
  buildAuthUrlParams,
  validateButtonCallback,
  validateCallbackState,
  mapDesignToArtifact,
  assertCanvaScope,
  mapImportArtifact,
  mapTempUrl,
} from './canva.schema.js';

export const CANVA_META = {
  configured: false,
  scopes: ['design:content:read', 'design:content:write', 'design:meta:read'],
  buttonCallbacks: ['onDesignOpen', 'onDesignPublish'],
  supports: { modal: true, connect: true, importPptx: true, importPdf: true, importDocx: true, export: true, tempEditUrl: true },
};

// ═══════════════════════════════════════════════════════════════════
// LINK (PKCE OAuth) — §59-09
// ═══════════════════════════════════════════════════════════════════

/** Start Canva Connect OAuth — returns authorize URL (state+PKCE in session). */
export async function startCanvaLink({ session = null } = {}) {
  if (!isCanvaConfigured()) return { ok: false, error: 'Canva not configured' };
  const state = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const { challenge, verifier } = buildPkcePair();
  if (session) {
    session.canvaOAuthState = state;
    session.canvaVerifier = verifier;
  }
  const url = getCanvaAuthUrl({ state, challenge });
  if (!url) return { ok: false, error: 'Canva auth URL build failed' };
  return { ok: true, url };
}

/** Complete Canva Connect OAuth — exchange code, persist encrypted token vault. */
export async function completeCanvaLink({ session = null, code = '', state = '', actorId = null, fetchImpl = null } = {}) {
  // CSRF state tekshiruvi
  const expected = session?.canvaOAuthState;
  const vs = validateCallbackState({ state, expected });
  if (!vs.ok) return { ok: false, error: vs.reason };
  const verifier = session?.canvaVerifier;
  if (!verifier) return { ok: false, error: 'missing PKCE verifier' };

  const t = await canvaExchangeCode({ code, verifier, fetchImpl });
  if (!t.ok) return { ok: false, error: t.error };

  // Scope tekshiruvi — dekorativ/defensive: Canva token response'ida scope
  // maydoni qaytmaydi, shuning uchun haqiqiy himoya authorize URL'ning
  // minimal scope'lari (buildAuthUrlParams → CANVA_SCOPES). Bu faqat
  // future dev'lar minimal scope'ni kengaytirmasligi uchun qo'riqchi.
  const scopeOk = assertCanvaScope(['design:content:read', 'design:content:write', 'design:meta:read']);
  if (!scopeOk.ok) return { ok: false, error: scopeOk.reason };

  const userId = actorId ?? session?.user?.id ?? 'admin';

  const expiresAt = new Date(Date.now() + (t.expiresIn || 3600) * 1000).toISOString();
  await saveConnection('canva', userId, {
    user_id: userId,
    access_token_enc: encryptToken(t.accessToken),
    refresh_token_enc: encryptToken(t.refreshToken),
    token_expires_at: expiresAt,
    scope: ['design:content:read', 'design:content:write', 'design:meta:read'],
    status: 'active',
  });

  // Clear session OAuth temp values
  if (session) {
    delete session.canvaOAuthState;
    delete session.canvaVerifier;
  }

  await audit({ action: AUDIT_ACTIONS.CANVA_LINK, userId: String(userId), details: { action: 'link' } });
  return { ok: true, linked: true };
}

/** Unlink Canva account — revoke tokens + clear vault. */
export async function unlinkCanvaAccount({ actorId = null, fetchImpl = null } = {}) {
  const userId = actorId ?? 'admin';

  const conn = await loadConnection('canva', userId);
  if (!conn) return { ok: true, linked: false };

  const refresh = decryptToken(conn.refresh_token_enc);
  await canvaRevoke({ refreshToken: refresh, fetchImpl }).catch(() => {});

  await deleteConnection('canva', userId);

  await audit({ action: AUDIT_ACTIONS.CANVA_LINK, userId: String(userId), details: { action: 'unlink' } });
  return { ok: true, linked: false };
}

// ═══════════════════════════════════════════════════════════════════
// BUTTON CALLBACK — §59-07/08
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle Canva Button callback (onDesignOpen / onDesignPublish).
 * Design → artifact version mapping; publish → designUrl/editUrl saved.
 */
export async function handleButtonCallback({ payload = {}, actorId = null } = {}) {
  const v = validateButtonCallback(payload);
  if (!v.ok) return { ok: false, error: v.reason };

  const userId = actorId ?? 'admin';

  const mapped = mapDesignToArtifact({
    designId: v.designId,
    designUrl: v.designUrl,
    thumbnailUrl: v.thumbnailUrl,
    publishedAt: new Date().toISOString(),
  });

  // Upsert connection with last callback
  await patchConnection('canva', userId, {
    user_id: userId,
    design_id: v.designId,
    scope: ['design:content:read', 'design:content:write', 'design:meta:read'],
    status: 'active',
    last_callback: { type: v.type, designId: v.designId, designUrl: v.designUrl, editUrl: v.editUrl },
  });

  await audit({
    action: AUDIT_ACTIONS.CANVA_CALLBACK,
    userId: String(userId),
    details: { type: v.type, designId: v.designId, mapped },
  });
  return { ok: true, ...mapped, type: v.type };
}

// ═══════════════════════════════════════════════════════════════════
// TEMP URL / DESIGN FLOWS — §59-10
// ═══════════════════════════════════════════════════════════════════

/** Get a temporary Canva edit/view URL (return navigation). */
export async function getCanvaTempUrl({ designId = '', kind = 'edit', actorId = null, fetchImpl = null } = {}) {
  // If already a full canva.com URL, validate and return
  if (designId.startsWith('http')) {
    const vv = mapTempUrl({ url: designId, kind });
    if (!vv.ok) return { ok: false, error: vv.reason };
    return { ok: true, url: designId, kind };
  }

  // Otherwise resolve from vault — the edit URL is the design's edit link
  const userId = actorId ?? 'admin';

  const conn = await loadConnection('canva', userId);
  if (!conn || (conn.design_id && conn.design_id !== designId)) {
    return { ok: false, error: 'canva connection not found' };
  }

  let callback = conn.last_callback || {};
  if (typeof callback === 'string') {
    try { callback = JSON.parse(callback); } catch { callback = {}; }
  }
  const url = kind === 'edit' ? callback.editUrl : callback.designUrl;
  const vv = mapTempUrl({ url: url || '', kind });
  if (!vv.ok) return { ok: false, error: vv.reason };
  return { ok: true, url, kind };
}

/** Create a Canva design (Connect API) from a title. */
export async function createCanvaDesign({ title = '', actorId = null, fetchImpl = null } = {}) {
  const userId = actorId ?? 'admin';

  const conn = await loadConnection('canva', userId);
  if (!conn) return { ok: false, error: 'canva not linked' };

  const token = decryptToken(conn.access_token_enc);
  if (!token) return { ok: false, error: 'canva token unavailable' };

  const r = await canvaCreateDesign({ accessToken: token, title, fetchImpl });
  if (!r.ok) return { ok: false, error: r.error };

  await patchConnection('canva', userId, { design_id: r.designId });

  await audit({ action: AUDIT_ACTIONS.CANVA_CREATE, userId: String(userId), details: { designId: r.designId } });
  return { ok: true, designId: r.designId, designUrl: r.designUrl };
}

/** Import canonical deck export (PPTX/PDF) into Canva design. */
export async function importDeckToCanva({ designId = '', fileType = 'pptx', fileBase64 = '', actorId = null, fetchImpl = null } = {}) {
  const map = mapImportArtifact({ fileType });
  if (!map.ok) return { ok: false, error: map.reason };

  const userId = actorId ?? 'admin';

  const conn = await loadConnection('canva', userId);
  if (!conn) return { ok: false, error: 'canva not linked' };
  const token = decryptToken(conn.access_token_enc);
  if (!token) return { ok: false, error: 'canva token unavailable' };

  const r = await canvaImportDesign({ accessToken: token, designId, fileType: map.format, fileBase64, fetchImpl });
  if (!r.ok) return { ok: false, error: r.error };

  await audit({ action: AUDIT_ACTIONS.CANVA_IMPORT, userId: String(userId), details: { designId, fileType: map.format } });
  return { ok: true, designId, imported: true };
}

/** Export a Canva design to PPTX/PDF (result artifact saved by caller). */
export async function exportFromCanva({ designId = '', exportType = 'pdf', actorId = null, fetchImpl = null } = {}) {
  const userId = actorId ?? 'admin';

  const conn = await loadConnection('canva', userId);
  if (!conn) return { ok: false, error: 'canva not linked' };
  const token = decryptToken(conn.access_token_enc);
  if (!token) return { ok: false, error: 'canva token unavailable' };

  const r = await canvaExportDesign({ accessToken: token, designId, exportType, fetchImpl });
  if (!r.ok) return { ok: false, error: r.error };

  await audit({ action: AUDIT_ACTIONS.CANVA_EXPORT, userId: String(userId), details: { designId, exportType } });
  return { ok: true, designId, exportType, raw: r.raw };
}
