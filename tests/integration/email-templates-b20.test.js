/**
 * AUTH B-20 — Email templates: integration (deliverAlert email + breach)
 * ----------------------------------------------------------------------
 * 1) deliverAlert email channel'ida renderSecurity orqali sendEmail chaqiradi
 *    (sendImpl inject — mock transport); audit + metric fail-soft.
 * 2) Security alert'da raw IP/UA hech qachon emailga kirmaydi.
 * 3) Breach flag mavjud bo'lganda panel banner (A-29 bilan integratsiya).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

const { queueNewDeviceAlert, deliverAlert } = await import('../../src/modules/auth/new-device.js');
const { renderSecurity, renderBreach } = await import('../../src/modules/email/templates.js');

const TEST_EMAIL = `b20-${Date.now()}@test.uz`;

describe('AUTH B-20 — Email templates (integration)', () => {
  let app;
  let httpServer;

  beforeAll(async () => {
    const created = await createApp();
    app = created.app;
    httpServer = created.httpServer;
    await new Promise((r) => httpServer.listen(0, r));
  });

  afterAll(async () => {
    await new Promise((r) => httpServer.close(r));
  });

  it('deliverAlert: email channel → renderSecurity orqali sendEmail (PII minimal)', async () => {
    const userId = safeKey(`b20user${Date.now()}`);
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0';
    // user record — email kerak (deliverAlert userData.email o'qiydi)
    await fb.set(`users/${userId}`, {
      username: 'B20 User',
      email: TEST_EMAIL,
      settings: { lang: 'en' },
      // AUTH B-21: kanal endi notif_prefs orqali (email ON, telegram OFF)
      notif_prefs: {
        channels: { telegram: false, email: true, push: false },
        types: { security: true },
        updated_at: Date.now(),
      },
    });

    const queued = await queueNewDeviceAlert({
      userId,
      type: 'new_device',
      ipAddress: '203.0.113.7',
      userAgent: ua,
    });
    expect(queued.queued).toBe(true);

    let received = null;
    const delivered = await deliverAlert(
      { userId, alertId: queued.alertId },
      {
        sendImpl: async (msg) => {
          received = msg;
          return { messageId: `test-${Date.now()}` };
        },
      },
    );
    expect(delivered.ok).toBe(true);
    expect(received, `channel=${delivered.channel} err=${delivered.error || ''} preview=${JSON.stringify(delivered.preview)}`).not.toBeNull();
    expect(received.to).toBe(TEST_EMAIL);
    // Security template orqali — html mavjud, CTA mavjud
    expect(received.html).toContain('</html>');
    expect(received.html).toContain('user/panel#security');
    // PII: raw IP yoki UA yo'q
    expect(received.html).not.toContain('203.0.113.7');
    expect(received.html).not.toContain('Mozilla');
    expect(received.text).not.toContain('203.0.113.7');
  });

  it('deliverAlert: password_changed — bypassDailyCap variant ham security template', async () => {
    const userId = safeKey(`b20u2${Date.now()}`);
    await fb.set(`users/${userId}`, {
      username: 'B20 User2',
      email: `b20-2-${Date.now()}@test.uz`,
      settings: { lang: 'uz' },
      notif_prefs: {
        channels: { telegram: false, email: true, push: false },
        types: { security: true },
        updated_at: Date.now(),
      },
    });
    const queued = await queueNewDeviceAlert({
      userId,
      type: 'password_changed',
      ipAddress: '198.51.100.9',
      userAgent: 'Mozilla Firefox/121.0',
      bypassDailyCap: true,
    });
    expect(queued.queued).toBe(true);
    let received = null;
    await deliverAlert(
      { userId, alertId: queued.alertId },
      { sendImpl: async (msg) => { received = msg; return { messageId: 'm' }; } },
    );
    expect(received).not.toBeNull();
    expect(received.tag).toContain('password_changed');
    expect(received.subject).toContain('Parol');
  });

  it('renderSecurity/renderBreach: hech qachon parol/token emas, faqat CTA havola', () => {
    const sec = renderSecurity({ type: 'suspicious', lang: 'en', device: 'Chrome', city: 'Tashkent', time: '12:00' });
    const b = renderBreach({ lang: 'en' });
    for (const t of [sec, b]) {
      expect(t.html).not.toMatch(/token[=:]/i);
      expect(t.html).not.toMatch(/password[=:]/i);
      expect(t.html).toContain('user/panel#security');
    }
  });
});
