import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { runReEngagementSequence, REENGAGE_STEPS, tashkentNow } from '../../src/modules/onboarding/reengage.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

const DAY = 86400000;
const NOW = Date.now();

async function seedUser({ key, email, inactiveDays, lang = 'uz', emailStatus = null, suppress = false, noPrefs = false, activated = true }) {
  const user = {
    username: key,
    email,
    settings: { lang },
    last_active: NOW - inactiveDays * DAY,
    notif_prefs: noPrefs ? undefined : { channels: { email: true } },
  };
  if (emailStatus) user.email_status = emailStatus;
  await fb.set(`users/${key}`, user);
  if (activated) {
    await fb.set(`onboarding/${safeKey(key)}`, {
      step: 'checklist',
      activated_at: NOW - (inactiveDays + 2) * DAY,
      orient: { subject: 'matematika', skipped: false, submittedAt: NOW - (inactiveDays + 2) * DAY },
      firstWin: { subject: 'matematika', completedAt: NOW - inactiveDays * DAY, score: 3, total: 5 },
    });
  }
  if (suppress) {
    await fb.set(`email_suppressed/${safeKey(email)}`, { at: NOW, reason: 'hard-bounce' });
  }
}

describe('B-35 — re-engagement journey', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('REENGAGE_STEPS: 7 va 14 kun (2 ta)', () => {
    expect(REENGAGE_STEPS.map((s) => s.key)).toEqual(['r7', 'r14']);
    expect(REENGAGE_STEPS.map((s) => s.minInactiveDays)).toEqual([7, 14]);
  });

  it('tashkentNow: UTC+5 (Asia/Tashkent)', () => {
    expect(tashkentNow(0)).toBe(5 * 60 * 60 * 1000);
    expect(tashkentNow(1000)).toBe(1000 + 5 * 60 * 60 * 1000);
  });

  it('7 kun harakatsiz + email opt-in → r7 yuboriladi, flag yoziladi, takroriy EMAS', async () => {
    await seedUser({ key: 'b35-7', email: 'b35-7@test.uz', inactiveDays: 8 });
    const sent = [];
    const r = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async (msg) => { sent.push(msg.tag); return { ok: true }; } },
    });
    expect(sent).toContain('reengage-r7');
    expect(r.sent).toBeGreaterThanOrEqual(1);

    const snap = await fb.get(`onboarding/${safeKey('b35-7')}/reengageSent`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().r7).toBeTruthy();

    // Idempotency — ikkinchi run r7'ni qayta yubormaydi
    const r2 = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async () => { throw new Error('duplicate!'); } },
    });
    expect(r2.sent).toBe(0);
  });

  it('15 kun harakatsiz: run1 → r7, run2 → r14 (har run bitta day)', async () => {
    await seedUser({ key: 'b35-14', email: 'b35-14@test.uz', inactiveDays: 15 });
    const sent = [];
    const deps = { sendEmail: async (msg) => { sent.push(msg.tag); return { ok: true }; } };

    await runReEngagementSequence({ now: NOW, deps });
    expect(sent).toEqual(['reengage-r7']); // bitta xabar — qolgani keyingi run

    const sent2 = [];
    await runReEngagementSequence({ now: NOW, deps: { sendEmail: async (msg) => { sent2.push(msg.tag); return { ok: true }; } } });
    expect(sent2).toEqual(['reengage-r14']);
  });

  it('faol user (<7 kun) → skip (spam yo\'q)', async () => {
    await seedUser({ key: 'b35-active', email: 'b35-active@test.uz', inactiveDays: 3 });
    const r = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async () => { throw new Error('should not send'); } },
    });
    expect(r.sent).toBe(0);
  });

  it('marketing opt-in yo\'q (email channel default false) → skip + opted_out audit', async () => {
    await seedUser({ key: 'b35-noopt', email: 'b35-noopt@test.uz', inactiveDays: 10, noPrefs: true });
    const r = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async () => { throw new Error('should not send'); } },
    });
    expect(r.skippedOptOut).toBeGreaterThanOrEqual(1);
    expect(r.sent).toBe(0);
  });

  it('suppress: email_status=bounced → skip; email_suppressed index → skip', async () => {
    await seedUser({ key: 'b35-bounce', email: 'b35-bounce@test.uz', inactiveDays: 10, emailStatus: 'bounced' });
    await seedUser({ key: 'b35-supp', email: 'b35-supp@test.uz', inactiveDays: 10, suppress: true });
    const r = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async () => { throw new Error('should not send'); } },
    });
    expect(r.skippedSuppressed).toBeGreaterThanOrEqual(2);
    expect(r.sent).toBe(0);
  });

  it('lapsed segment (30+ kun) — audit details\'da segment lapsed; xabar PII/sensitive yo\'q', async () => {
    await seedUser({ key: 'b35-lapsed', email: 'b35-lapsed@test.uz', inactiveDays: 45 });
    const sent = [];
    const r = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async (msg) => { sent.push(msg); return { ok: true }; } },
    });
    const msg = sent.find((m) => m.tag === 'reengage-r7');
    expect(msg).toBeTruthy();
    // PII minimal: parol/OTP/raw telemetry yo'q
    const all = `${msg.subject} ${msg.text} ${msg.html}`.toLowerCase();
    expect(all).not.toContain('parol');
    expect(all).not.toContain('password');
    expect(all).not.toContain('otp');
    expect(r.sent).toBeGreaterThanOrEqual(1);
  });

  it('onboarding boshlanmagan user (orient yo\'q) → skip', async () => {
    await seedUser({ key: 'b35-noob', email: 'b35-noob@test.uz', inactiveDays: 20, activated: false });
    const r = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async () => { throw new Error('should not send'); } },
    });
    expect(r.sent).toBe(0);
  });
});
