/**
 * Deborah — Observability Routes (Prompt 69 §12-14)
 *
 * Admin SLO dashboard:
 *   - GET /admin/observability — HTML dashboard (SLO burn-rate, alerts, metrics)
 *   - GET /admin/api/observability — JSON snapshot (dashboard AJAX / testlar)
 *
 * Security: requireAdmin — faqat admin ko'radi (telemetryda sensitive data
 * yo'q — redaction.js orqali answer key/token/PII tushmaydi).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { telemetrySnapshot } from '../src/telemetry/index.js';

const router = Router();

router.get('/observability', requireAdmin, (req, res) => {
  const data = telemetrySnapshot({ sinceMs: 30 * 24 * 60 * 60 * 1000 });
  res.render('admin/observability', {
    title: 'Observability — SLO & Alerts',
    // Sidebar highlight uchun to'liq path (renderRoleNav href bilan solishtiradi)
    active: '/admin/observability',
    // S17.09: deep admin hierarchy — breadcrumb (landing/shallow'ga emas)
    crumbs: [
      { href: '/admin/dashboard', label: 'Admin' },
      { href: '/admin/observability', label: 'Observability' },
    ],
    data,
  });
});

router.get('/api/observability', requireAdmin, (req, res) => {
  const data = telemetrySnapshot({ sinceMs: 30 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, ...data });
});

export default router;
