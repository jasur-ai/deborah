/**
 * Edikit — Data Classification, Privacy, Retention & Purge Routes
 *
 * Prompt 65 REST API:
 *   - GET    /admin/data-governance                           — admin UI
 *   - GET    /api/admin/data-governance/assets                — list assets
 *   - POST   /api/admin/data-governance/assets                — register asset
 *   - GET    /api/admin/data-governance/holds                 — list holds
 *   - POST   /api/admin/data-governance/holds                 — place hold
 *   - POST   /api/admin/data-governance/holds/:id/release     — release hold
 *   - GET    /api/admin/data-governance/dsar                  — list DSARs
 *   - POST   /api/admin/data-governance/dsar                  — create DSAR
 *   - POST   /api/admin/data-governance/dsar/:id/status       — DSAR FSM
 *   - POST   /api/admin/data-governance/purge                 — purge worker
 *   - GET    /api/admin/data-governance/receipts              — list receipts
 *   - GET    /api/admin/data-governance/summary               — summary
 *
 * Security (Prompt 65 §15-17): hamma route'lar requireAdmin; D4 UZ
 * tashqariga chiqmaydi; legal hold fail-open bo'lmaydi (purge hold
 * tekshiruvi o'tmaguncha bloklanadi); privileged actionlar audited.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  registerDataAsset,
  listDataAssets,
  placeLegalHold,
  releaseLegalHold,
  listLegalHolds,
  createDsarRequest,
  transitionDsar,
  listDsarRequests,
  runPurgeWorker,
  listDeletionReceipts,
  getDataGovernanceSummary,
} from '../src/modules/data-governance/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.username || req.session?.admin?.id || req.session?.user?.username || req.session?.user?.id || null;
}

/** GET /admin/data-governance — admin UI. */
router.get('/admin/data-governance', requireAdmin, (req, res) => {
  res.render('admin/data-governance', {
    title: 'Data Governance',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

// ── Assets ──────────────────────────────────────────────────────────

router.get('/api/admin/data-governance/assets', requireAdmin, async (req, res) => {
  try {
    const assets = await listDataAssets({ dataClass: req.query.dataClass || null, limit: req.query.limit });
    res.json({ ok: true, assets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/data-governance/assets', requireAdmin, async (req, res) => {
  try {
    const r = await registerDataAsset({
      assetName: req.body.assetName,
      assetType: req.body.assetType || 'table',
      storeName: req.body.storeName || 'postgres',
      dataClass: req.body.dataClass || null,
      region: req.body.region || 'UZ',
      kmsEnabled: req.body.kmsEnabled === true,
      retentionDays: Number(req.body.retentionDays) || 0,
      legalBasis: req.body.legalBasis || null,
      containsPii: req.body.containsPii === true,
      regulatory: req.body.regulatory === true,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Legal holds ─────────────────────────────────────────────────────

router.get('/api/admin/data-governance/holds', requireAdmin, async (req, res) => {
  try {
    const holds = await listLegalHolds({ status: req.query.status || null, limit: req.query.limit });
    res.json({ ok: true, holds });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/data-governance/holds', requireAdmin, async (req, res) => {
  try {
    const r = await placeLegalHold({
      subjectKey: req.body.subjectKey,
      reason: req.body.reason,
      source: req.body.source || 'court',
      startedBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/data-governance/holds/:id/release', requireAdmin, async (req, res) => {
  try {
    const r = await releaseLegalHold({ holdId: Number(req.params.id), releasedBy: actorId(req) });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DSAR ────────────────────────────────────────────────────────────

router.get('/api/admin/data-governance/dsar', requireAdmin, async (req, res) => {
  try {
    const dsars = await listDsarRequests({ status: req.query.status || null, limit: req.query.limit });
    res.json({ ok: true, dsars });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/data-governance/dsar', requireAdmin, async (req, res) => {
  try {
    const r = await createDsarRequest({
      subjectKey: req.body.subjectKey,
      requestType: req.body.requestType || 'access',
      requestedBy: actorId(req),
      notes: req.body.notes || '',
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/data-governance/dsar/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await transitionDsar({
      dsarId: Number(req.params.id),
      to: req.body.to || '',
      fulfilledBy: actorId(req),
      assetStores: Array.isArray(req.body.assetStores) ? req.body.assetStores : [],
      receipts: Array.isArray(req.body.receipts) ? req.body.receipts : [],
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Purge worker ────────────────────────────────────────────────────

router.post('/api/admin/data-governance/purge', requireAdmin, async (req, res) => {
  try {
    const r = await runPurgeWorker({
      assetId: Number(req.body.assetId) || 0,
      storeNames: Array.isArray(req.body.storeNames) ? req.body.storeNames : [],
      subjectKey: req.body.subjectKey || null,
      purgedBy: actorId(req),
      backupExpiryDays: Number(req.body.backupExpiryDays) || 30,
    });
    if (!r.ok) return res.status(r.blockedByLegalHold ? 409 : 400).json({ ok: false, error: r.error, blockedByLegalHold: r.blockedByLegalHold });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/data-governance/receipts', requireAdmin, async (req, res) => {
  try {
    const receipts = await listDeletionReceipts({ assetId: req.query.assetId ? Number(req.query.assetId) : null, status: req.query.status || null, limit: req.query.limit });
    res.json({ ok: true, receipts });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Summary ─────────────────────────────────────────────────────────

router.get('/api/admin/data-governance/summary', requireAdmin, async (req, res) => {
  try {
    const summary = await getDataGovernanceSummary();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
