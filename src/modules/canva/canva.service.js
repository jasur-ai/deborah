/**
 * Edikit — Canva Button/Connect Adapter (service)
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
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
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
  scopes: ['design:create:edit', 'design:content:read', 'design:export'],
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
  const scopeOk = assertCanvaScope(['design:create:edit', 'design:content:read', 'design:export']);
  if (!scopeOk.ok) return { ok: false, error: scopeOk.reason };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const userId = actorId || session?.user?.id || 0;

  const expiresAt = new Date(Date.now() + (t.expiresIn || 3600) * 1000);
  await db
    .insertInto('canva_connections')
    .values({
      tenant_id: tenantId,
      user_id: userId,
      access_token_enc: encryptToken(t.accessToken),
      refresh_token_enc: encryptToken(t.refreshToken),
      token_expires_at: expiresAt,
      scope: JSON.stringify(['design:create:edit', 'design:content:read', 'design:export']),
      status: 'active',
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doUpdateSet({
      access_token_enc: encryptToken(t.accessToken),
      refresh_token_enc: encryptToken(t.refreshToken),
      token_expires_at: expiresAt,
      status: 'active',
      updated_at: new Date(),
    }))
    .execute();

  // Clear session OAuth temp values
  if (session) {
    delete session.canvaOAuthState;
    delete session.canvaVerifier;
  }

  await audit(AUDIT_ACTIONS.CANVA_LINK, { actorId: userId, tenantId, detail: { action: 'link' } });
  return { ok: true, linked: true };
}

/** Unlink Canva account — revoke tokens + clear vault. */
export async function unlinkCanvaAccount({ actorId = null, fetchImpl = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const userId = actorId || 0;

  const conn = await db
    .selectFrom('canva_connections')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!conn) return { ok: true, linked: false };

  const refresh = decryptToken(conn.refresh_token_enc);
  await canvaRevoke({ refreshToken: refresh, fetchImpl }).catch(() => {});

  await db.deleteFrom('canva_connections')
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .execute();

  await audit(AUDIT_ACTIONS.CANVA_LINK, { actorId: userId, tenantId, detail: { action: 'unlink' } });
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

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const userId = actorId || 0;

  const mapped = mapDesignToArtifact({
    designId: v.designId,
    designUrl: v.designUrl,
    thumbnailUrl: v.thumbnailUrl,
    publishedAt: new Date().toISOString(),
  });

  // Upsert connection with last callback
  await db
    .insertInto('canva_connections')
    .values({
      tenant_id: tenantId,
      user_id: userId,
      design_id: v.designId,
      scope: JSON.stringify(['design:create:edit', 'design:content:read', 'design:export']),
      status: 'active',
      last_callback: JSON.stringify({ type: v.type, designId: v.designId, designUrl: v.designUrl, editUrl: v.editUrl }),
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doUpdateSet({
      design_id: v.designId,
      last_callback: JSON.stringify({ type: v.type, designId: v.designId, designUrl: v.designUrl, editUrl: v.editUrl }),
      status: 'active',
      updated_at: new Date(),
    }))
    .execute();

  await audit(AUDIT_ACTIONS.CANVA_CALLBACK, {
    actorId: userId,
    tenantId,
    detail: { type: v.type, designId: v.designId, mapped },
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
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const userId = actorId || 0;

  const conn = await db
    .selectFrom('canva_connections')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .where('design_id', '=', designId)
    .executeTakeFirst();
  if (!conn) return { ok: false, error: 'canva connection not found' };

  const callback = conn.last_callback || {};
  const url = kind === 'edit' ? callback.editUrl : callback.designUrl;
  const vv = mapTempUrl({ url: url || '', kind });
  if (!vv.ok) return { ok: false, error: vv.reason };
  return { ok: true, url, kind };
}

/** Create a Canva design (Connect API) from a title. */
export async function createCanvaDesign({ title = '', actorId = null, fetchImpl = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const userId = actorId || 0;

  const conn = await db
    .selectFrom('canva_connections')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!conn) return { ok: false, error: 'canva not linked' };

  const token = decryptToken(conn.access_token_enc);
  if (!token) return { ok: false, error: 'canva token unavailable' };

  const r = await canvaCreateDesign({ accessToken: token, title, fetchImpl });
  if (!r.ok) return { ok: false, error: r.error };

  await db.updateTable('canva_connections')
    .set({ design_id: r.designId, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .execute();

  await audit(AUDIT_ACTIONS.CANVA_CREATE, { actorId: userId, tenantId, detail: { designId: r.designId } });
  return { ok: true, designId: r.designId, designUrl: r.designUrl };
}

/** Import canonical deck export (PPTX/PDF) into Canva design. */
export async function importDeckToCanva({ designId = '', fileType = 'pptx', fileBase64 = '', actorId = null, fetchImpl = null } = {}) {
  const map = mapImportArtifact({ fileType });
  if (!map.ok) return { ok: false, error: map.reason };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const userId = actorId || 0;

  const conn = await db
    .selectFrom('canva_connections')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!conn) return { ok: false, error: 'canva not linked' };
  const token = decryptToken(conn.access_token_enc);
  if (!token) return { ok: false, error: 'canva token unavailable' };

  const r = await canvaImportDesign({ accessToken: token, designId, fileType: map.format, fileBase64, fetchImpl });
  if (!r.ok) return { ok: false, error: r.error };

  await audit(AUDIT_ACTIONS.CANVA_IMPORT, { actorId: userId, tenantId, detail: { designId, fileType: map.format } });
  return { ok: true, designId, imported: true };
}

/** Export a Canva design to PPTX/PDF (result artifact saved by caller). */
export async function exportFromCanva({ designId = '', exportType = 'pdf', actorId = null, fetchImpl = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const userId = actorId || 0;

  const conn = await db
    .selectFrom('canva_connections')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!conn) return { ok: false, error: 'canva not linked' };
  const token = decryptToken(conn.access_token_enc);
  if (!token) return { ok: false, error: 'canva token unavailable' };

  const r = await canvaExportDesign({ accessToken: token, designId, exportType, fetchImpl });
  if (!r.ok) return { ok: false, error: r.error };

  await audit(AUDIT_ACTIONS.CANVA_EXPORT, { actorId: userId, tenantId, detail: { designId, exportType } });
  return { ok: true, designId, exportType, raw: r.raw };
}
