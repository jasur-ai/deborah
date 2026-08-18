/**
 * AUTH A-09 — New-device detection & suspicious activity (unit)
 * -------------------------------------------------------------------
 * Qamrov (guide A-09 §20-§22):
 *  - evaluateNewDevice: last_login_ip_hash + session record bilan solishtirish
 *  - Dedupe: 24 soatda 1 marta; Cap: kuniga ≤2
 *  - Suspicious rules: geo o'zgarish (2 soat), tez login (≥3 IP/10 daq), ko'p qurilma
 *  - Preview: sensitive yo'q (ipHash/to'liq IP/raw UA chiqmaydi)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import {
  evaluateNewDevice,
  evaluateSuspicious,
  queueNewDeviceAlert,
  deliverAlert,
  buildAlertPreview,
  ipHash,
  parseDevice,
} from '../../src/modules/auth/new-device.js';
import { cityFromIp } from '../../src/modules/auth/geo-lite.js';

beforeAll(async () => {
  snapshotDb();
}, 30000);

afterAll(async () => {
  restoreDb();
});

const TEST_USER = 'a09_unit_user';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
const UA_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

/** Test user record + last_login_ip_hash o'rnatish. */
async function seedUser(userKey = TEST_USER, { lastIp, city, lastLoginAt } = {}) {
  await fb.set(`users/${userKey}`, {
    username: userKey,
    password: '$argon2id$v=19$m=65536,p=4,t=3$u1kus5wly9Ue/tfOGXv22w$cKyecI4i1mfK4fQOKglk6jroNJBXOs+bGMM5LHd1FFw',
    created_at: Date.now(),
    isVip: false,
    last_login_ip_hash: lastIp ? ipHash(lastIp) : null,
    last_city: city || null,
    last_login_at: lastLoginAt || Date.now(),
  });
}

describe('evaluateNewDevice — §6', () => {
  it('bir xil IP → yangi emas (last_login_ip_hash bilan mos)', async () => {
    await seedUser('nd_sameip', { lastIp: '203.0.113.5' });
    const r = await evaluateNewDevice({ userId: 'nd_sameip', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    expect(r.isNew).toBe(false);
  });

  it('boshqa IP + boshqa UA → yangi qurilma', async () => {
    await seedUser('nd_newip', { lastIp: '203.0.113.5', city: 'Toshkent' });
    const r = await evaluateNewDevice({ userId: 'nd_newip', ipAddress: '198.51.100.9', userAgent: UA_WINDOWS });
    expect(r.isNew).toBe(true);
    expect(r.reason).toBe('unseen_device');
  });

  it('session record\'da tanish UA bo\'lsa → yangi emas (NAT IP o\'zgarishi)', async () => {
    await seedUser('nd_knownua', { lastIp: '203.0.113.5' });
    // Mavjud session'da shu UA bor
    await fb.set(`sessions/nd_knownua/k1`, {
      sessionId: 'sess-k1', ipHash: ipHash('203.0.113.5'), userAgent: UA_ANDROID,
      createdAt: Date.now() - 1000, lastActiveAt: Date.now() - 1000,
    });
    const r = await evaluateNewDevice({ userId: 'nd_knownua', ipAddress: '203.0.113.99', userAgent: UA_ANDROID });
    expect(r.isNew).toBe(false);
  });

  it('birinchi login (record yo\'q) → yangi emas (FARQ qilmaydi)', async () => {
    const r = await evaluateNewDevice({ userId: 'nd_first', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    expect(r.isNew).toBe(false);
  });
});

describe('queueNewDeviceAlert — dedupe §11 + cap §30', () => {
  it('birinchi alert → queued, status queued', async () => {
    await seedUser('nd_queue1');
    const r = await queueNewDeviceAlert({ userId: 'nd_queue1', type: 'new_device', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    expect(r.queued).toBe(true);
    expect(r.alertId).toBeTruthy();
  });

  it('24 soat ichida takroriy → dedupe (queued false)', async () => {
    await seedUser('nd_dedupe');
    const r1 = await queueNewDeviceAlert({ userId: 'nd_dedupe', type: 'new_device', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    expect(r1.queued).toBe(true);
    const r2 = await queueNewDeviceAlert({ userId: 'nd_dedupe', type: 'new_device', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    expect(r2.queued).toBe(false);
    expect(r2.reason).toBe('dedupe_24h');
  });

  it('kuniga cap ≤2 — uchinchisi blok', async () => {
    await seedUser('nd_cap');
    // Ikkita xil tur (new_device + suspicious) → cap 2
    const r1 = await queueNewDeviceAlert({ userId: 'nd_cap', type: 'new_device', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    const r2 = await queueNewDeviceAlert({ userId: 'nd_cap', type: 'suspicious', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    expect(r1.queued).toBe(true);
    expect(r2.queued).toBe(true);
    const r3 = await queueNewDeviceAlert({ userId: 'nd_cap', type: 'new_device', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    expect(r3.queued).toBe(false);
    expect(r3.reason).toBe('daily_cap');
  });
});

describe('deliverAlert — channel §12 + preview §13', () => {
  it('delivered — channel telegram (default) + preview sensitive yo\'q', async () => {
    await seedUser('nd_deliver');
    const q = await queueNewDeviceAlert({ userId: 'nd_deliver', type: 'new_device', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    expect(q.queued).toBe(true);
    const d = await deliverAlert({ userId: 'nd_deliver', alertId: q.alertId });
    expect(d.ok).toBe(true);
    expect(d.channel).toBe('telegram');
    expect(d.preview.subject).toContain('Yangi qurilmadan');
    // Sensitive scan (§22): to'liq IP / ipHash / raw UA yo'q
    expect(d.preview.body).not.toContain('203.0.113');
    expect(d.preview.body).not.toContain('ipHash');
    expect(d.preview.body).not.toContain('Chrome/120');
    expect(d.preview.hasSensitive).toBe(false);
  });

  it('notif prefs: telegram OFF + email ON → channel email (B-21)', async () => {
    await seedUser('nd_email');
    // AUTH B-21: kanal endi notif_prefs orqali (settings.notifChannel emas)
    await fb.set('users/nd_email/notif_prefs', {
      channels: { telegram: false, email: true, push: false },
      types: { security: true },
      updated_at: Date.now(),
    });
    const q = await queueNewDeviceAlert({ userId: 'nd_email', type: 'suspicious', ipAddress: '203.0.113.5', userAgent: UA_ANDROID });
    const d = await deliverAlert({ userId: 'nd_email', alertId: q.alertId });
    expect(d.channel).toBe('email');
    expect(d.preview.subject).toContain('Shubhali faollik');
  });

  it('notif prefs: default (telegram ON) → channel telegram (B-21)', async () => {
    await seedUser('nd_tg');
    const q = await queueNewDeviceAlert({ userId: 'nd_tg', type: 'new_device', ipAddress: '203.0.113.6', userAgent: UA_ANDROID });
    const d = await deliverAlert({ userId: 'nd_tg', alertId: q.alertId });
    expect(d.channel).toBe('telegram');
  });
});

describe('evaluateSuspicious — §9 rules', () => {
  it('geo keskin o\'zgarish (2 soat ichida boshqa shahar) → suspicious', async () => {
    await seedUser('sp_geo', {
      lastIp: '203.0.113.5',
      city: 'Toshkent',
      lastLoginAt: Date.now() - 30 * 60 * 1000, // 30 daqiqa oldin
    });
    const r = await evaluateSuspicious({ userId: 'sp_geo', ipAddress: '198.51.100.7', userAgent: UA_WINDOWS });
    expect(r.suspicious).toBe(true);
    expect(r.rules).toContain('city_change_rapid');
  });

  it('bir shahar (o\'zgarish yo\'q) → suspicious emas', async () => {
    await seedUser('sp_samecity', { lastIp: '203.0.113.5', city: 'Toshkent', lastLoginAt: Date.now() - 30 * 60 * 1000 });
    const r = await evaluateSuspicious({ userId: 'sp_samecity', ipAddress: '203.0.113.9', userAgent: UA_WINDOWS });
    expect(r.suspicious).toBe(false);
  });

  it('tez ketma-ket login (10 daqiqada ≥3 IP) → rapid_distinct_ips', async () => {
    await seedUser('sp_rapid');
    const now = Date.now();
    for (const [i, ip] of ['203.0.113.1', '198.51.100.2', '198.51.100.3'].entries()) {
      await fb.set(`sessions/sp_rapid/k${i}`, {
        sessionId: `sess-${i}`, ipHash: ipHash(ip), userAgent: UA_ANDROID,
        createdAt: now - 60_000 * i, lastActiveAt: now - 60_000 * i,
      });
    }
    const r = await evaluateSuspicious({ userId: 'sp_rapid', ipAddress: '203.0.113.9', userAgent: UA_WINDOWS });
    expect(r.suspicious).toBe(true);
    expect(r.rules).toContain('rapid_distinct_ips');
  });

  it('ko\'p qurilma (≥5 session, ≥3 xil UA) → many_devices', async () => {
    await seedUser('sp_many');
    const now = Date.now();
    const uas = [UA_ANDROID, UA_WINDOWS, 'Firefox/120 Mac'];
    for (let i = 0; i < 5; i++) {
      await fb.set(`sessions/sp_many/k${i}`, {
        sessionId: `sess-${i}`, ipHash: ipHash(`203.0.113.${i}`), userAgent: uas[i % uas.length],
        createdAt: now - 3600_000 * i, lastActiveAt: now - 3600_000 * i,
      });
    }
    const r = await evaluateSuspicious({ userId: 'sp_many', ipAddress: '203.0.113.9', userAgent: UA_WINDOWS });
    expect(r.suspicious).toBe(true);
    expect(r.rules).toContain('many_devices');
  });
});

describe('geo-lite — §29 shahar aniqlash', () => {
  it('RFC5737 prefix → shahar', () => {
    expect(cityFromIp('203.0.113.42')).toBe('Toshkent');
    expect(cityFromIp('198.51.100.42')).toBe('Samarqand');
  });
  it('noma\'lum / null → null', () => {
    expect(cityFromIp('8.8.8.8')).toBeNull();
    expect(cityFromIp(null)).toBeNull();
  });
});

describe('buildAlertPreview — §13 sensitive scan', () => {
  it('hech qachon ipHash/to\'liq IP/raw UA qaytarmaydi', () => {
    const alert = {
      type: 'new_device',
      device: 'Android',
      browser: 'Chrome',
      city: 'Toshkent',
      ipHash: 'a'.repeat(64),
      time: Date.now(),
      lang: 'uz',
    };
    const p = buildAlertPreview(alert, 'uz');
    const full = `${p.subject} ${p.body} ${p.device} ${p.city} ${p.time}`;
    expect(full).not.toMatch(/[a-f0-9]{64}/); // ipHash pattern
    expect(full).not.toContain('Chrome/120');
    expect(full).not.toContain('ipHash');
  });
});

describe('parseDevice', () => {
  it('Android + Chrome parse', () => {
    const { device, browser } = parseDevice(UA_ANDROID);
    expect(device).toBe('Android');
    expect(browser).toBe('Chrome');
  });
});
