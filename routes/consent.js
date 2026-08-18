/**
 * Deborah — Consent API (AUTH D-25 §10-§11)
 * ---------------------------------------------------------------------------
 * GET  /api/consent/status  — barcha purpose'lar holati (settings/DSAR)
 * POST /api/consent/revoke  — consent bekor qilish (reauth, fail-closed)
 *
 * Revoke amaliy ta'siri (D-25 §11):
 *   - telegram   → notif prefs'da kanal o'chadi (xabar yuborilmaydi)
 *   - privacy_policy_v1 → qayta rozilik so'raladi (re-consent banner)
 * Xavfsizlik: requireAuth + CSRF (global) + requireRecentAuth (sensitive).
 */

import { Router } from 'express';
import { requireAuth, requireRecentAuth } from '../middleware/auth.js';
import {
  listConsents,
  revokeConsent,
  recordConsent,
  CONSENT_PURPOSES,
  CONSENT_VERSION,
} from '../src/modules/legal/consent.js';

const router = Router();

// ── Barcha consent holati (D-25 §10: DSAR'da ko'rinadi) ──
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user?.safeKey || req.session.user?.id;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const consents = await listConsents(userKey);
    return res.json({ ok: true, consents });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── Consent grant / re-consent (D-25 §12) — banner "Rozilik berish" ──
// Policy versiyasi yangilanganda eski consent revoke EMAS — qayta so'rov.
// requireAuth yetarli (reauth emas): rozilik berish xavfli amal emas.
router.post('/grant', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user?.safeKey || req.session.user?.id;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const { purpose } = req.body || {};
    const validPurposes = Object.values(CONSENT_PURPOSES);
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({ ok: false, error: 'invalid_purpose' });
    }

    const r = await recordConsent(userKey, purpose, {
      version: CONSENT_VERSION,
      ipHash: req.headers['x-forwarded-for'] || req.ip,
      lang: String(req.query.lang || 'uz').slice(0, 10),
    });
    return res.json({ ok: true, purpose, version: r.version });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── Consent revoke (D-25 §11) — fail-closed: amalda funksiya to'xtaydi ──
router.post('/revoke', requireAuth, requireRecentAuth, async (req, res) => {
  try {
    const userKey = req.session.user?.safeKey || req.session.user?.id;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const { purpose } = req.body || {};
    const validPurposes = Object.values(CONSENT_PURPOSES);
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({ ok: false, error: 'invalid_purpose' });
    }

    // Amaliy ta'sir: telegram kanali o'chadi (fail-closed — xabar yuborilmaydi)
    if (purpose === CONSENT_PURPOSES.TELEGRAM) {
      try {
        const { setNotifPrefs } = await import('../src/modules/student/notifications.js');
        await setNotifPrefs({ userId: userKey, channels: { telegram: false } });
      } catch (_) { /* fail-soft (modul importi) — consent yozuvi asosiy */ }
    }

    const r = await revokeConsent(userKey, purpose, { ipHash: req.headers['x-forwarded-for'] || req.ip });
    if (!r.ok) {
      return res.status(r.error === 'consent_not_found' ? 404 : 400).json({ ok: false, error: r.error });
    }
    return res.json({ ok: true, purpose, revoked: r.revoked });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

export default router;
