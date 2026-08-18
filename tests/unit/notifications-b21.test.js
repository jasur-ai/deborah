/**
 * AUTH B-21 — Notification preferences: unit testlar
 * --------------------------------------------------
 * 1) Default prefs (telegram on, email/push off, 6 type on).
 * 2) Kanal/type toggle saqlash (setNotifPrefs).
 * 3) Security forced — o'chirib bo'lmaydi (types.security=false yozilsa ham true).
 * 4) Validation — noto'g'ri input rad etiladi / e'tiborsiz.
 * 5) dispatchNotification — kanal routing + security forced fallback.
 * 6) checkNotifRate — cap + dedupe.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  defaultNotifPrefs,
  getNotifPrefs,
  setNotifPrefs,
  dispatchNotification,
  checkNotifRate,
  recordNotifSent,
  NOTIF_TYPES,
  NOTIF_CHANNELS,
  _notifConfig,
} from '../../src/modules/student/notifications.js';

const userId = safeKey(`b21unit${Date.now()}`);

describe('AUTH B-21 — Notification preferences (unit)', () => {
  beforeEach(async () => {
    await snapshotDb();
  });

  afterEach(async () => {
    await restoreDb();
  });

  it('default: telegram ON, email/push OFF, 6 type ON', () => {
    const d = defaultNotifPrefs();
    expect(d.channels.telegram).toBe(true);
    expect(d.channels.email).toBe(false);
    expect(d.channels.push).toBe(false);
    for (const t of NOTIF_TYPES) expect(d.types[t]).toBe(true);
    expect(NOTIF_TYPES).toHaveLength(6);
    expect(NOTIF_CHANNELS).toEqual(['telegram', 'email', 'push']);
  });

  it("getNotifPrefs: saqlanmagan bo'lsa default qaytaradi", async () => {
    const p = await getNotifPrefs(userId);
    expect(p.channels.telegram).toBe(true);
    expect(p.channels.email).toBe(false);
  });

  it('setNotifPrefs: kanal va type toggle saqlanadi', async () => {
    const r = await setNotifPrefs({
      userId,
      channels: { telegram: false, email: true, push: false },
      types: { assignment: false, result: true },
    });
    expect(r.ok).toBe(true);
    expect(r.prefs.channels.email).toBe(true);
    expect(r.prefs.channels.telegram).toBe(false);
    expect(r.prefs.types.assignment).toBe(false);
    expect(r.prefs.types.result).toBe(true);
    // DB'da saqlangan
    const p = await getNotifPrefs(userId);
    expect(p.channels.email).toBe(true);
    expect(p.updated_at).toBeGreaterThan(0);
  });

  it("security forced: o'chirib bo'lmaydi", async () => {
    const r = await setNotifPrefs({
      userId,
      channels: { email: true },
      types: { security: false, practice: false },
    });
    expect(r.ok).toBe(true);
    expect(r.prefs.types.security).toBe(true); // forced
    expect(r.prefs.types.practice).toBe(false); // oddiy type o'chadi
    // Get qilganda ham security true
    const p = await getNotifPrefs(userId);
    expect(p.types.security).toBe(true);
  });

  it("validation: noto'g'ri input e'tiborsiz (hech qachon bo'lmagan kanal/type)", async () => {
    const r = await setNotifPrefs({
      userId,
      channels: { telegram: true, spam: true, email: 'not-bool' },
      types: { assignment: false, hack: true },
    });
    expect(r.ok).toBe(true);
    // spam/hack e'tiborsiz, email string e'tiborsiz
    expect(r.prefs.channels.spam).toBeUndefined();
    expect(r.prefs.types.hack).toBeUndefined();
    expect(r.prefs.channels.email).toBe(false); // default bo'lib qoldi
  });

  it("setNotifPrefs: userId yo'q → no_user", async () => {
    const r = await setNotifPrefs({ channels: { email: true } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_user');
  });

  it("dispatchNotification: kanal routing prefs bo'yicha", async () => {
    // Default: telegram on, email off
    const d = await dispatchNotification({ userId, type: 'assignment', eventType: null });
    expect(d.ok).toBe(true);
    expect(d.channels).toEqual(['telegram']);
    expect(d.forced).toBe(false);

    // Email yoqilganda ikkala kanal
    await setNotifPrefs({ userId, channels: { email: true } });
    const both = await dispatchNotification({ userId, type: 'assignment', eventType: null });
    expect(both.channels).toContain('telegram');
    expect(both.channels).toContain('email');

    // Type o'chirilganda yuborilmaydi
    await setNotifPrefs({ userId, types: { assignment: false } });
    const off = await dispatchNotification({ userId, type: 'assignment', eventType: null });
    expect(off.ok).toBe(false);
    expect(off.channels).toEqual([]);
    expect(off.error).toBe('type_disabled');
  });

  it("dispatchNotification: security hodisasi forced — kanal off bo'lsa ham email fallback", async () => {
    // Email OFF, telegram OFF (hammasi o'chirilgan bo'lsa ham)
    await setNotifPrefs({ userId, channels: { telegram: false, email: false, push: false } });
    const r = await dispatchNotification({ userId, type: 'security', eventType: 'new_device' });
    expect(r.ok).toBe(true);
    expect(r.forced).toBe(true);
    expect(r.channels).toContain('email'); // security fallback
    // Aniq eventType'lar ham forced
    for (const ev of ['password_changed', 'email_changed', 'suspicious', 'breach']) {
      const r2 = await dispatchNotification({ userId, type: 'security', eventType: ev });
      expect(r2.forced).toBe(true);
    }
  });

  it("checkNotifRate: sutkalik cap + 24h dedupe", async () => {
    const ch = 'email';
    // Dastlab allowed
    const a1 = await checkNotifRate({ userId, channel: ch, type: 'result' });
    expect(a1.allowed).toBe(true);
    // Cap: 3 tadan keyin block
    for (let i = 0; i < 3; i++) {
      await recordNotifSent({ userId, channel: ch, type: `t${i}` });
    }
    const blocked = await checkNotifRate({ userId, channel: ch, type: 'new' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('daily_cap');
    // Dedupe: bir xil type 24h ichida takrorlansa
    const cap = _notifConfig();
    // state'ni tozalash uchun boshqa kanal
    const a2 = await checkNotifRate({ userId, channel: 'push', type: 'result' });
    expect(a2.allowed).toBe(true);
    await recordNotifSent({ userId, channel: 'push', type: 'result' });
    const d1 = await checkNotifRate({ userId, channel: 'push', type: 'result' });
    expect(d1.allowed).toBe(false);
    expect(d1.reason).toBe('dedupe_24h');
  });
});
