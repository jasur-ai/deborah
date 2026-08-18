/**
 * Edikit — Ochiq ma'lumotlar Routes (AUTH A-13)
 * ---------------------------------------------
 *   - GET  /api/opendata/stats            — public landing stats (real, source+license)
 *   - POST /api/admin/opendata/refresh    — admin force refresh (audit opendata:refresh)
 *
 * Security: stats public lekin PII yo'q (faqat ochiq yig'indi + OTM nomlari);
 * refresh faqat admin; fetch SSRF allowlist orqali (modul ichida).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { getStats, refreshDataset } from '../src/modules/opendata/index.js';

const router = Router();

/** GET /api/opendata/stats — public. */
router.get('/api/opendata/stats', async (req, res) => {
  try {
    const stats = await getStats();
    if (!stats.enabled) {
      return res.json({ enabled: false });
    }
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 daqiqa CDN/browser cache
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/opendata/refresh — admin-only force refresh. */
// Eslatma: global CSRF middleware bu POST'ga ham qo'llanadi — UI tugmasi
// `x-csrf-token` header'ini yuborishi shart (aks holda 403).
router.post('/api/admin/opendata/refresh', requireAdmin, async (req, res) => {
  try {
    const r = await refreshDataset({ force: true });
    if (!r.ok) {
      return res.status(502).json({ ok: false, error: r.error || 'refresh failed', keepStaleCache: true });
    }
    res.json({ ok: true, source: r.source });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
