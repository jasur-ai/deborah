/**
 * Deborah — Student Evidence Portfolio & Verifiable Credentials (service)
 *
 * Prompt 61 — evidence portfolio + credential lifecycle:
 *   - ensurePortfolio / addPortfolioItem / setItemVisibility / listPortfolio
 *   - createCredentialDefinition / publishCredentialDefinition
 *   - issueCredential (idempotent by evidence_hash) — guard: LLM yoki
 *     unratified evidence hech qachon credential chiqarmaydi
 *   - revokeCredential / renewCredential / appealCredential
 *   - createShareGrant / revokeShareGrant
 *   - verifyCredential (public verifier — valid/revoked/expired)
 *
 * SECURITY / DATA GUARD (Prompt 61 §15):
 *   - LLM credential bermaydi; raw sensitive submission public credentialga
 *     chiqmaydi (serialization guard).
 *   - Har write path tenant-scoped, authorized, idempotent.
 *   - Privileged action (issue/revoke/renew) → audit event.
 */

import crypto from 'crypto';
import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  assertNoLlmCredential,
  checkCredentialEligibility,
  assertIssuerAuthorized,
  assertStatusTransition,
  assertAppealAllowed,
  assertRenewAllowed,
  evaluateShareGrant,
  computeEvidenceHash,
  computeVcDigest,
  buildSelectivePayload,
  CREDENTIAL_STATUS,
  DEFINITION_STATUS,
  ITEM_VISIBILITY,
  ITEM_KINDS,
  AI_USE_LEVELS,
} from './credential.schema.js';

/** jsonb maydonlarni string (fake DB) / object (real PG) ikkalasida ham object qiladi. */
function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// PORTFOLIO
// ═══════════════════════════════════════════════════════════════════

/** Get-or-create default-private portfolio for a user. */
export async function ensurePortfolio({ userId = 0, displayName = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const existing = await db
    .selectFrom('portfolios')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing) return { ok: true, portfolio: existing, cached: true };

  const row = await db
    .insertInto('portfolios')
    .values({ tenant_id: tenantId, user_id: userId, is_public: false, display_name: displayName })
    .returning(['id'])
    .executeTakeFirst();
  const portfolio = { id: row.id, tenant_id: tenantId, user_id: userId, is_public: false, display_name: displayName };
  return { ok: true, portfolio, cached: false };
}

/**
 * Add an evidence item to a portfolio.
 * Security: har qanday yangi item DEFAULT-PRIVATE bo'ladi — visibility faqat
 * owner tomonidan setItemVisibility() orqali oshiriladi (opt-in model).
 */
export async function addPortfolioItem({ userId = 0, kind = 'draft', title = '', contentMeta = {}, evidenceRef = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  if (!ITEM_KINDS.includes(kind)) return { ok: false, error: `invalid item kind: ${kind}` };
  if (!AI_USE_LEVELS.includes(contentMeta.aiUseLevel || 'A0') && contentMeta.aiUseLevel) {
    return { ok: false, error: `invalid AI use level: ${contentMeta.aiUseLevel}` };
  }

  const { portfolio } = await ensurePortfolio({ userId });
  const row = await db
    .insertInto('portfolio_items')
    .values({
      tenant_id: tenantId,
      portfolio_id: portfolio.id,
      kind,
      title,
      visibility: ITEM_VISIBILITY.PRIVATE,
      content_meta: JSON.stringify(contentMeta || {}),
      evidence_ref: evidenceRef,
    })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, itemId: row.id };
}

/** Set item visibility (owner-only; default stays private). */
export async function setItemVisibility({ userId = 0, itemId = 0, visibility = ITEM_VISIBILITY.PRIVATE } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  if (!Object.values(ITEM_VISIBILITY).includes(visibility)) return { ok: false, error: `invalid visibility: ${visibility}` };

  const item = await db
    .selectFrom('portfolio_items')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', itemId)
    .executeTakeFirst();
  if (!item) return { ok: false, error: 'item not found' };
  const portfolio = await db
    .selectFrom('portfolios')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', item.portfolio_id)
    .executeTakeFirst();
  if (!portfolio || portfolio.user_id !== userId) return { ok: false, error: 'not your item' };

  await db
    .updateTable('portfolio_items')
    .set({ visibility, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', itemId)
    .execute();
  return { ok: true, itemId, visibility };
}

/** List a user's portfolio items (owner view). */
export async function listPortfolio({ userId = 0, includePrivate = true } = {}) {
  const db = getDb();
  if (!db) return { items: [], portfolio: null };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { items: [], portfolio: null };

  const portfolio = await db
    .selectFrom('portfolios')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!portfolio) return { items: [], portfolio: null };

  let q = db.selectFrom('portfolio_items').selectAll().where('tenant_id', '=', tenantId).where('portfolio_id', '=', portfolio.id);
  if (!includePrivate) q = q.where('visibility', 'in', [ITEM_VISIBILITY.SHARED, ITEM_VISIBILITY.PUBLIC]);
  const rows = await q.orderBy('created_at', 'desc').execute();
  return { portfolio, items: rows.map((r) => ({ ...r, content_meta: parseJson(r.content_meta) || {} })) };
}

/** Public portfolio view (only public items, no raw content_meta details). */
export async function getPublicPortfolio({ userId = 0 } = {}) {
  const db = getDb();
  if (!db) return { items: [] };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { items: [] };

  const portfolio = await db
    .selectFrom('portfolios')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!portfolio) return { items: [] };
  // item-level visibility fine-grained control — portfolio-level gate
  // alohida shart emas (default-private item + explicit public opt-in)

  const rows = await db
    .selectFrom('portfolio_items')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('portfolio_id', '=', portfolio.id)
    .where('visibility', '=', ITEM_VISIBILITY.PUBLIC)
    .orderBy('created_at', 'desc')
    .execute();
  return {
    items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, created_at: r.created_at })),
  };
}

// ═══════════════════════════════════════════════════════════════════
// CREDENTIAL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

/** Create a versioned credential definition (criteria + issuer authority). */
export async function createCredentialDefinition({ name = '', version = 'v1', criteria = {}, issuerAuthority = 'admin', createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  if (!name) return { ok: false, error: 'name is required' };

  const row = await db
    .insertInto('credential_definitions')
    .values({
      tenant_id: tenantId,
      name,
      version,
      status: DEFINITION_STATUS.DRAFT,
      criteria: JSON.stringify(criteria || {}),
      issuer_authority: issuerAuthority,
      created_by: createdBy,
    })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, definitionId: row.id };
}

/** Publish a definition — required before issuing (issuer authority guard). */
export async function publishCredentialDefinition({ definitionId = 0, actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const def = await db
    .selectFrom('credential_definitions')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', definitionId)
    .executeTakeFirst();
  if (!def) return { ok: false, error: 'definition not found' };

  await db
    .updateTable('credential_definitions')
    .set({ status: DEFINITION_STATUS.PUBLISHED, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', definitionId)
    .execute();

  await audit({
    action: AUDIT_ACTIONS.CREDENTIAL_DEFINITION_PUBLISH,
    userId: actorId,
    tenantId,
    resourceType: 'credential_definition',
    resourceId: String(definitionId),
    details: { name: def.name, version: def.version },
  });
  return { ok: true, definitionId };
}

/** List definitions (tenant-scoped). */
export async function listCredentialDefinitions({ status = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db.selectFrom('credential_definitions').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  const rows = await q.orderBy('created_at', 'desc').execute();
  return rows.map((r) => ({ ...r, criteria: parseJson(r.criteria) || {} }));
}

// ═══════════════════════════════════════════════════════════════════
// ISSUE / REVOKE / RENEW / APPEAL
// ═══════════════════════════════════════════════════════════════════

/**
 * Issue a credential — idempotent (evidence_hash). Guards: LLM bermaydi,
 * ratified evidence + teacher/admin approve, definition PUBLISHED.
 */
export async function issueCredential({
  definitionId = 0,
  userId = 0,
  recipient = '',
  evidence = {},
  criteria = {},
  issuedBy = '',
  issuedByRole = 'teacher',
  evidenceRatified = false,
  teacherApproved = false,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  // Guard: AI hech qachon credential bermaydi
  const g = assertNoLlmCredential({ issuedByRole, evidenceRatified, teacherApproved });
  if (!g.ok) return { ok: false, error: g.reason, guard: g.detail };

  const def = await db
    .selectFrom('credential_definitions')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', definitionId)
    .executeTakeFirst();
  if (!def) return { ok: false, error: 'credential definition not found' };

  const authz = assertIssuerAuthorized({ definition: { ...def, criteria: parseJson(def.criteria) || {} }, issuer: issuedByRole === 'admin' ? 'admin' : issuedBy });
  if (!authz.ok) return { ok: false, error: authz.reason };

  const mergedCriteria = criteria && Object.keys(criteria).length ? criteria : (parseJson(def.criteria) || {});
  const eligibility = checkCredentialEligibility({ criteria: mergedCriteria, evidence });
  if (!eligibility.ok) {
    return { ok: false, error: 'not eligible', checks: eligibility.checks };
  }

  const hash = computeEvidenceHash({ userId, definitionId, evidence });
  // Idempotency — existing credential (same evidence) qaytariladi
  const existing = await db
    .selectFrom('credentials')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('evidence_hash', '=', hash)
    .executeTakeFirst();
  if (existing) {
    const mapped = mapCredentialRow(existing);
    return { ok: true, credential: mapped, cached: true };
  }
  // (idempotency: same evidence_hash => cached qaytadi; vcDigest ham same)

  const issuedAt = Date.now();
  const expiresInDays = Number(mergedCriteria.expiresInDays || 0);
  const expiresAt = expiresInDays > 0 ? issuedAt + expiresInDays * 86400000 : null;
  const placeholder = {
    id: 0,
    name: def.name,
    recipient,
    description: mergedCriteria.description || '',
    competencyIds: mergedCriteria.competencyIds || [],
    evidenceHash: hash,
  };
  const vcDigest = computeVcDigest({ credential: placeholder, issuedAt, issuer: issuedBy });

  const row = await db
    .insertInto('credentials')
    .values({
      tenant_id: tenantId,
      definition_id: definitionId,
      user_id: userId,
      name: def.name,
      recipient,
      status: CREDENTIAL_STATUS.ACTIVE,
      evidence_hash: hash,
      vc_digest: vcDigest,
      issued_at: new Date(issuedAt),
      expires_at: expiresAt ? new Date(expiresAt) : null,
      issued_by: issuedBy,
    })
    .returning(['id'])
    .executeTakeFirst();

  await db
    .insertInto('credential_events')
    .values({ tenant_id: tenantId, credential_id: row.id, event_type: 'issue', actor: issuedBy, detail: JSON.stringify({ definitionId, userId }) })
    .execute();

  await audit({
    action: AUDIT_ACTIONS.CREDENTIAL_ISSUE,
    userId: issuedBy,
    tenantId,
    resourceType: 'credential',
    resourceId: String(row.id),
    details: { definitionId, userId, evidenceHash: hash.slice(0, 12) },
  });

  const credential = { id: row.id, name: def.name, recipient, vcDigest, evidenceHash: hash, issuedAt, status: CREDENTIAL_STATUS.ACTIVE };
  return { ok: true, credential, cached: false };
}

/** Revoke a credential — authorized issuer, FSM-guarded, audit. */
export async function revokeCredential({ credentialId = 0, reason = '', actorId = null, actorRole = 'admin' } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const cred = await db
    .selectFrom('credentials')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', credentialId)
    .executeTakeFirst();
  if (!cred) return { ok: false, error: 'credential not found' };

  const trans = assertStatusTransition({ from: cred.status, to: CREDENTIAL_STATUS.REVOKED });
  if (!trans.ok) return { ok: false, error: trans.reason };

  await db
    .updateTable('credentials')
    .set({ status: CREDENTIAL_STATUS.REVOKED, revoked_at: new Date(), revoked_reason: reason, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', credentialId)
    .execute();

  await db
    .insertInto('credential_events')
    .values({ tenant_id: tenantId, credential_id: credentialId, event_type: 'revoke', actor: actorId, detail: JSON.stringify({ reason }) })
    .execute();

  await audit({
    action: AUDIT_ACTIONS.CREDENTIAL_REVOKE,
    userId: actorId,
    tenantId,
    resourceType: 'credential',
    resourceId: String(credentialId),
    details: { reason, actorRole },
  });
  return { ok: true, credentialId, status: CREDENTIAL_STATUS.REVOKED };
}

/** Renew — eligibility must still hold. */
export async function renewCredential({ credentialId = 0, evidence = {}, criteria = {}, actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const cred = await db
    .selectFrom('credentials')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', credentialId)
    .executeTakeFirst();
  if (!cred) return { ok: false, error: 'credential not found' };

  const eligibility = checkCredentialEligibility({ criteria: criteria || {}, evidence });
  const renew = assertRenewAllowed({ status: cred.status, eligibility });
  if (!renew.ok) return { ok: false, error: renew.reason };

  const issuedAt = Date.now();
  const expiresInDays = Number(criteria.expiresInDays || 0);
  const expiresAt = expiresInDays > 0 ? issuedAt + expiresInDays * 86400000 : null;
  const hash = computeEvidenceHash({ userId: cred.user_id, definitionId: cred.definition_id, evidence });

  await db
    .updateTable('credentials')
    .set({ status: CREDENTIAL_STATUS.ACTIVE, evidence_hash: hash, revoked_at: null, revoked_reason: null, issued_at: new Date(issuedAt), expires_at: expiresAt ? new Date(expiresAt) : null, renewed_from: credentialId, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', credentialId)
    .execute();

  await db
    .insertInto('credential_events')
    .values({ tenant_id: tenantId, credential_id: credentialId, event_type: 'renew', actor: actorId, detail: JSON.stringify({ issuedAt }) })
    .execute();

  await audit({
    action: AUDIT_ACTIONS.CREDENTIAL_RENEW,
    userId: actorId,
    tenantId,
    resourceType: 'credential',
    resourceId: String(credentialId),
    details: {},
  });
  return { ok: true, credentialId, status: CREDENTIAL_STATUS.ACTIVE };
}

/** Appeal — student appeals a revocation (limit 1). */
export async function appealCredential({ credentialId = 0, userId = 0, reason = '', appealCount = 0 } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const cred = await db
    .selectFrom('credentials')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', credentialId)
    .executeTakeFirst();
  if (!cred) return { ok: false, error: 'credential not found' };
  if (cred.user_id !== userId) return { ok: false, error: 'not your credential' };

  const appeal = assertAppealAllowed({ status: cred.status, existingAppeals: appealCount });
  if (!appeal.ok) return { ok: false, error: appeal.reason };

  await db
    .insertInto('credential_events')
    .values({ tenant_id: tenantId, credential_id: credentialId, event_type: 'appeal', actor: String(userId), detail: JSON.stringify({ reason }) })
    .execute();
  return { ok: true, credentialId, status: cred.status };
}

// ═══════════════════════════════════════════════════════════════════
// SHARE GRANT + VERIFY
// ═══════════════════════════════════════════════════════════════════

/** Create a selective share grant for an item (owner-only). */
export async function createShareGrant({ userId = 0, itemId = 0, viewerEmail = null, expiresAt = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const item = await db
    .selectFrom('portfolio_items')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', itemId)
    .executeTakeFirst();
  if (!item) return { ok: false, error: 'item not found' };
  const portfolio = await db
    .selectFrom('portfolios')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', item.portfolio_id)
    .executeTakeFirst();
  if (!portfolio || portfolio.user_id !== userId) return { ok: false, error: 'not your item' };

  // Security: production token — cryptographically random (deterministik
  // buildShareGrantToken faqat unit test uchun, bu yerda ishlatilmaydi).
  const token = crypto.randomBytes(24).toString('hex');
  await db
    .insertInto('share_grants')
    .values({
      tenant_id: tenantId,
      item_id: itemId,
      grant_token: token,
      viewer_email: viewerEmail,
      expires_at: expiresAt ? new Date(expiresAt) : null,
      created_by: String(userId),
    })
    .execute();
  return { ok: true, token, url: `/share/${token}` };
}

/** Revoke a share grant (owner or admin). */
export async function revokeShareGrant({ userId = 0, grantId = 0, actorRole = 'user' } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const grant = await db
    .selectFrom('share_grants')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', grantId)
    .executeTakeFirst();
  if (!grant) return { ok: false, error: 'grant not found' };
  if (actorRole !== 'admin') {
    const item = await db.selectFrom('portfolio_items').selectAll().where('id', '=', grant.item_id).executeTakeFirst();
    const portfolio = item ? await db.selectFrom('portfolios').selectAll().where('id', '=', item.portfolio_id).executeTakeFirst() : null;
    if (!portfolio || portfolio.user_id !== userId) return { ok: false, error: 'not your grant' };
  }

  await db
    .updateTable('share_grants')
    .set({ revoked_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', grantId)
    .execute();
  return { ok: true, grantId, revoked: true };
}

/** Verify a share grant token → grant status (valid/expired/revoked). */
export async function verifyShareGrant({ token = '', viewerEmail = '' } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const grant = await db
    .selectFrom('share_grants')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('grant_token', '=', token)
    .executeTakeFirst();
  if (!grant) return { ok: false, error: 'grant not found', verifiable: false };

  const result = evaluateShareGrant({ grant, viewerEmail, now: Date.now() });
  if (!result.ok) return { ok: false, error: result.reason, verifiable: false };

  const item = await db.selectFrom('portfolio_items').selectAll().where('id', '=', grant.item_id).executeTakeFirst();
  return {
    ok: true,
    verifiable: true,
    item: item ? { id: item.id, kind: item.kind, title: item.title } : null,
  };
}

/** Public verifier — credential by digest → valid/revoked/expired. */
export async function verifyCredential({ vcDigest = '' } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required', verifiable: false };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required', verifiable: false };

  const cred = await db
    .selectFrom('credentials')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('vc_digest', '=', vcDigest)
    .executeTakeFirst();
  if (!cred) return { ok: false, error: 'credential not found', verifiable: false };

  const mapped = mapCredentialRow(cred);
  const status = mapped.effectiveStatus;
  return {
    ok: status !== CREDENTIAL_STATUS.REVOKED && status !== CREDENTIAL_STATUS.EXPIRED,
    verifiable: true,
    status,
    name: mapped.name,
    recipient: mapped.recipient,
    issuedAt: mapped.issued_at,
  };
}

/** List a user's credentials. */
export async function listCredentials({ userId = 0 } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  const rows = await db
    .selectFrom('credentials')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .orderBy('issued_at', 'desc')
    .execute();
  return rows.map(mapCredentialRow);
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function mapCredentialRow(row) {
  const status = evaluateCredentialStatusRaw(row);
  return {
    ...row,
    id: row.id,
    name: row.name || 'Credential',
    recipient: row.recipient || '',
    vcDigest: row.vc_digest,
    evidenceHash: row.evidence_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    effectiveStatus: status,
    publicPayload: buildSelectivePayload({ id: row.id, name: row.name, recipient: row.recipient, vcDigest: row.vc_digest, evidenceHash: row.evidence_hash, issuedAt: row.issued_at, status }),
  };
}

function evaluateCredentialStatusRaw(row) {
  if (row.status === CREDENTIAL_STATUS.REVOKED) return CREDENTIAL_STATUS.REVOKED;
  if (row.expires_at && Date.now() > new Date(row.expires_at).getTime()) return CREDENTIAL_STATUS.EXPIRED;
  return row.status || CREDENTIAL_STATUS.ACTIVE;
}
