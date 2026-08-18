/**
 * AUTH A-23 — Email webhook (bounce/complaint)
 * -------------------------------------------------
 * POST /api/webhooks/email — provider (Postmark/SES) dan keladi.
 *   - Token tekshiruvi: X-Postmark-Webhook-Token == EMAIL_WEBHOOK_TOKEN
 *   - Idempotent (email_log/{messageId})
 *   - Hard bounce → users/{userKey}/email_status='bounced' (suppress)
 *   - Audit: email:bounced / email:complaint
 *   - `/api/webhooks/` prefix'i CSRF'dan ozod (server.js — webhook HMAC/token bilan
 *     himoyalanadi, CSRF token'ni olib kela olmaydi).
 */

import { Router } from 'express';
import { processEmailWebhook, verifyWebhookToken, EMAIL_EVENTS } from '../src/modules/email/webhook.js';
import { audit, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';

const router = Router();

router.post('/api/webhooks/email', async (req, res) => {
  // `/api/webhooks/` server.js'da CSRF bypass (webhook token bilan himoya).
  if (!verifyWebhookToken(req)) {
    return res.status(403).json({ ok: false, error: 'invalid-token' });
  }

  const payload = req.body || {};
  try {
    const result = await processEmailWebhook(payload);
    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    if (result.event) {
      const action =
        result.event === EMAIL_EVENTS.BOUNCED
          ? AUDIT_ACTIONS.EMAIL_BOUNCED
          : result.event === EMAIL_EVENTS.COMPLAINT
            ? AUDIT_ACTIONS.EMAIL_COMPLAINT
            : null;
      if (action) {
        audit({
          action,
          outcome: 'success',
          resourceType: 'email',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { duplicate: !!result.duplicate, messageId: String(payload.MessageID || payload.MessageId || '').slice(0, 12) },
        }).catch(() => {});
      }
    }

    return res.json({ ok: true, event: result.event || 'ignored', duplicate: !!result.duplicate });
  } catch (err) {
    console.error('Email webhook error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

export default router;
