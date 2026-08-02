/**
 * Edikit — Deck Export (service)
 *
 * Prompt 59 — canonical deckdan final PPTX/PDF/handout export:
 *   - exportDeck: validate → idempotency (request_hash) → build final →
 *     accessibility check → persist deck_exports + audit.
 *   - listDeckExports / getDeckExport: read.
 *
 * Final artifact storage: deck_exports row + storage_key (object storage).
 * Attribution va accessibility final export'da saqlanadi (§9.10, §28).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import storage from '../../infrastructure/storage.js';
import {
  validateExportRequest,
  buildExportHash,
  buildFinalPptx,
  buildFinalPdf,
  buildHandout,
  buildAttributionPage,
  runAccessibilityCheck,
  DECK_EXPORT_FORMATS,
} from './deck-export.schema.js';

// ═══════════════════════════════════════════════════════════════════
// EXPORT — §59-14
// ═══════════════════════════════════════════════════════════════════

/**
 * Export a canonical deck to PPTX/PDF/handout (final).
 * @param {Object} params - { presentationId, versionId, format, document, provider, humanReviewedAt, actorId }
 */
export async function exportDeck({
  presentationId = null,
  versionId = null,
  format = 'pptx',
  document = null,
  provider = null,
  model = null,
  jobId = null,
  humanReviewedAt = null,
  sourceLicenses = [],
  quizQuestions = [],
  actorId = null,
} = {}) {
  const v = validateExportRequest({ format, versionId, presentationId });
  if (!v.ok) return { ok: false, error: v.reason };
  if (!document || !Array.isArray(document.slides)) {
    return { ok: false, error: 'canonical document required (with slides)' };
  }

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const hash = buildExportHash({ presentationId, versionId, format });

  // Idempotency — existing export qaytariladi
  const existing = await db
    .selectFrom('deck_exports')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('request_hash', '=', hash)
    .executeTakeFirst();
  if (existing && existing.status === 'done') {
    return { ok: true, exportId: existing.id, cached: true, status: existing.status, storageKey: existing.storage_key };
  }

  // Build final structure per format
  const attribution = buildAttributionPage({ provider, model, jobId, humanReviewedAt, sourceLicenses });
  let built;
  if (format === 'pptx') built = buildFinalPptx({ document, attribution });
  else if (format === 'pdf') built = buildFinalPdf({ document, attribution });
  else built = buildHandout({ document, quizQuestions });
  if (!built.ok) return { ok: false, error: built.reason };

  // Accessibility check (final export uchun — §28)
  const a11y = runAccessibilityCheck({ document });

  // Persist row
  const row = await db
    .insertInto('deck_exports')
    .values({
      tenant_id: tenantId,
      presentation_id: presentationId,
      version_id: versionId,
      request_hash: hash,
      format,
      status: 'done',
      attribution: JSON.stringify(attribution),
      accessibility: JSON.stringify(a11y.ok ? a11y.summary : { error: a11y.reason }),
      storage_key: null, // object storage worker bu yerga yozadi (MVP: metadata)
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  // MVP: metadata-only artifact (PptxGenJS worker real fayl yozadi)
  const metaKey = `decks/${tenantId}/${presentationId}/${versionId}/${format}.json`;
  await storage.put(metaKey, Buffer.from(JSON.stringify({ ...built.final, attribution, accessibility: a11y.summary })), 'application/json').catch(() => {});

  await audit(AUDIT_ACTIONS.DECK_EXPORT, {
    actorId,
    tenantId,
    detail: { presentationId, versionId, format, slides: document.slides.length, a11y: a11y.ok ? a11y.summary : null },
  });
  return { ok: true, exportId: row.id, cached: false, status: 'done', format, slides: document.slides.length, a11y: a11y.ok ? a11y.summary : null };
}

// ═══════════════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════════════

/** List deck exports (tenant-scoped). */
export async function listDeckExports({ status = null, limit = 50 } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db.selectFrom('deck_exports').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('created_at', 'desc').limit(limit).execute();
}

/** Get a deck export (tenant-scoped). */
export async function getDeckExport(id) {
  const db = getDb();
  if (!db) return null;
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return null;
  return db
    .selectFrom('deck_exports')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst();
}

// Meta for UI
export const DECK_EXPORT_META = {
  formats: DECK_EXPORT_FORMATS,
  statuses: { queued: 'queued', done: 'done', failed: 'failed' },
};
