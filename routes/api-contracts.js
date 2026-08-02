/**
 * Edikit — API, Socket, Job, Webhook & Outbox Contract Audit Routes
 *
 * Prompt 67 REST API:
 *   - GET    /admin/api-contracts                            — admin UI
 *   - POST   /api/admin/api-contracts/routes                 — register route
 *   - GET    /api/admin/api-contracts/routes                 — route inventory
 *   - GET    /api/admin/api-contracts/routes/undocumented    — undocumented privileged
 *   - POST   /api/admin/api-contracts/contracts              — save contract (zod→OpenAPI)
 *   - POST   /api/admin/api-contracts/contracts/:id/status   — publish/deprecate
 *   - GET    /api/admin/api-contracts/contracts              — list contracts
 *   - GET    /api/admin/api-contracts/openapi                — OpenAPI 3.1 document
 *   - POST   /api/admin/api-contracts/socket-events          — register socket event
 *   - GET    /api/admin/api-contracts/socket-events          — list socket events
 *   - POST   /api/admin/api-contracts/webhooks               — record webhook (sig/replay/dedup)
 *   - GET    /api/admin/api-contracts/webhooks               — list webhook events
 *   - POST   /api/admin/api-contracts/outbox                 — enqueue outbox
 *   - POST   /api/admin/api-contracts/outbox/:id/process     — process (idempotent)
 *   - GET    /api/admin/api-contracts/outbox                 — list outbox
 *   - GET    /api/admin/api-contracts/summary                — dashboard summary
 *
 * Security (Prompt 67 §15-17): hamma route'lar requireAdmin; undocumented
 * privileged endpoint qolmaydi (stop condition §24); sensitive case generic
 * schema'ga qo'shilmaydi (§15); webhook raw-signature + replay + dedup;
 * outbox consumer idempotency; audited.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { z } from 'zod';
import {
  registerRoute,
  listRoutes,
  listUndocumentedPrivilegedRoutes,
  saveContract,
  setContractStatus,
  listContracts,
  getOpenApiDocument,
  registerSocketEvent,
  listSocketEvents,
  recordWebhook,
  listWebhookEvents,
  enqueueOutbox,
  processOutboxMessage,
  listOutbox,
  getContractSummary,
} from '../src/modules/api-contracts/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.username || req.session?.admin?.id || req.session?.user?.username || req.session?.user?.id || null;
}

/** GET /admin/api-contracts — admin UI. */
router.get('/admin/api-contracts', requireAdmin, (req, res) => {
  res.render('admin/api-contracts', {
    title: 'API Contracts',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

// ── Route inventory ────────────────────────────────────────────────

router.get('/api/admin/api-contracts/routes', requireAdmin, async (req, res) => {
  try {
    const routes = await listRoutes({
      authLevel: req.query.authLevel || null,
      documented: req.query.documented !== undefined ? req.query.documented === 'true' : null,
      module: req.query.module || null,
      limit: req.query.limit,
    });
    res.json({ ok: true, routes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/api-contracts/routes/undocumented', requireAdmin, async (req, res) => {
  try {
    const routes = await listUndocumentedPrivilegedRoutes();
    res.json({ ok: true, routes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/api-contracts/routes', requireAdmin, async (req, res) => {
  try {
    const r = await registerRoute({
      method: req.body.method,
      path: req.body.path,
      version: req.body.version || 'v1',
      authLevel: req.body.authLevel || 'public',
      module: req.body.module || '',
      idempotent: req.body.idempotent === true,
      etagSupport: req.body.etagSupport === true,
      cursorPagination: req.body.cursorPagination === true,
      documented: req.body.documented === true,
      contractName: req.body.contractName || null,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Contracts ──────────────────────────────────────────────────────

router.get('/api/admin/api-contracts/contracts', requireAdmin, async (req, res) => {
  try {
    const contracts = await listContracts({ kind: req.query.kind || null, status: req.query.status || null, limit: req.query.limit });
    res.json({ ok: true, contracts });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/api-contracts/contracts', requireAdmin, async (req, res) => {
  try {
    // Build zod schema from JSON spec definition (simple field types).
    const def = req.body.schema || {};
    const zodSchema = buildZodFromDef(def);
    const r = await saveContract({
      contractName: req.body.contractName,
      kind: req.body.kind || 'request',
      zodSchema,
      version: req.body.version || 'v1',
      scope: req.body.scope || 'user',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/api-contracts/contracts/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await setContractStatus({ contractId: Number(req.params.id), status: req.body.status || 'published', changedBy: actorId(req) });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/api-contracts/openapi', requireAdmin, async (req, res) => {
  try {
    const r = await getOpenApiDocument();
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r.doc);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Socket events ──────────────────────────────────────────────────

router.get('/api/admin/api-contracts/socket-events', requireAdmin, async (req, res) => {
  try {
    const events = await listSocketEvents({ limit: req.query.limit });
    res.json({ ok: true, events });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/api-contracts/socket-events', requireAdmin, async (req, res) => {
  try {
    const r = await registerSocketEvent({
      eventName: req.body.eventName,
      version: req.body.version || 'v1',
      auth: req.body.auth || 'public',
      rateLimitGroup: req.body.rateLimitGroup || 'default',
      zodSchema: buildZodFromDef(req.body.schema || {}),
      documented: req.body.documented === true,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Webhooks ───────────────────────────────────────────────────────

router.get('/api/admin/api-contracts/webhooks', requireAdmin, async (req, res) => {
  try {
    const webhooks = await listWebhookEvents({ provider: req.query.provider || null, status: req.query.status || null, limit: req.query.limit });
    res.json({ ok: true, webhooks });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/api-contracts/webhooks', requireAdmin, async (req, res) => {
  try {
    const r = await recordWebhook({
      provider: req.body.provider,
      eventId: req.body.eventId,
      eventType: req.body.eventType,
      version: req.body.version || 'v1',
      secret: req.body.secret || '',
      rawBody: req.body.rawBody || '',
      signature: req.body.signature || '',
      eventTime: Number(req.body.eventTime) || 0,
      seq: req.body.seq !== undefined ? Number(req.body.seq) : null,
      lastSeenSeq: Number(req.body.lastSeenSeq) || 0,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(r.duplicate ? 409 : r.signatureFailed || r.replayFailed ? 401 : 400).json({ ok: false, error: r.error, duplicate: r.duplicate, signatureFailed: r.signatureFailed, replayFailed: r.replayFailed });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Outbox ─────────────────────────────────────────────────────────

router.get('/api/admin/api-contracts/outbox', requireAdmin, async (req, res) => {
  try {
    const messages = await listOutbox({ status: req.query.status || null, limit: req.query.limit });
    res.json({ ok: true, messages });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/api-contracts/outbox', requireAdmin, async (req, res) => {
  try {
    const r = await enqueueOutbox({
      outboxType: req.body.outboxType,
      payload: req.body.payload,
      version: req.body.version || 'v1',
      jobType: req.body.jobType || null,
      traceRequired: req.body.traceRequired === true,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/api-contracts/outbox/:id/process', requireAdmin, async (req, res) => {
  try {
    const r = await processOutboxMessage({
      messageId: Number(req.params.id),
      deliver: req.body.deliver !== false ? async () => ({ ok: true }) : async () => ({ ok: false, error: 'simulated failure' }),
      processedBy: actorId(req),
    });
    if (!r.ok) return res.status(r.deadLettered ? 422 : 400).json({ ok: false, error: r.error, deadLettered: r.deadLettered });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Summary ────────────────────────────────────────────────────────

router.get('/api/admin/api-contracts/summary', requireAdmin, async (req, res) => {
  try {
    const summary = await getContractSummary();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Helper: build a zod schema from a simple JSON field definition ──

function buildZodFromDef(def) {
  const fields = {};
  for (const [name, type] of Object.entries(def || {})) {
    let field;
    if (type === 'string') field = z.string();
    else if (type === 'number') field = z.number();
    else if (type === 'boolean') field = z.boolean();
    else if (type === 'array') field = z.array(z.string());
    else if (Array.isArray(type)) field = z.enum(type);
    else field = z.any();
    fields[name] = field;
  }
  return z.object(fields);
}

export default router;
