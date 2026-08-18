/**
 * Deborah — Resource Recommendation Connectors Routes
 *
 * Prompt 54 REST API (admin — requireAdmin):
 *   - GET  /api/admin/resource-reco/meta       — constants for admin UI
 *   - GET  /api/admin/resource-reco/providers  — provider status/quota
 *   - POST /api/admin/resource-reco/providers/:name — update provider config
 *   - POST /api/admin/resource-reco/search     — run search (connectors)
 *   - GET  /api/admin/resource-reco/searches   — recent searches
 *   - GET  /api/admin/resource-reco/searches/:id — results with why_recommended
 *   - POST /api/admin/resource-reco/records/:id/feedback — trust|hide|save|source_pack
 *   - GET  /api/admin/resource-reco/dashboard  — aggregate data
 *   - GET  /admin/resource-reco                — admin page
 *
 * Security (Prompt 54 §15-17):
 *   - requireAdmin barcha write path'da; actor id session'dan.
 *   - LLM hech qachon bibliographic record yaratmaydi — provider
 *     API'lar real record qaytaradi, LLM faqat rank/summarize qiladi.
 *   - YouTube transcript scraping bloklanadi.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { getDb } from '../src/infrastructure/postgres.js';
import { getCurrentTenant } from '../src/modules/auth/tenant-context.js';
import {
  searchResources,
  applyTeacherFeedback,
  ensureResourceProviders,
  updateResourceProvider,
  getRecommendationDashboard,
  generateLlmSummary,
  RESOURCE_PROVIDERS,
  PROVIDER_STATUS,
  RESOURCE_TYPES,
  SOURCE_BADGES,
  FEEDBACK_ACTIONS,
  RANKING_WEIGHTS,
} from '../src/modules/resource-reco/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** GET /api/admin/resource-reco/meta — constants for the admin UI. */
router.get('/api/admin/resource-reco/meta', requireAdmin, (req, res) => {
  res.json({
    providers: RESOURCE_PROVIDERS,
    providerStatus: PROVIDER_STATUS,
    resourceTypes: RESOURCE_TYPES,
    sourceBadges: SOURCE_BADGES,
    feedbackActions: FEEDBACK_ACTIONS,
    rankingWeights: RANKING_WEIGHTS,
  });
});

/** GET /api/admin/resource-reco/providers — ensure + list provider rows. */
router.get('/api/admin/resource-reco/providers', requireAdmin, async (req, res) => {
  try {
    await ensureResourceProviders();
    const dash = await getRecommendationDashboard();
    if (!dash.ok) return res.status(400).json({ error: dash.error });
    res.json({ providers: dash.providers });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/resource-reco/providers/:name — update provider config/status. */
router.post('/api/admin/resource-reco/providers/:name', requireAdmin, async (req, res) => {
  try {
    const r = await updateResourceProvider({
      name: req.params.name,
      patch: req.body || {},
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/resource-reco/search — run recommendation search. */
router.post('/api/admin/resource-reco/search', requireAdmin, async (req, res) => {
  try {
    const r = await searchResources({
      query: req.body?.query,
      topic: req.body?.topic,
      context: req.body?.context,
      limit: req.body?.limit ?? 10,
      providers: req.body?.providers || [],
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ searchId: r.searchId, cached: Boolean(r.cached), results: r.results, warnings: r.warnings });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/resource-reco/searches — recent searches. */
router.get('/api/admin/resource-reco/searches', requireAdmin, async (req, res) => {
  try {
    const dash = await getRecommendationDashboard();
    if (!dash.ok) return res.status(400).json({ error: dash.error });
    res.json({ searches: dash.recentSearches });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/resource-reco/searches/:id — results with why_recommended (tenant-scoped). */
router.get('/api/admin/resource-reco/searches/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(400).json({ error: 'PostgreSQL required' });
    const tenantId = getCurrentTenant()?.id;
    if (!tenantId) return res.status(400).json({ error: 'tenant context is required' });
    const rows = await db
      .selectFrom('resource_search_results as r')
      .innerJoin('resource_records as rec', 'rec.id', 'r.record_id')
      .selectAll('rec')
      .select(['r.rank', 'r.score', 'r.components', 'r.why_recommended'])
      .where('r.search_id', '=', Number(req.params.id))
      .where('rec.tenant_id', '=', tenantId)
      .orderBy('r.rank', 'asc')
      .execute();
    res.json({ results: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/resource-reco/records/:id/feedback — teacher feedback. */
router.post('/api/admin/resource-reco/records/:id/feedback', requireAdmin, async (req, res) => {
  try {
    const r = await applyTeacherFeedback({
      recordId: Number(req.params.id),
      action: req.body?.action,
      note: req.body?.note,
      sourcePackId: req.body?.sourcePackId,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, feedbackId: r.feedbackId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/resource-reco/records/summarize — LLM summary (retrieved-only guard §11.4). */
router.post('/api/admin/resource-reco/records/summarize', requireAdmin, async (req, res) => {
  try {
    const r = await generateLlmSummary({
      recordIds: req.body?.recordIds || [],
      summaries: req.body?.summaries || [],
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error, summaries: r.summaries });
    res.json({ ok: true, summaries: r.summaries });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/resource-reco/dashboard — aggregate. */
router.get('/api/admin/resource-reco/dashboard', requireAdmin, async (req, res) => {
  try {
    const dash = await getRecommendationDashboard();
    if (!dash.ok) return res.status(400).json({ error: dash.error });
    res.json(dash);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/resource-reco — admin page. */
router.get('/admin/resource-reco', requireAdmin, (req, res) => {
  res.render('admin/resource-reco', {
    title: 'Resource Recommendations',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
