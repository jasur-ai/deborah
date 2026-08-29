/**
 * Deborah — AUTH A-29 Account security events — Unit tests
 * ---------------------------------------------------------------
 *  - recordAccountEvent → users.{id}.security_events (PII-minimal)
 *  - getAccountEvents: faqat agregatlar (ip_hash/raw UA/email YO'Q), sort, cap
 *  - Retention: EVENTS_MAX dan oshsa eskilari o'chiriladi
 *  - Breach flag: set/clear/get
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const testStore = {};

vi.mock('../../firebase/admin.js', () => {
  function navigate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
      if (current === null || typeof current !== 'object' || !(parts[i] in current))
        return { found: false, parent: current, key: parts[i] };
      if (i === parts.length - 1) return { found: true, value: current[parts[i]], parent: current, key: parts[i] };
      current = current[parts[i]];
    }
    return { found: true, value: current, parent: null, key: null };
  }
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => {
        const parts = path.split('/').filter(Boolean);
        let cur = testStore;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
      }),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach((k) => delete testStore[k]);
      }),
    },
    default: {},
  };
});

import {
  recordAccountEvent,
  getAccountEvents,
  setBreachFlag,
  clearBreachFlag,
  getBreachFlag,
  _accountEventsConfig,
} from '../../src/modules/auth/account-events.js';
import { fb } from '../../firebase/admin.js';

const USER = 'u1';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('recordAccountEvent — security events feed', () => {
  it('event record yoziladi — agregatlar saqlanadi (raw IP/UA yo\'q)', async () => {
    const r = await recordAccountEvent({
      userId: USER,
      type: 'password_changed',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36',
    });
    expect(r.ok).toBe(true);

    const snap = await fb.get(`users/${USER}/security_events`);
    expect(snap.exists()).toBe(true);
    const all = snap.val();
    const ids = Object.keys(all);
    expect(ids).toHaveLength(1);
    const ev = all[ids[0]];
    expect(ev.type).toBe('password_changed');
    expect(ev.device).toBe('Windows');
    expect(ev.browser).toBe('Chrome');
    expect(ev.city).toBe('Toshkent'); // 203.0.113.x → geo-lite
    expect(ev.ts).toBeTypeOf('number');
    // PII invariant: raw IP / to'liq UA / email record'da emas
    expect(JSON.stringify(ev)).not.toContain('203.0.113.7');
    expect(JSON.stringify(ev)).not.toContain('Mozilla/5.0');
  });

  it('getAccountEvents — PII-minimal ko\'rinish (ip_hash/raw UA YO\'Q), eng yangi birinchi', async () => {
    // Aniq ts — bir xil millisekundda yozilsa ham order barqaror
    await recordAccountEvent({ userId: USER, type: 'login_new_device', ipAddress: '203.0.113.5', ts: 1000 });
    await recordAccountEvent({ userId: USER, type: 'password_changed', ipAddress: '203.0.113.6', ts: 2000 });

    const events = await getAccountEvents(USER);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('password_changed'); // eng yangi
    expect(events[1].type).toBe('login_new_device');
    for (const e of events) {
      expect(JSON.stringify(e)).not.toContain('203.0.113.');
      expect(e.id).toBeTypeOf('string');
      expect(e.ts).toBeTypeOf('number');
    }
  });

  it('retention: EVENTS_MAX (50) dan oshsa eng eskilari o\'chiriladi', async () => {
    // 55 ta event yozamiz (turli ts simulatsiya — ketma-ket ts yaxshi emas,
    // shuning uchun pastki ts bilan oldin yozamiz: yozilish tartibi ts bo'yicha)
    for (let i = 0; i < 55; i++) {
      await recordAccountEvent({ userId: USER, type: `t_${i}`, ipAddress: '203.0.113.1' });
    }
    const events = await getAccountEvents(USER, 100);
    expect(events.length).toBeLessThanOrEqual(50);
    const snap = await fb.get(`users/${USER}/security_events`);
    expect(Object.keys(snap.val() || {})).toHaveLength(50);
    // Eng eskisi (t_0) o'chirilgan, eng yangilari qolgan
    expect(events.some((e) => e.type === 't_0')).toBe(false);
  });

  it('details whitelist — faqat ruxsat etilgan maydonlar saqlanadi', async () => {
    await recordAccountEvent({
      userId: USER,
      type: 'email_change_failed',
      details: { method: 'code', reason: 'expired', secret: 'SHOULD_NOT_STORE' },
    });
    const events = await getAccountEvents(USER);
    expect(events[0].detail.reason).toBe('expired');
    expect(events[0].detail.method).toBe('code');
    expect('secret' in events[0].detail).toBe(false);
    expect(JSON.stringify(events)).not.toContain('SHOULD_NOT_STORE');
  });
});

describe('breach flag — HIBP P1', () => {
  it('set → get qaytaradi; clear → null', async () => {
    expect(await getBreachFlag(USER)).toBeNull();
    await setBreachFlag(USER);
    expect(await getBreachFlag(USER)).toBeTypeOf('number');
    await clearBreachFlag(USER);
    expect(await getBreachFlag(USER)).toBeNull();
  });
});

describe('config', () => {
  it('EVENTS_MAX = 50', () => {
    expect(_accountEventsConfig().EVENTS_MAX).toBe(50);
  });
});
