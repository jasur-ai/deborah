/**
 * AUTH B-32 — Notification detail (dedupe, quiet hours, template per event)
 * -------------------------------------------------------------------------
 * - §06 Dedupe: bir hodisa (event:day) 24 soat ichida bir marta
 * - §07 Quiet hours: marketing kechiktiriladi; security DARHOL
 * - §08 Per-event template: 3 kanal (email/Telegram/push), 4 til
 * - §10 Cap: marketing cap; security cap'ga kirmaydi
 * - §09 Segment: consistent/sporadic/lapsed → cap
 * - §24 Fallback: kanal xatosi → boshqa kanal; security hech bo'lmasa email
 * - §13 Preview xavfsiz: OTP/parol/answer yo'q
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { fb } from '../../firebase/admin.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { safeKey } from '../../utils/helpers.js';
import {
  sendNotification,
  drainDelayedNotifications,
  inQuietHours,
  nextQuietEnd,
  userSegment,
  segmentDailyCap,
  notifContent,
} from '../../src/modules/student/notifications.js';

const userId = 'b32user';

beforeAll(async () => {
  await snapshotDb();
  await fb.set(`users/${safeKey(userId)}/email`, 'b32@test.uz');
  await fb.set(`users/${safeKey(userId)}/telegram_id`, 123456);
});

afterAll(async () => {
  await restoreDb();
});

beforeEach(async () => {
  await fb.remove('notif_dedupe').catch(() => {});
  await fb.remove('notif_delayed').catch(() => {});
  await fb.remove(`users/${safeKey(userId)}/notif_caps`).catch(() => {});
  await fb.remove(`users/${safeKey(userId)}/notif_prefs`).catch(() => {});
});

describe('AUTH B-32 — notification detail (unit)', () => {
  it('§07 inQuietHours: 22-08 default; quiet=null → hech qachon', () => {
    // 23:00 — quiet ichida
    const night = new Date('2026-08-14T23:00:00').getTime();
    expect(inQuietHours(night, { start: 22, end: 8 })).toBe(true);
    // 12:00 — quiet emas
    const noon = new Date('2026-08-14T12:00:00').getTime();
    expect(inQuietHours(noon, { start: 22, end: 8 })).toBe(false);
    // quiet o'chirilgan
    expect(inQuietHours(night, null)).toBe(false);
    // start===end → off
    expect(inQuietHours(night, { start: 0, end: 0 })).toBe(false);
    // user sozlagan 9-18
    expect(inQuietHours(new Date('2026-08-14T10:00:00').getTime(), { start: 9, end: 18 })).toBe(true);
  });

  it('§09 userSegment: consistent/sporadic/lapsed', () => {
    const now = Date.now();
    expect(userSegment({ last_active: now - 1000 })).toBe('consistent');
    expect(userSegment({ last_login: now - 10 * 86400000 })).toBe('sporadic');
    expect(userSegment({ lastSeen: now - 45 * 86400000 })).toBe('lapsed');
    expect(userSegment(null)).toBe('sporadic');
    expect(userSegment({})).toBe('sporadic');
  });

  it('§10 segmentDailyCap: security → Infinity; sporadic kam; lapsed ko\'p', () => {
    expect(segmentDailyCap('consistent', null, 3)).toBe(3);
    expect(segmentDailyCap('sporadic', null, 3)).toBe(2);
    expect(segmentDailyCap('lapsed', null, 3)).toBe(3);
    expect(segmentDailyCap('consistent', 'password_changed', 3)).toBe(Infinity);
  });

  it('§08 notifContent: 3 kanal kontent + 4 til + sensitive yo\'q (OTP/parol)', () => {
    const c = notifContent('assignment', { lang: 'uz' });
    expect(c.subject).toContain('topshiriq');
    expect(c.tgText).toBeTruthy();
    expect(c.pushTitle).toBeTruthy();
    const en = notifContent('result', { lang: 'en' });
    expect(en.subject).toContain('Result');
    // §13: preview'da OTP/parol/answer hech qachon
    const all = JSON.stringify(notifContent('security', { lang: 'uz' }));
    expect(all).not.toMatch(/otp|parol|password|answer|code/i);
  });

  it('§06 dedupe: bir hodisa event:day — ikkinchi marta → dedupe_24h', async () => {
    const now = new Date('2026-08-14T12:00:00').getTime();
    const r1 = await sendNotification({
      userId, type: 'assignment', eventType: null, now,
      deps: { sendTelegram: async () => ({ ok: true, message_id: 't1' }) },
    });
    expect(r1.ok).toBe(true);

    const r2 = await sendNotification({
      userId, type: 'assignment', eventType: null, now: now + 60_000,
      deps: { sendTelegram: async () => ({ ok: true, message_id: 't2' }) },
    });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('dedupe_24h');

    // Boshqa type — dedupe emas
    const r3 = await sendNotification({
      userId, type: 'result', eventType: null, now: now + 120_000,
      deps: { sendTelegram: async () => ({ ok: true, message_id: 't3' }) },
    });
    expect(r3.ok).toBe(true);
  });

  it('§07 quiet hours: marketing kechiktiriladi; security DARHOL yuboriladi', async () => {
    const night = new Date('2026-08-14T23:00:00').getTime();
    // Marketing — quiet ichida → delayed
    const m = await sendNotification({ userId, type: 'practice', eventType: null, now: night });
    expect(m.ok).toBe(true);
    expect(m.delayed).toBe(true);
    expect(m.dueAt).toBeGreaterThan(night);

    // Security — quiet'da ham DARHOL (kanal: telegram mavjud)
    const s = await sendNotification({
      userId, type: 'security', eventType: 'password_changed', now: night,
      deps: { sendTelegram: async () => ({ ok: true, message_id: 's1' }) },
    });
    expect(s.ok).toBe(true);
    expect(s.delayed).toBeUndefined();
    expect(s.delivered).toContain('telegram');
  });

  it("§10 cap: marketing cap'da to'xtaydi; security cap'ga kirmaydi", async () => {
    const now = new Date('2026-08-14T12:00:00').getTime();
    // Consistent segment (last_active bugun — Date.now() bilan, aks holda test
    // real vaqt o'tishi bilan sporadic bo'lib cap 2 ga tushadi)
    await fb.set(`users/${safeKey(userId)}/last_active`, Date.now() - 1000);
    // telegram cap 3/kun — 3 marta yuboramiz (dedupe'ni chetlab o'tish uchun
    // har xil type ishlatamiz)
    for (const tp of ['result', 'practice', 'feedback']) {
      const r = await sendNotification({
        userId, type: tp, eventType: null, now,
        deps: { sendTelegram: async () => ({ ok: true, message_id: 'c1' }) },
      });
      if (!r.ok) console.log('DBG cap fail type=', tp, 'result=', JSON.stringify(r));
      expect(r.ok).toBe(true);
    }
    // 4-marketing — cap (telegram 3) → kanal qolmaydi
    const r4 = await sendNotification({
      userId, type: 'deadline', eventType: null, now,
      deps: { sendTelegram: async () => ({ ok: true, message_id: 'c4' }) },
    });
    expect(r4.ok).toBe(false);
    expect(r4.reason).toBe('cap_or_disabled');

    // Security — cap'ga kirmaydi (hatto cap to'lgan bo'lsa ham)
    const s = await sendNotification({
      userId, type: 'security', eventType: 'new_device', now,
      deps: { sendTelegram: async () => ({ ok: true, message_id: 's2' }) },
    });
    expect(s.ok).toBe(true);
    expect(s.delivered).toContain('telegram');
  });

  it("§24 fallback: telegram failsa → email kanaliga; security hech bo'lmasa bitta", async () => {
    const now = new Date('2026-08-14T12:00:00').getTime();
    // Email yoqilgan
    await fb.set(`users/${safeKey(userId)}/notif_prefs/channels/email`, true);
    const s = await sendNotification({
      userId, type: 'security', eventType: 'suspicious', now,
      deps: {
        sendTelegram: async () => { throw new Error('tg down'); },
        sendEmail: async (msg) => ({ ok: true, messageId: 'e1', ...msg }),
      },
    });
    expect(s.ok).toBe(true);
    expect(s.failed).toContain('telegram');
    expect(s.delivered).toContain('email');
  });

  it('§07 drainDelayedNotifications: due bo\'lgan delayed xabar yuboriladi', async () => {
    const night = new Date('2026-08-14T23:00:00').getTime();
    const m = await sendNotification({ userId, type: 'practice', eventType: null, now: night });
    expect(m.delayed).toBe(true);

    // Hali due emas (dueAt = ertaga 08:00) — drain hech narsa yubormaydi
    const still = await drainDelayedNotifications({ now: night + 60_000 });
    expect(still.sent).toBe(0);

    // Ertalab (due + quiet tugadi) — drain yuboradi
    const morning = new Date('2026-08-15T09:00:00').getTime();
    const drained = await drainDelayedNotifications({
      now: morning,
      deps: { sendTelegram: async () => ({ ok: true, message_id: 'd1' }) },
    });
    expect(drained.sent).toBeGreaterThanOrEqual(1);
  });
});
