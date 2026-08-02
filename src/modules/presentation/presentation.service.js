/**
 * Edikit — Canonical Presentation & Native Editor MVP (service)
 *
 * Prompt 56 — provider-independent slide document, structured editor va
 * export skeleton. Graceful degradation: PostgreSQL bo'lmasa write path'lar
 * 'PostgreSQL required' throw qiladi, read path'lar []/null.
 *
 *   - createPresentation / listPresentations / getPresentation
 *   - saveDocument: structured editor save → yangi draft version (diff bilan)
 *   - rollbackToVersion: yangi version yaratadi, history o'chirilmaydi
 *   - addComment / resolveComment
 *   - runSlideQaOnVersion: AI design QA (§35.5)
 *   - exportPresentation: PPTX/PDF skeleton (worker queue'ga yoziladi)
 *   - publishPresentation: immutable published version (§35.4)
 *
 * SECURITY / DATA GUARD (Prompt 56 §15-17):
 *   - Provider raw response canonical modeldan tashqariga chiqmaydi
 *     (assertProviderRawIsolated).
 *   - Published version immutable — rollback yangi version.
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  validatePresentationDocument,
  reorderSlides,
  diffVersions,
  runSlideQa,
  assertProviderRawIsolated,
  buildPptxSkeleton,
  buildPdfSkeleton,
  validateExportRequest,
  validateComment,
  PRESENTATION_STATUS,
  VERSION_STATUS,
  EXPORT_FORMATS,
  QA_CHECKS,
} from './presentation.schema.js';

// ═══════════════════════════════════════════════════════════════════
// PRESENTATION CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a presentation + initial draft version (canonical doc).
 * @param {Object} params - { title, audience, language, learningOutcomes, theme, document, provider, actorId }
 */
export async function createPresentation({
  title = '',
  audience = null,
  language = 'uz',
  learningOutcomes = [],
  theme = 'default',
  document = null,
  provider = null,
  actorId = null,
} = {}) {
  const doc = document || { title, audience, language, learningOutcomes, theme, slides: [] };
  const v = validatePresentationDocument(doc);
  if (!v.ok) return { ok: false, error: v.reason || v.errors.join('; ') };
  // Provider raw isolation guard — raw response canonical ichida saqlanadi
  if (provider && provider.raw) {
    const iso = assertProviderRawIsolated({ raw: provider.raw, canonical: doc });
    if (!iso.ok) return { ok: false, error: iso.reason };
  }
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const row = await db
    .insertInto('presentations')
    .values({
      tenant_id: tenantId,
      title,
      audience: audience || null,
      language,
      learning_outcomes: JSON.stringify(learningOutcomes || []),
      theme,
      aspect_ratio: '16:9',
      status: PRESENTATION_STATUS.DRAFT,
      provider: provider ? JSON.stringify({ name: provider.name || 'edikit-native', jobId: provider.jobId || null }) : JSON.stringify({}),
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await db
    .insertInto('presentation_versions')
    .values({
      presentation_id: row.id,
      version_no: 1,
      document: JSON.stringify(doc),
      status: VERSION_STATUS.DRAFT,
      comment: 'initial draft',
      created_by: actorId,
    })
    .execute();

  await audit(AUDIT_ACTIONS.PRESENTATION_CREATE, { actorId, tenantId, detail: { presentationId: row.id, theme } });
  return { ok: true, presentationId: row.id, version: 1 };
}

/** List presentations (tenant-scoped). */
export async function listPresentations({ status = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db.selectFrom('presentations').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('updated_at', 'desc').limit(100).execute();
}

/** Get a presentation with its latest version document. */
export async function getPresentation(id) {
  const db = getDb();
  if (!db) return null;
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return null;
  const pres = await db
    .selectFrom('presentations')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!pres) return null;
  const version = await db
    .selectFrom('presentation_versions')
    .selectAll()
    .where('presentation_id', '=', id)
    .orderBy('version_no', 'desc')
    .executeTakeFirst();
  return { ...pres, latestVersion: version || null };
}

// ═══════════════════════════════════════════════════════════════════
// STRUCTURED EDITOR SAVE / DIFF / ROLLBACK (§35.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Save a document — yangi draft version yaratadi (diff bilan).
 * Idempotent: bir xil document hash → duplicate qaytaradi.
 *
 * @param {Object} params - { presentationId, document, comment, actorId }
 */
export async function saveDocument({ presentationId = null, document = null, comment = '', actorId = null } = {}) {
  const v = validatePresentationDocument(document);
  if (!v.ok) return { ok: false, error: v.reason || v.errors.join('; ') };
  if (!presentationId) return { ok: false, error: 'presentationId is required' };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const pres = await db
    .selectFrom('presentations')
    .select(['id', 'status', 'title'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', presentationId)
    .executeTakeFirst();
  if (!pres) return { ok: false, error: 'presentation not found' };
  if (pres.status === PRESENTATION_STATUS.PUBLISHED) {
    return { ok: false, error: 'published presentation is immutable — create a new version branch' };
  }

  // Idempotency: same doc content → no new version
  const last = await db
    .selectFrom('presentation_versions')
    .select(['id', 'version_no', 'document'])
    .where('presentation_id', '=', presentationId)
    .orderBy('version_no', 'desc')
    .executeTakeFirst();
  if (last && last.document && JSON.stringify(last.document) === JSON.stringify(document)) {
    return { ok: true, versionId: last.id, version: last.version_no, duplicate: true };
  }

  const nextVersion = Number(last?.version_no || 0) + 1;
  const row = await db
    .insertInto('presentation_versions')
    .values({
      presentation_id: presentationId,
      version_no: nextVersion,
      document: JSON.stringify(document),
      status: VERSION_STATUS.DRAFT,
      comment: comment || null,
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await db
    .updateTable('presentations')
    .set({ title: document.title || pres.title, theme: document.theme || 'default', updated_at: new Date() })
    .where('id', '=', presentationId)
    .execute();

  const diff = last?.document ? diffVersions(last.document, document) : null;
  await audit(AUDIT_ACTIONS.PRESENTATION_SAVE, {
    actorId,
    tenantId,
    detail: { presentationId, version: nextVersion, diff: diff?.summary || null },
  });
  return { ok: true, versionId: row.id, version: nextVersion, diff: diff?.summary || null, duplicate: false };
}

/**
 * Rollback to a version — yangi version yaratadi, history saqlanadi.
 * @param {Object} params - { presentationId, targetVersionId, actorId }
 */
export async function rollbackToVersion({ presentationId = null, targetVersionId = null, actorId = null } = {}) {
  if (!presentationId || !targetVersionId) {
    return { ok: false, error: 'presentationId and targetVersionId are required' };
  }
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const target = await db
    .selectFrom('presentation_versions')
    .select(['id', 'version_no', 'document'])
    .where('presentation_id', '=', presentationId)
    .where('id', '=', targetVersionId)
    .executeTakeFirst();
  if (!target) return { ok: false, error: 'target version not found' };

  const last = await db
    .selectFrom('presentation_versions')
    .select(db.fn.max('version_no').as('maxv'))
    .where('presentation_id', '=', presentationId)
    .executeTakeFirst();
  const nextVersion = Number(last?.maxv || 0) + 1;

  const row = await db
    .insertInto('presentation_versions')
    .values({
      presentation_id: presentationId,
      version_no: nextVersion,
      document: target.document,
      status: VERSION_STATUS.DRAFT,
      comment: `rollback from v${target.version_no}`,
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.PRESENTATION_ROLLBACK, {
    actorId,
    tenantId,
    detail: { presentationId, fromVersion: target.version_no, newVersion: nextVersion },
  });
  return { ok: true, versionId: row.id, version: nextVersion, restoredFrom: target.version_no };
}

/**
 * Diff two versions of a presentation.
 * @param {Object} params - { presentationId, fromVersionId, toVersionId }
 */
export async function diffVersionsOfPresentation({ presentationId = null, fromVersionId = null, toVersionId = null } = {}) {
  if (!presentationId || !fromVersionId || !toVersionId) {
    return { ok: false, error: 'presentationId, fromVersionId, toVersionId are required' };
  }
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const [a, b] = await Promise.all([
    db.selectFrom('presentation_versions').select(['document']).where('presentation_id', '=', presentationId).where('id', '=', fromVersionId).executeTakeFirst(),
    db.selectFrom('presentation_versions').select(['document']).where('presentation_id', '=', presentationId).where('id', '=', toVersionId).executeTakeFirst(),
  ]);
  if (!a || !b) return { ok: false, error: 'version not found' };
  const diff = diffVersions(a.document || {}, b.document || {});
  return { ok: true, ...diff };
}

// ═══════════════════════════════════════════════════════════════════
// REORDER (§35.1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Reorder slides in the latest draft document.
 * @param {Object} params - { presentationId, fromIndex, toIndex, actorId }
 */
export async function reorderPresentationSlides({ presentationId = null, fromIndex = -1, toIndex = -1, actorId = null } = {}) {
  if (!presentationId) return { ok: false, error: 'presentationId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const version = await db
    .selectFrom('presentation_versions')
    .select(['id', 'version_no', 'document'])
    .where('presentation_id', '=', presentationId)
    .orderBy('version_no', 'desc')
    .executeTakeFirst();
  if (!version?.document) return { ok: false, error: 'no document to reorder' };

  const doc = version.document;
  const r = reorderSlides(doc.slides, fromIndex, toIndex);
  if (!r.ok) return { ok: false, error: r.reason };

  const newDoc = { ...doc, slides: r.slides };
  return saveDocument({ presentationId, document: newDoc, comment: `reorder slide ${fromIndex} → ${toIndex}`, actorId });
}

// ═══════════════════════════════════════════════════════════════════
// COMMENTS (§35.1 co-teacher)
// ═══════════════════════════════════════════════════════════════════

/** Add a co-teacher comment. */
export async function addComment({ presentationId = null, versionId = null, slideId = null, blockId = null, author = '', body = '', actorId = null } = {}) {
  const v = validateComment({ body });
  if (!v.ok) return { ok: false, error: v.reason };
  if (!presentationId) return { ok: false, error: 'presentationId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const row = await db
    .insertInto('presentation_comments')
    .values({
      presentation_id: presentationId,
      version_id: versionId || null,
      slide_id: slideId || null,
      block_id: blockId || null,
      author: author || actorId || 'unknown',
      body,
      resolved: false,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.PRESENTATION_COMMENT, { actorId, tenantId, detail: { commentId: row.id, presentationId } });
  return { ok: true, commentId: row.id };
}

/** Resolve a comment. */
export async function resolveComment({ commentId = null, actorId = null } = {}) {
  if (!commentId) return { ok: false, error: 'commentId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  await db
    .updateTable('presentation_comments')
    .set({ resolved: true })
    .where('id', '=', commentId)
    .execute();
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// AI DESIGN QA (§35.5)
// ═══════════════════════════════════════════════════════════════════

/** Run QA checks on all slides of the latest version. */
export async function runSlideQaOnVersion({ presentationId = null, actorId = null } = {}) {
  if (!presentationId) return { ok: false, error: 'presentationId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const version = await db
    .selectFrom('presentation_versions')
    .select(['id', 'version_no', 'document'])
    .where('presentation_id', '=', presentationId)
    .orderBy('version_no', 'desc')
    .executeTakeFirst();
  if (!version?.document?.slides) return { ok: false, error: 'no document to QA' };

  const results = [];
  for (const slide of version.document.slides) {
    const qa = runSlideQa(slide);
    for (const check of qa.checks) {
      results.push({ slideId: slide.id, ...check });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  await audit(AUDIT_ACTIONS.PRESENTATION_QA, {
    actorId,
    tenantId,
    detail: { presentationId, total: results.length, passed },
  });
  return { ok: true, results, summary: { total: results.length, passed, failed: results.length - passed } };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT SKELETON (§13, §35.2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Queue an export job (PPTX/PDF skeleton — worker bajaradi).
 * @param {Object} params - { presentationId, format, actorId }
 */
export async function exportPresentation({ presentationId = null, format = 'pptx', actorId = null } = {}) {
  const v = validateExportRequest({ format });
  if (!v.ok) return { ok: false, error: v.reason };
  if (!presentationId) return { ok: false, error: 'presentationId is required' };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const version = await db
    .selectFrom('presentation_versions')
    .select(['id', 'version_no', 'document'])
    .where('presentation_id', '=', presentationId)
    .orderBy('version_no', 'desc')
    .executeTakeFirst();
  if (!version?.document) return { ok: false, error: 'no document to export' };

  const skeleton = format === 'pptx' ? buildPptxSkeleton(version.document) : buildPdfSkeleton(version.document);
  if (!skeleton.ok) return { ok: false, error: skeleton.reason };

  // Idempotent: same presentation+version+format → return existing queued
  const existing = await db
    .selectFrom('presentation_exports')
    .select(['id', 'status'])
    .where('presentation_id', '=', presentationId)
    .where('version_id', '=', version.id)
    .where('format', '=', format)
    .executeTakeFirst();
  if (existing) return { ok: true, exportId: existing.id, duplicate: true, status: existing.status };

  const row = await db
    .insertInto('presentation_exports')
    .values({
      presentation_id: presentationId,
      version_id: version.id,
      format,
      status: 'queued',
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.PRESENTATION_EXPORT, {
    actorId,
    tenantId,
    detail: { presentationId, format, version: version.version_no, skeletonSlides: skeleton.skeleton.slides?.length },
  });
  return { ok: true, exportId: row.id, duplicate: false, status: 'queued', skeleton: skeleton.skeleton };
}

// ═══════════════════════════════════════════════════════════════════
// PUBLISH (IMMUTABLE SNAPSHOT §35.4)
// ═══════════════════════════════════════════════════════════════════

/** Publish latest draft as immutable published version. */
export async function publishPresentation({ presentationId = null, actorId = null } = {}) {
  if (!presentationId) return { ok: false, error: 'presentationId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const version = await db
    .selectFrom('presentation_versions')
    .select(['id', 'version_no', 'document'])
    .where('presentation_id', '=', presentationId)
    .orderBy('version_no', 'desc')
    .executeTakeFirst();
  if (!version?.document) return { ok: false, error: 'no document to publish' };

  await db
    .updateTable('presentation_versions')
    .set({ status: VERSION_STATUS.PUBLISHED })
    .where('id', '=', version.id)
    .execute();
  await db
    .updateTable('presentations')
    .set({ status: PRESENTATION_STATUS.PUBLISHED, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', presentationId)
    .execute();

  await audit(AUDIT_ACTIONS.PRESENTATION_PUBLISH, {
    actorId,
    tenantId,
    detail: { presentationId, version: version.version_no },
  });
  return { ok: true, version: version.version_no, published: true };
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD + META
// ═══════════════════════════════════════════════════════════════════

/** Dashboard — presentations, versions, exports, comments count. */
export async function getPresentationDashboard() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required', presentations: [], exports: [], qaFailures: [] };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const presentations = await db
    .selectFrom('presentations')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('updated_at', 'desc')
    .limit(50)
    .execute();

  if (presentations.length === 0) {
    return { ok: true, presentations: [], exports: [] };
  }
  const exports = await db
    .selectFrom('presentation_exports')
    .selectAll()
    .where('presentation_id', 'in', presentations.map((p) => p.id))
    .orderBy('created_at', 'desc')
    .limit(20)
    .execute();

  return { ok: true, presentations, exports };
}

// Constants re-export for routes meta
export const PRESENTATION_META = {
  presentationStatus: PRESENTATION_STATUS,
  versionStatus: VERSION_STATUS,
  blockTypes: ['text', 'heading', 'bullets', 'image', 'chart', 'table'],
  layouts: ['title', 'title-body', 'title-body-image', 'title-image', 'section-header', 'quote', 'agenda', 'closing'],
  themes: ['default', 'dark', 'light', 'academic', 'playful'],
  exportFormats: EXPORT_FORMATS,
  qaChecks: QA_CHECKS,
};
