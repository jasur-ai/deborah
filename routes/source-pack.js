/**
 * Deborah — Source Pack & Secure RAG Ingestion Routes
 *
 * Prompt 50 REST API (admin — requireAdmin):
 *   - GET  /api/admin/sources/meta                — constants for admin UI
 *   - POST /api/admin/source-packs                — create pack (draft)
 *   - GET  /api/admin/source-packs                — list packs
 *   - GET  /api/admin/source-packs/:id            — pack detail
 *   - POST /api/admin/source-packs/:id/transition — pack state (→approved)
 *   - POST /api/admin/sources/url                 — SSRF-checked URL source
 *   - POST /api/admin/sources/text                — inline text source
 *   - POST /api/admin/sources/upload              — safe file upload
 *   - GET  /api/admin/sources?packId=             — list sources
 *   - GET  /api/admin/sources/:id                 — source detail
 *   - POST /api/admin/sources/:id/extract         — extraction worker
 *   - GET  /api/admin/sources/:id/chunks          — chunks with provenance
 *   - POST /api/admin/sources/:id/approval        — teacher approve/reject
 *   - POST /api/admin/citations/verify            — citation claim check
 *   - GET  /admin/sources                         — admin page
 *
 * Security (Prompt 50 §15-17):
 *   - requireAdmin barcha write path'da; actor id session'dan.
 *   - URL SSRF-blocked; upload MIME/magic/size allowlist.
 *   - Cross-tenant vector retrieval deny — assertRetrievalScope.
 *   - Input validation getDb()'dan oldin (graceful degradation).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createSourcePack,
  listSourcePacks,
  getSourcePack,
  transitionSourcePack,
  createUrlSource,
  createTextSource,
  uploadSourceFile,
  listSources,
  getSource,
  extractSourceChunks,
  listSourceChunks,
  decideSourceApproval,
  assertRetrievalScope,
  verifyCitation,
  SOURCE_KINDS,
  PACK_STATUS,
  SOURCE_EXTRACTION_STATUS,
  SOURCE_APPROVAL_STATUS,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  SOURCE_UPLOAD_MAX_BYTES,
} from '../src/modules/source-pack/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/** GET /api/admin/sources/meta — constants for the admin UI. */
router.get('/api/admin/sources/meta', requireAdmin, (req, res) => {
  res.json({
    sourceKinds: SOURCE_KINDS,
    packStatus: PACK_STATUS,
    extractionStatus: SOURCE_EXTRACTION_STATUS,
    approvalStatus: SOURCE_APPROVAL_STATUS,
    embeddingModel: EMBEDDING_MODEL,
    embeddingVersion: EMBEDDING_VERSION,
    maxUploadBytes: SOURCE_UPLOAD_MAX_BYTES,
  });
});

// ═══════════════════════════════════════════════════════════════════
// SOURCE PACKS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/source-packs — create a pack. */
router.post('/api/admin/source-packs', requireAdmin, async (req, res) => {
  try {
    const r = await createSourcePack({ name: req.body?.name, description: req.body?.description, createdBy: actorId(req) });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/source-packs — list packs. */
router.get('/api/admin/source-packs', requireAdmin, async (req, res) => {
  try {
    const rows = await listSourcePacks({ status: req.query.status });
    res.json({ ok: true, packs: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/source-packs/:id — pack detail. */
router.get('/api/admin/source-packs/:id', requireAdmin, async (req, res) => {
  try {
    const pack = await getSourcePack(Number(req.params.id));
    if (!pack) return res.status(404).json({ ok: false, error: 'Source pack not found' });
    res.json({ ok: true, pack });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/source-packs/:id/transition — pack state change. */
router.post('/api/admin/source-packs/:id/transition', requireAdmin, async (req, res) => {
  try {
    const r = await transitionSourcePack({ packId: Number(req.params.id), to: req.body?.to, actorId: actorId(req) });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SOURCES
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/sources/url — SSRF-checked URL source. */
router.post('/api/admin/sources/url', requireAdmin, async (req, res) => {
  try {
    const r = await createUrlSource({ packId: req.body?.packId, title: req.body?.title, url: req.body?.url, createdBy: actorId(req) });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/sources/text — inline text source. */
router.post('/api/admin/sources/text', requireAdmin, async (req, res) => {
  try {
    const r = await createTextSource({ packId: req.body?.packId, title: req.body?.title, text: req.body?.text, createdBy: actorId(req) });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/sources/upload — safe file upload (base64 JSON body). */
router.post('/api/admin/sources/upload', requireAdmin, async (req, res) => {
  try {
    const buf = req.body?.fileBase64 ? Buffer.from(req.body.fileBase64, 'base64') : Buffer.alloc(0);
    const r = await uploadSourceFile({
      packId: req.body?.packId,
      title: req.body?.title,
      kind: req.body?.kind,
      fileName: req.body?.fileName,
      mimeType: req.body?.mimeType || '',
      buffer: buf,
      createdBy: actorId(req),
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/sources — list sources. */
router.get('/api/admin/sources', requireAdmin, async (req, res) => {
  try {
    const rows = await listSources({ packId: req.query.packId });
    res.json({ ok: true, sources: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/sources/:id — source detail. */
router.get('/api/admin/sources/:id', requireAdmin, async (req, res) => {
  try {
    const source = await getSource(Number(req.params.id));
    if (!source) return res.status(404).json({ ok: false, error: 'Source not found' });
    res.json({ ok: true, source });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/sources/:id/extract — extraction worker. */
router.post('/api/admin/sources/:id/extract', requireAdmin, async (req, res) => {
  try {
    const r = await extractSourceChunks({
      sourceId: Number(req.params.id),
      rawText: req.body?.rawText || '',
      pageIndex: req.body?.pageIndex || 0,
      actorId: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/sources/:id/chunks — chunks with provenance (onlyApproved=1 → approved corpus only). */
router.get('/api/admin/sources/:id/chunks', requireAdmin, async (req, res) => {
  try {
    const rows = await listSourceChunks({
      sourceId: Number(req.params.id),
      onlyApproved: req.query.onlyApproved === '1' || req.query.onlyApproved === 'true',
    });
    res.json({ ok: true, chunks: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/sources/:id/approval — teacher approve/reject. */
router.post('/api/admin/sources/:id/approval', requireAdmin, async (req, res) => {
  try {
    const r = await decideSourceApproval({
      sourceId: Number(req.params.id),
      decision: req.body?.decision,
      note: req.body?.note,
      decidedBy: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// CITATION & RETRIEVAL ACL
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/citations/verify — citation claim vs real chunk. */
router.post('/api/admin/citations/verify', requireAdmin, async (req, res) => {
  try {
    const r = await verifyCitation({ claim: req.body?.claim || {} });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/sources/retrieval-scope — tenant vector ACL check. */
router.post('/api/admin/sources/retrieval-scope', requireAdmin, async (req, res) => {
  try {
    const r = await assertRetrievalScope({ namespace: req.body?.namespace, requestTenantId: req.body?.requestTenantId });
    res.json(r);
  } catch (e) {
    res.status(403).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/sources — teacher source approval UI. */
router.get('/admin/sources', requireAdmin, (req, res) => {
  res.render('admin/sources', {
    title: 'Source Packs & RAG',
    user: req.session.admin,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
  });
});

export default router;
