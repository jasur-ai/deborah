/**
 * Edikit — Portfolio & Verifiable Credential Routes
 *
 * Prompt 61 REST API:
 *   - GET    /user/portfolio                — default-private portfolio UI
 *   - GET    /api/user/portfolio            — my portfolio items
 *   - POST   /api/user/portfolio/items      — add evidence item
 *   - PATCH  /api/user/portfolio/items/:id  — set visibility
 *   - GET    /api/user/credentials          — my credentials
 *   - POST   /api/user/credentials/:id/appeal — appeal revocation
 *   - POST   /api/user/items/:id/share      — create share grant
 *   - POST   /api/user/share-grants/:id/revoke — revoke grant
 *   - GET    /share/:token                  — verifier view for grant
 *   - GET    /verify/:digest                — public credential verifier
 *   - GET    /admin/credentials             — admin UI
 *   - GET    /api/admin/credential-definitions — list definitions
 *   - POST   /api/admin/credential-definitions — create definition
 *   - POST   /api/admin/credential-definitions/:id/publish — publish
 *   - POST   /api/admin/credentials/issue   — issue (guarded, idempotent)
 *   - POST   /api/admin/credentials/:id/revoke — revoke
 *   - POST   /api/admin/credentials/:id/renew — renew
 *
 * Security (Prompt 61 §15): student routes requireAuth + owner checks;
 * admin routes requireAdmin; LLM never issues; raw sensitive submission
 * never in public payload; privileged actions audited.
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  ensurePortfolio,
  addPortfolioItem,
  setItemVisibility,
  listPortfolio,
  getPublicPortfolio,
  createCredentialDefinition,
  publishCredentialDefinition,
  listCredentialDefinitions,
  issueCredential,
  revokeCredential,
  renewCredential,
  appealCredential,
  createShareGrant,
  revokeShareGrant,
  verifyShareGrant,
  verifyCredential,
  listCredentials,
} from '../src/modules/credential/index.js';
import { ITEM_VISIBILITY } from '../src/modules/credential/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.username || req.session?.admin?.id || req.session?.user?.username || req.session?.user?.id || null;
}

// ─────────────────────────────────────────────────────────────────────
// STUDENT — portfolio UI + API
// ─────────────────────────────────────────────────────────────────────

/** GET /user/portfolio — default-private portfolio page. */
router.get('/user/portfolio', requireAuth, async (req, res) => {
  const user = req.session.user;
  const userId = user.id || 0;
  const { portfolio, items } = await listPortfolio({ userId });
  const { items: publicItems } = await getPublicPortfolio({ userId });
  res.render('user/portfolio', {
    title: 'Mening Portfolio',
    user,
    portfolio,
    items,
    publicItems,
    csrfToken: req.csrfToken?.(),
  });
});

/** GET /api/user/portfolio — my portfolio items. */
router.get('/api/user/portfolio', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    const { portfolio, items } = await listPortfolio({ userId });
    res.json({ portfolio, items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/user/portfolio/items — add evidence item. */
router.post('/api/user/portfolio/items', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    // Security: yangi item har doim default-private bo'ladi — visibility faqat
    // PATCH /items/:id orqali owner tomonidan oshiriladi (opt-in model).
    const r = await addPortfolioItem({
      userId,
      kind: req.body?.kind || 'draft',
      title: req.body?.title || '',
      contentMeta: req.body?.contentMeta || {},
      evidenceRef: req.body?.evidenceRef || null,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, itemId: r.itemId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** PATCH /api/user/portfolio/items/:id — set visibility (owner-only). */
router.patch('/api/user/portfolio/items/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    const r = await setItemVisibility({
      userId,
      itemId: Number(req.params.id),
      visibility: req.body?.visibility || ITEM_VISIBILITY.PRIVATE,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, itemId: r.itemId, visibility: r.visibility });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/user/credentials — my credentials. */
router.get('/api/user/credentials', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    const credentials = await listCredentials({ userId });
    res.json({ credentials });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/user/credentials/:id/appeal — appeal revocation. */
router.post('/api/user/credentials/:id/appeal', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    const r = await appealCredential({
      credentialId: Number(req.params.id),
      userId,
      reason: req.body?.reason || '',
      appealCount: req.body?.appealCount || 0,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, credentialId: r.credentialId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/user/items/:id/share — create selective share grant. */
router.post('/api/user/items/:id/share', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    const r = await createShareGrant({
      userId,
      itemId: Number(req.params.id),
      viewerEmail: req.body?.viewerEmail || null,
      expiresAt: req.body?.expiresAt || null,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, token: r.token, url: r.url });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/user/share-grants/:id/revoke — revoke grant. */
router.post('/api/user/share-grants/:id/revoke', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    const r = await revokeShareGrant({ userId, grantId: Number(req.params.id), actorRole: 'user' });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, revoked: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /share/:token — verifier view for a share grant. */
router.get('/share/:token', async (req, res) => {
  const viewerEmail = req.query?.viewer || '';
  const r = await verifyShareGrant({ token: req.params.token, viewerEmail });
  if (!r.ok) {
    return res.status(404).render('verify', { title: 'Share not available', result: { verifiable: false, error: r.error }, csrfToken: null });
  }
  res.render('verify', { title: 'Shared evidence', result: { verifiable: true, item: r.item }, csrfToken: null });
});

/** GET /verify/:digest — public credential verifier (valid/revoked/expired). */
router.get('/verify/:digest', async (req, res) => {
  const r = await verifyCredential({ vcDigest: req.params.digest });
  res.render('verify', {
    title: 'Credential verification',
    result: r,
    csrfToken: null,
  });
});

// ─────────────────────────────────────────────────────────────────────
// ADMIN — definitions + credential management
// ─────────────────────────────────────────────────────────────────────

/** GET /admin/credentials — admin UI. */
router.get('/admin/credentials', requireAdmin, (req, res) => {
  res.render('admin/credentials', {
    title: 'Credentials',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

/** GET /api/admin/credential-definitions — list definitions. */
router.get('/api/admin/credential-definitions', requireAdmin, async (req, res) => {
  try {
    const definitions = await listCredentialDefinitions({ status: req.query.status || null });
    res.json({ definitions });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credential-definitions — create definition. */
router.post('/api/admin/credential-definitions', requireAdmin, async (req, res) => {
  try {
    const r = await createCredentialDefinition({
      name: req.body?.name || '',
      version: req.body?.version || 'v1',
      criteria: req.body?.criteria || {},
      issuerAuthority: req.body?.issuerAuthority || 'admin',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, definitionId: r.definitionId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credential-definitions/:id/publish — publish definition. */
router.post('/api/admin/credential-definitions/:id/publish', requireAdmin, async (req, res) => {
  try {
    const r = await publishCredentialDefinition({ definitionId: Number(req.params.id), actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, definitionId: r.definitionId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credentials/issue — issue credential (guarded, idempotent). */
router.post('/api/admin/credentials/issue', requireAdmin, async (req, res) => {
  try {
    const r = await issueCredential({
      definitionId: Number(req.body?.definitionId || 0),
      userId: Number(req.body?.userId || 0),
      recipient: req.body?.recipient || '',
      evidence: req.body?.evidence || {},
      criteria: req.body?.criteria || {},
      issuedBy: actorId(req),
      issuedByRole: 'admin',
      evidenceRatified: Boolean(req.body?.evidenceRatified),
      teacherApproved: Boolean(req.body?.teacherApproved),
    });
    if (!r.ok) return res.status(400).json({ error: r.error, checks: r.checks, guard: r.guard });
    res.json({ ok: true, cached: r.cached || false, credential: r.credential });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credentials/:id/revoke — revoke credential. */
router.post('/api/admin/credentials/:id/revoke', requireAdmin, async (req, res) => {
  try {
    const r = await revokeCredential({
      credentialId: Number(req.params.id),
      reason: req.body?.reason || '',
      actorId: actorId(req),
      actorRole: 'admin',
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credentials/:id/renew — renew credential. */
router.post('/api/admin/credentials/:id/renew', requireAdmin, async (req, res) => {
  try {
    const r = await renewCredential({
      credentialId: Number(req.params.id),
      evidence: req.body?.evidence || {},
      criteria: req.body?.criteria || {},
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
