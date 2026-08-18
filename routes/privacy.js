/**
 * Deborah — User DSAR Routes (AUTH D-23)
 * ---------------------------------------------------------------------------
 * POST /api/privacy/dsar/export   — barcha PII eksport (JSON)
 * POST /api/privacy/dsar/correct  — profil tuzatish (reauth)
 * POST /api/privacy/dsar/delete   — soft delete (reauth + confirm, 30 kun grace)
 * POST /api/privacy/dsar/restrict — processing cheklash (legal hold flag)
 *
 * Xavfsizlik: requireAuth + CSRF (global) + reauth (correct/delete);
 * audit: dsar_exported / dsar_corrected / dsar_deleted / dsar_restricted.
 */

import { Router } from 'express';
import { requireAuth, requireRecentAuth } from '../middleware/auth.js';
import {
  collectUserPii,
  softDeleteUser,
  restrictUser,
  getDsarStatus,
  logDsarRequest,
  DSAR_SLA_DAYS,
} from '../src/modules/privacy/dsar-user.js';
import { audit, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';

const router = Router();

// ── DSAR export (D-23 §06) — reauth shart emas (o'qish) ──
router.post('/dsar/export', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user?.safeKey || req.session.user?.id;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const r = await collectUserPii(userKey);
    if (!r.ok) return res.status(404).json({ ok: false, error: r.error });

    await audit({
      action: AUDIT_ACTIONS.DSAR_EXPORTED || 'dsar:exported',
      resourceType: 'user',
      userId: userKey,
      details: { format: 'json' },
    }).catch(() => {});

    // AUTH D-23 §11/§12 (C-23): SLA tracking — 30 kun deadline log'lanadi
    const sla = await logDsarRequest(userKey, 'export', { status: 'processing' });

    return res.json({ ok: true, data: r.data, slaDays: DSAR_SLA_DAYS, slaDeadline: sla.record.sla_deadline });
  } catch (err) {
    console.error('[privacy] export error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── DSAR correct (D-23 §07) — reauth + profil tuzatish ──
router.post('/dsar/correct', requireAuth, requireRecentAuth, async (req, res) => {
  try {
    const userKey = req.session.user?.safeKey || req.session.user?.id;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const { name = null } = req.body || {};
    // Faqat ruxsat etilgan maydonlar (tenant scope — o'z profili)
    const patch = {};
    if (typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 100) {
      patch.display_name = name.trim();
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ ok: false, error: 'no_valid_fields' });
    }

    const { fb } = await import('../firebase/admin.js');
    await fb.update(`users/${userKey}`, patch);

    await audit({
      action: AUDIT_ACTIONS.DSAR_CORRECTED || 'dsar:corrected',
      resourceType: 'user',
      userId: userKey,
      details: { fields: Object.keys(patch) },
    }).catch(() => {});

    await logDsarRequest(userKey, 'correct', { status: 'completed' }).catch(() => {});

    return res.json({ ok: true, updated: Object.keys(patch) });
  } catch (err) {
    console.error('[privacy] correct error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── DSAR delete (D-23 §08/§09) — reauth + confirm → soft delete 30 kun ──
router.post('/dsar/delete', requireAuth, requireRecentAuth, async (req, res) => {
  try {
    const userKey = req.session.user?.safeKey || req.session.user?.id;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const { confirm = false, reason = '' } = req.body || {};
    // Ikkilamchi tasdiq — bexosdan o'chirishdan himoya (D-23 §09)
    if (confirm !== true && confirm !== 'true') {
      return res.status(400).json({ ok: false, error: 'confirmation_required' });
    }

    const r = await softDeleteUser(userKey, { reason });
    if (!r.ok) {
      const status = r.error === 'legal_hold' ? 423 : 404; // 423 Locked
      return res.status(status).json({ ok: false, error: r.error });
    }

    // Sessiyani o'chirish — delete'dan keyin login blok
    req.session.destroy(() => {});

    await logDsarRequest(userKey, 'delete', { status: 'processing' }).catch(() => {});

    return res.json({ ok: true, graceUntil: r.graceUntil, slaDays: DSAR_SLA_DAYS, message: 'account_scheduled_for_deletion' });
  } catch (err) {
    console.error('[privacy] delete error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── DSAR restrict (D-23 §10) — processing to'xtatish ──
router.post('/dsar/restrict', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user?.safeKey || req.session.user?.id;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const { restrict = true } = req.body || {};
    const r = await restrictUser(userKey, { restrict: restrict !== false });
    if (!r.ok) return res.status(404).json({ ok: false, error: r.error });

    await logDsarRequest(userKey, 'restrict', { status: 'completed' }).catch(() => {});

    return res.json({ ok: true, restricted: r.restricted });
  } catch (err) {
    console.error('[privacy] restrict error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── DSAR status (holat tekshiruvi) ──
router.get('/dsar/status', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user?.safeKey || req.session.user?.id;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const status = await getDsarStatus(userKey);
    return res.json({ ok: true, status });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

export default router;
