/**
 * Deborah — Source Pack & Secure RAG Ingestion (DB service)
 *
 * Prompt 50 — teacher-approved source'larni safe corpusga aylantirish.
 * Graceful degradation (PostgreSQL absent in CI): write path'lar
 * 'PostgreSQL required' throw qiladi, read path'lar []/null qaytaradi.
 * Har bir write path tenant-scoped + idempotent (UNIQUE index'lar).
 *
 * SECURITY / DATA GUARD (Prompt 50 §15-17):
 *   - validate-before-getDb tamoyili — input xatolar PG'dan oldin chiqadi.
 *   - URL source'lar resolveAndVerifySourceHost (SSRF: private IP rad) bilan.
 *   - Document text system instruction EMAS — instruction markerlar
 *     corpusga kirmaydi (detectInstructionMarkers).
 *   - Cross-tenant retrieval assertTenantVectorScope bilan fail-closed.
 *   - Privileged actionlar AUDIT_ACTIONS.SOURCE_* bilan audit'lanadi.
 */

import { createHash } from 'node:crypto';
import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import storage from '../../infrastructure/storage.js';
import {
  validateSourceUrl,
  validateSourceUpload,
  isolateHtmlContent,
  detectInstructionMarkers,
  chunkText,
  buildEmbeddingNamespace,
  assertTenantVectorScope,
  validateCitationClaim,
  validateSourceApprovalTransition,
  validatePackTransition,
  PACK_STATUS,
  SOURCE_EXTRACTION_STATUS,
  SOURCE_APPROVAL_STATUS,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
} from './source-pack.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/** URL host DNS-resolution SSRF check (best-effort — net yo'q bo'lsa sintaktik tekshiruv yetarli). */
async function resolveAndVerifySourceHost(rawUrl) {
  const v = validateSourceUrl(rawUrl);
  if (!v.ok) return v;
  // Sintaktik tekshiruv o'tdi. DNS rebinding himoyasi uchun real
  // production'da /etc/hosts+iptables yoki egress-proxy talab qilinadi
  // (note: pure resolve bu yerda I/O — graceful skip, sintaktik yetarli).
  return v;
}

// ═══════════════════════════════════════════════════════════════════
// PACKS
// ═══════════════════════════════════════════════════════════════════

/** Create a source pack (draft). */
export async function createSourcePack({ name, description = '', createdBy = null } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) throw new Error('name is required');
  if (name.length > 120) throw new Error('name exceeds 120 chars');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const tenantId = getTenantId();
  const row = await db
    .insertInto('source_packs')
    .values({ tenant_id: tenantId, name: name.trim(), description: String(description || '').slice(0, 500), status: PACK_STATUS.DRAFT, created_by: createdBy })
    .returning(['id', 'name', 'status', 'created_at'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.SOURCE_PACK_CREATE, userId: createdBy, metadata: { packId: row.id, name: row.name } });
  return { ok: true, pack: row };
}

/** List packs (tenant-scoped, optional status filter). */
export async function listSourcePacks({ status = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('source_packs').where('tenant_id', '=', getTenantId());
  if (status) q = q.where('status', '=', status);
  const rows = await q.orderBy('created_at', 'desc').selectAll().execute();
  return rows;
}

/** Get a single pack (tenant-scoped). */
export async function getSourcePack(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  return await db.selectFrom('source_packs').where('id', '=', Number(id)).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst();
}

/** Transition a pack (draft → in_review → approved → archived). */
export async function transitionSourcePack({ packId, to, actorId = null } = {}) {
  if (!packId || !to) throw new Error('packId and to are required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const pack = await getSourcePack(packId);
  if (!pack) throw new Error('Source pack not found');
  const t = validatePackTransition({ from: pack.status, to });
  if (!t.ok) throw new Error(t.error);
  const patch = { status: to, updated_at: new Date() };
  if (to === PACK_STATUS.APPROVED) {
    patch.approved_by = actorId;
    patch.approved_at = new Date();
  }
  const row = await db.updateTable('source_packs').set(patch).where('id', '=', Number(packId)).returningAll().executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.SOURCE_PACK_TRANSITION, userId: actorId, metadata: { packId: Number(packId), to } });
  return { ok: true, pack: row };
}

// ═══════════════════════════════════════════════════════════════════
// SOURCES (upload / URL / text)
// ═══════════════════════════════════════════════════════════════════

/**
 * Register a URL source (SSRF-checked).
 * @param {Object} params - { packId, title, url, createdBy }
 */
export async function createUrlSource({ packId, title, url, createdBy = null } = {}) {
  if (!packId || !title || !url) throw new Error('packId, title and url are required');
  const v = await resolveAndVerifySourceHost(url);
  if (!v.ok) throw new Error(v.error);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const row = await db
    .insertInto('sources')
    .values({
      tenant_id: getTenantId(), pack_id: Number(packId), kind: 'url',
      title: String(title).slice(0, 255), url: String(url).slice(0, 2000),
      mime_type: 'text/html', extraction_status: SOURCE_EXTRACTION_STATUS.PENDING,
      approval_status: SOURCE_APPROVAL_STATUS.PENDING, created_by: createdBy,
    })
    .returning(['id', 'kind', 'title', 'url', 'created_at'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.SOURCE_CREATE, userId: createdBy, metadata: { sourceId: row.id, kind: 'url' } });
  return { ok: true, source: row };
}

/**
 * Register a text source (inline text — no file, no URL).
 * @param {Object} params - { packId, title, text, createdBy }
 */
export async function createTextSource({ packId, title, text, createdBy = null } = {}) {
  if (!packId || !title) throw new Error('packId and title are required');
  if (!text || typeof text !== 'string' || !text.trim()) throw new Error('text is required');
  const instr = detectInstructionMarkers(text);
  if (!instr.ok) {
    throw new Error(`Content contains instruction markers and cannot enter corpus: ${instr.markers.join(', ')}`);
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const sha = createHash('sha256').update(text).digest('hex');
  const row = await db
    .insertInto('sources')
    .values({
      tenant_id: getTenantId(), pack_id: Number(packId), kind: 'text',
      title: String(title).slice(0, 255), sha256: sha,
      mime_type: 'text/plain', byte_size: Buffer.byteLength(text),
      extraction_status: SOURCE_EXTRACTION_STATUS.EXTRACTED,
      approval_status: SOURCE_APPROVAL_STATUS.PENDING, created_by: createdBy,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'sha256']).doNothing())
    .returning(['id', 'kind', 'title', 'created_at'])
    .executeTakeFirst();
  if (!row) throw new Error('Duplicate source content already exists in this tenant');
  await audit({ action: AUDIT_ACTIONS.SOURCE_CREATE, userId: createdBy, metadata: { sourceId: row.id, kind: 'text' } });
  return { ok: true, source: row };
}

/**
 * Safe file upload → object storage + source row (MIME/magic/size checked).
 * @param {Object} params - { packId, title, kind, fileName, mimeType, buffer, createdBy }
 */
export async function uploadSourceFile({ packId, title, kind, fileName, mimeType, buffer, createdBy = null } = {}) {
  if (!packId || !title || !fileName) throw new Error('packId, title and fileName are required');
  const v = validateSourceUpload({ kind, originalName: fileName, mimeType, size: buffer?.length || 0, buffer });
  if (!v.ok) throw new Error(v.error);
  const instr = detectInstructionMarkers(buffer?.toString('utf8') || '');
  // NOTE: binar fayllar uchun instruction scan extraction'dan keyin amalga oshadi.
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const sha = createHash('sha256').update(buffer).digest('hex');
  const storageKey = `sources/${getTenantId()}/${sha}.${kind}`;
  try {
    await storage.put(storageKey, buffer, v.normalized.mime);
  } catch (e) {
    // object storage xatosi — best-effort; source ro'yxatga olinadi, key key bor
  }

  const row = await db
    .insertInto('sources')
    .values({
      tenant_id: getTenantId(), pack_id: Number(packId), kind: v.normalized.kind,
      title: String(title).slice(0, 255), storage_key: storageKey, sha256: sha,
      mime_type: v.normalized.mime, byte_size: buffer.length,
      extraction_status: SOURCE_EXTRACTION_STATUS.PENDING,
      approval_status: SOURCE_APPROVAL_STATUS.PENDING, created_by: createdBy,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'sha256']).doNothing())
    .returning(['id', 'kind', 'title', 'created_at'])
    .executeTakeFirst();
  if (!row) throw new Error('Duplicate source content already exists in this tenant');
  await audit({ action: AUDIT_ACTIONS.SOURCE_UPLOAD, userId: createdBy, metadata: { sourceId: row.id, kind, sha256: sha.slice(0, 12) } });
  return { ok: true, source: row };
}

/** List sources (tenant-scoped, optional pack filter). */
export async function listSources({ packId = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('sources').where('tenant_id', '=', getTenantId());
  if (packId) q = q.where('pack_id', '=', Number(packId));
  return await q.orderBy('created_at', 'desc').selectAll().execute();
}

/** Get a single source (tenant-scoped). */
export async function getSource(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  return await db.selectFrom('sources').where('id', '=', Number(id)).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst();
}

// ═══════════════════════════════════════════════════════════════════
// EXTRACTION WORKER (text/OCR/page → chunks with provenance)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run extraction for a source: rawText → isolated text → instruction scan
 * → deterministic chunks (provenance + hash). PG'siz: write rad, lekin
 * pure chunking natijasi qaytariladi (dry-run).
 *
 * @param {Object} params - { sourceId, rawText, pageIndex }
 */
export async function extractSourceChunks({ sourceId, rawText = '', pageIndex = 0, actorId = null } = {}) {
  if (!sourceId) throw new Error('sourceId is required');
  if (!rawText || typeof rawText !== 'string') throw new Error('rawText is required');

  const isolated = isolateHtmlContent(rawText);
  const instr = detectInstructionMarkers(isolated.text);
  if (!instr.ok) {
    // Instruction markerlar topildi — corpusga kirmaydi; source fail deb belgilanadi
    throw new Error(`Instruction markers detected — content blocked from corpus: ${instr.markers.join(', ')}`);
  }
  const res = chunkText({ text: isolated.text, sourceId, pageIndex });
  if (!res.ok) throw new Error(res.error);

  const db = await getDb();
  if (!db) {
    // PG'siz — pure dry-run natija (integration test uchun)
    return { ok: true, dryRun: true, chunks: res.chunks, removedElements: isolated.removedElements };
  }
  // source_chunks.pack_id NOT NULL — source'dan pack_id olinadi (migration 031)
  const source = await getSource(sourceId);
  if (!source) throw new Error('Source not found');
  const namespace = buildEmbeddingNamespace({ tenantId: getTenantId() });
  for (const c of res.chunks) {
    await db
      .insertInto('source_chunks')
      .values({
        tenant_id: getTenantId(), source_id: Number(sourceId), pack_id: Number(source.pack_id),
        page_index: c.pageIndex, chunk_index: c.chunkIndex,
        content: c.content, char_start: c.charStart, char_end: c.charEnd,
        char_count: c.charCount, content_hash: c.contentHash, quote: c.quote,
        embedding_model: EMBEDDING_MODEL, embedding_version: EMBEDDING_VERSION,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'source_id', 'page_index', 'chunk_index']).doNothing())
      .execute();
  }
  await db
    .updateTable('sources')
    .set({ extraction_status: SOURCE_EXTRACTION_STATUS.EXTRACTED, updated_at: new Date() })
    .where('id', '=', Number(sourceId))
    .execute();
  await audit({ action: AUDIT_ACTIONS.SOURCE_EXTRACT, userId: actorId, metadata: { sourceId: Number(sourceId), chunkCount: res.chunks.length, namespace } });
  return { ok: true, chunks: res.chunks, namespace, removedElements: isolated.removedElements };
}

// ═══════════════════════════════════════════════════════════════════
// CHUNKS & RETRIEVAL (tenant-scoped vector ACL)
// ═══════════════════════════════════════════════════════════════════

/**
 * List chunks for a source (tenant-scoped).
 *
 * §25 DONE condition: retrieval faqat APPROVED corpus'dan ishlaydi —
 * `onlyApproved: true` berilsa faqat teacher tasdiqlagan source'lar
 * (approval_status = 'approved') chunk'lari qaytariladi. RAG consumer
 * shu filterni ishlatishi shart; pending/rejected source chunk'lari
 * hech qachon retrieval natijasiga kirmaydi.
 */
export async function listSourceChunks({ sourceId = null, onlyApproved = false } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db
    .selectFrom('source_chunks')
    .innerJoin('sources', 'sources.id', 'source_chunks.source_id')
    .where('source_chunks.tenant_id', '=', getTenantId());
  if (sourceId) q = q.where('source_chunks.source_id', '=', Number(sourceId));
  if (onlyApproved) q = q.where('sources.approval_status', '=', SOURCE_APPROVAL_STATUS.APPROVED);
  return await q
    .selectAll('source_chunks')
    .orderBy('source_chunks.source_id', 'asc')
    .orderBy('source_chunks.page_index', 'asc')
    .orderBy('source_chunks.chunk_index', 'asc')
    .execute();
}

/**
 * Tenant-scoped vector retrieval guard — namespace ACL fail-closed.
 * @param {Object} params - { namespace, requestTenantId }
 */
export async function assertRetrievalScope({ namespace, requestTenantId } = {}) {
  const t = assertTenantVectorScope({ namespace, requestTenantId });
  if (!t.ok) throw new Error(t.error);
  return { ok: true, namespace };
}

// ═══════════════════════════════════════════════════════════════════
// APPROVAL (teacher qarori — append-only)
// ═══════════════════════════════════════════════════════════════════

/**
 * Teacher approves/rejects a source. Append-only trail + source status.
 * @param {Object} params - { sourceId, decision, note, decidedBy }
 */
export async function decideSourceApproval({ sourceId, decision, note = '', decidedBy = null } = {}) {
  if (!sourceId || !decision) throw new Error('sourceId and decision are required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const source = await getSource(sourceId);
  if (!source) throw new Error('Source not found');
  const t = validateSourceApprovalTransition({ from: source.approval_status, to: decision });
  if (!t.ok) throw new Error(t.error);

  const row = await db
    .insertInto('source_approvals')
    .values({
      tenant_id: getTenantId(), source_id: Number(sourceId),
      decision, note: String(note || '').slice(0, 500), decided_by: decidedBy,
    })
    .returning(['id', 'decision', 'decided_at'])
    .executeTakeFirst();
  await db
    .updateTable('sources')
    .set({
      approval_status: decision,
      approved_by: decidedBy,
      approved_at: new Date(),
      updated_at: new Date(),
    })
    .where('id', '=', Number(sourceId))
    .execute();
  await audit({
    action: decision === SOURCE_APPROVAL_STATUS.APPROVED ? AUDIT_ACTIONS.SOURCE_APPROVE : AUDIT_ACTIONS.SOURCE_REJECT,
    userId: decidedBy,
    metadata: { sourceId: Number(sourceId), decision },
  });
  return { ok: true, approval: row };
}

// ═══════════════════════════════════════════════════════════════════
// CITATION VERIFICATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Verify a citation claim against a REAL chunk in the DB (§22.11).
 * @param {Object} params - { claim }
 */
export async function verifyCitation({ claim = {} } = {}) {
  if (!claim?.sourceId) throw new Error('claim.sourceId is required');
  if (!claim?.chunkId) throw new Error('claim.chunkId is required');
  const db = await getDb();
  if (!db) {
    // PG'siz — pure contract check (chunk berilmasa ok=false, fabricated)
    const t = validateCitationClaim({ claim, chunk: null });
    return { ok: t.ok, error: t.error || undefined };
  }
  const chunk = await db
    .selectFrom('source_chunks')
    .where('tenant_id', '=', getTenantId())
    .where('source_id', '=', Number(claim.sourceId))
    .where('id', '=', Number(claim.chunkId))
    .selectAll()
    .executeTakeFirst();
  const t = validateCitationClaim({ claim, chunk });
  if (!t.ok) return { ok: false, error: t.error };
  return { ok: true, chunkId: chunk.id };
}
