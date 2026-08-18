/**
 * Edikit — E-02: HEMIS push webhook route
 * -------------------------------------------------
 * POST /api/webhooks/hemis — HEMIS → Edikit push (talabalar/ballar o'zgarishi).
 *   - HMAC-SHA256: X-Hemis-Signature == HMAC(body, HEMIS_WEBHOOK_SECRET)
 *   - IP allowlist: HEMIS_WEBHOOK_IP_ALLOWLIST (opsional)
 *   - Idempotent: hemis_webhook_log/{eventId}
 *   - `/api/webhooks/` prefix'i CSRF'dan ozod (server.js — webhook HMAC/token
 *     bilan himoyalanadi, CSRF token'ni olib kela olmaydi).
 */

import { Router } from 'express';
import { processHemisWebhook } from '../src/modules/hemis/webhook.js';

const router = Router();

router.post('/api/webhooks/hemis', async (req, res) => {
  // Raw body HMAC uchun kerak — express.json({ verify }) bilan qo'lga kiritiladi
  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const signature = req.headers['x-hemis-signature'];

  try {
    const result = await processHemisWebhook(rawBody, {
      signature,
      ip: req.ip,
      env: process.env,
    });

    if (result.error) {
      const status = result.error === 'invalid-signature' || result.error === 'ip-not-allowed' ? 403 : 400;
      return res.status(status).json({ ok: false, error: result.error });
    }

    return res.json({ ok: true, event: result.event || 'ignored', duplicate: !!result.duplicate });
  } catch (err) {
    console.error('HEMIS webhook error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

export default router;
