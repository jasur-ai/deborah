/**
 * Edikit — E-02: HEMIS push webhook testlari
 * ---------------------------------------------------------------------------
 * HMAC signature, IP allowlist, idempotency, event allowlist — hermetic (in-memory mock).
 */
import { describe, it, expect } from 'vitest';
import {
  computeHmac,
  verifyHmac,
  isWebhookIpAllowed,
  validateWebhookPayload,
  isEventProcessed,
  processHemisWebhook,
  scheduleWebhookRetry,
  getDueWebhookRetries,
  HEMIS_PUSH_EVENTS,
  HEMIS_MAX_ATTEMPTS,
} from '../../../src/modules/hemis/webhook.js';

/** In-memory mock Firebase (identity-e01 testlaridagi kabi). */
function createMockDb() {
  const store = new Map();
  const deepGet = (p) => {
    const seg = p.split('/');
    let cur = store.get(seg[0]);
    for (let i = 1; i < seg.length && cur !== undefined && cur !== null; i++) cur = cur[seg[i]];
    return cur;
  };
  const deepSet = (p, v) => {
    const seg = p.split('/');
    if (seg.length === 1) { store.set(seg[0], v); return; }
    const first = seg[0];
    let obj = store.get(first);
    if (obj === undefined || obj === null || typeof obj !== 'object') { obj = {}; store.set(first, obj); }
    let cur = obj;
    for (let i = 1; i < seg.length - 1; i++) {
      if (cur[seg[i]] === undefined || typeof cur[seg[i]] !== 'object') cur[seg[i]] = {};
      cur = cur[seg[i]];
    }
    cur[seg[seg.length - 1]] = v;
  };
  return {
    set: async (p, v) => { deepSet(p, v); return {}; },
    get: async (p) => ({
      exists: () => deepGet(p) !== undefined,
      val: () => (deepGet(p) === undefined ? null : deepGet(p)),
    }),
    remove: async (p) => {
      const seg = p.split('/');
      if (seg.length === 1) { store.delete(seg[0]); return; }
      const obj = store.get(seg[0]);
      if (obj && typeof obj === 'object') delete obj[seg[seg.length - 1]];
      return {};
    },
  };
}

const SECRET = 'test-hemis-secret';
const validPayload = {
  event_id: 'evt-001',
  event: HEMIS_PUSH_EVENTS.STUDENTS_UPDATED,
  data: { groupId: 'g1', changed: ['u1'] },
};

function rawOf(payload) {
  return JSON.stringify(payload);
}

describe('E-02 HEMIS push webhook', () => {
  it("1) computeHmac/verifyHmac - correct signature accepted", async () => {
    const raw = rawOf(validPayload);
    const sig = computeHmac(raw, SECRET);
    expect(verifyHmac(raw, sig, SECRET)).toBe(true);
  });

  it("2) verifyHmac - wrong signature rejected", async () => {
    const raw = rawOf(validPayload);
    expect(verifyHmac(raw, 'deadbeef', SECRET)).toBe(false);
  });

  it("3) verifyHmac - missing secret or signature returns false", async () => {
    const raw = rawOf(validPayload);
    expect(verifyHmac(raw, 'anything', '')).toBe(false);
    expect(verifyHmac(raw, '', SECRET)).toBe(false);
  });

  it("4) isWebhookIpAllowed - no allowlist allows", () => {
    expect(isWebhookIpAllowed('1.2.3.4', {})).toBe(true);
    expect(isWebhookIpAllowed(null, {})).toBe(false);
  });

  it("5) isWebhookIpAllowed - allowlist in/out", () => {
    const env = { HEMIS_WEBHOOK_IP_ALLOWLIST: '10.0.0.1,10.0.0.2' };
    expect(isWebhookIpAllowed('10.0.0.1', env)).toBe(true);
    expect(isWebhookIpAllowed('8.8.8.8', env)).toBe(false);
  });

  it("6) validateWebhookPayload - valid payload ok", () => {
    expect(validateWebhookPayload(validPayload).ok).toBe(true);
  });

  it("7) validateWebhookPayload - disallowed event rejected", () => {
    const p = { ...validPayload, event: 'scores.delete' };
    expect(validateWebhookPayload(p).ok).toBe(false);
    expect(validateWebhookPayload(p).error).toBe('event-not-allowed');
  });

  it("8) validateWebhookPayload - missing event_id rejected", () => {
    const { event_id, ...p } = validPayload;
    expect(validateWebhookPayload(p).ok).toBe(false);
  });

  it("9) processHemisWebhook - full flow: HMAC + log + audit", async () => {
    const db = createMockDb();
    const raw = rawOf(validPayload);
    const sig = computeHmac(raw, SECRET);
    const r = await processHemisWebhook(raw, {
      signature: sig,
      secret: SECRET,
      fbGet: db.get,
      fbSet: db.set,
      env: {},
    });
    expect(r.ok).toBe(true);
    expect(r.event).toBe(HEMIS_PUSH_EVENTS.STUDENTS_UPDATED);
    const log = await db.get('hemis_webhook_log/evt-001');
    expect(log.exists()).toBe(true);
    expect(log.val().processed).toBe(true);
  });

  it("10) processHemisWebhook - idempotency: duplicate", async () => {
    const db = createMockDb();
    const raw = rawOf(validPayload);
    const sig = computeHmac(raw, SECRET);
    await processHemisWebhook(raw, { signature: sig, secret: SECRET, fbGet: db.get, fbSet: db.set, env: {} });
    const r2 = await processHemisWebhook(raw, { signature: sig, secret: SECRET, fbGet: db.get, fbSet: db.set, env: {} });
    expect(r2.ok).toBe(true);
    expect(r2.duplicate).toBe(true);
  });

  it("11) processHemisWebhook - bad signature rejected", async () => {
    const db = createMockDb();
    const raw = rawOf(validPayload);
    const r = await processHemisWebhook(raw, {
      signature: 'bad',
      secret: SECRET,
      fbGet: db.get,
      fbSet: db.set,
      env: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid-signature');
  });

  it("12) processHemisWebhook - IP allowlist rejects", async () => {
    const db = createMockDb();
    const raw = rawOf(validPayload);
    const sig = computeHmac(raw, SECRET);
    const r = await processHemisWebhook(raw, {
      signature: sig,
      secret: SECRET,
      ip: '8.8.8.8',
      env: { HEMIS_WEBHOOK_IP_ALLOWLIST: '10.0.0.1' },
      fbGet: db.get,
      fbSet: db.set,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ip-not-allowed');
  });

  it("13) processHemisWebhook - invalid JSON", async () => {
    const db = createMockDb();
    const r = await processHemisWebhook('not-json{', {
      skipVerify: true,
      fbGet: db.get,
      fbSet: db.set,
      env: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid-json');
  });

  it("14) processHemisWebhook - event not allowed", async () => {
    const db = createMockDb();
    const p = { ...validPayload, event: 'hack.attempt' };
    const raw = rawOf(p);
    const r = await processHemisWebhook(raw, {
      skipVerify: true,
      fbGet: db.get,
      fbSet: db.set,
      env: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('event-not-allowed');
  });

  it("15) isEventProcessed - processed event true, unknown false", async () => {
    const db = createMockDb();
    await db.set('hemis_webhook_log/evt-999', { processed: true });
    expect(await isEventProcessed('evt-999', { fbGet: db.get })).toBe(true);
    expect(await isEventProcessed('evt-000', { fbGet: db.get })).toBe(false);
  });

  it("16) scheduleWebhookRetry - rejali retry (backoff)", async () => {
    const db = createMockDb();
    const before = Date.now();
    const r = await scheduleWebhookRetry({ eventId: 'evt-r1', event: 'scores.updated', data: { s: 1 }, attempts: 1 }, { fbSet: db.set });
    expect(r.ok).toBe(true);
    expect(r.nextRetryAt).toBeGreaterThanOrEqual(before + 60_000);
    const log = await db.get('hemis_webhook_log/evt-r1');
    expect(log.val().status).toBe('retry');
    expect(log.val().attempts).toBe(1);
  });

  it("17) scheduleWebhookRetry - max attempts -> deadletter", async () => {
    const db = createMockDb();
    const r = await scheduleWebhookRetry({ eventId: 'evt-dl', event: 'scores.updated', data: {}, attempts: HEMIS_MAX_ATTEMPTS + 1 }, { fbSet: db.set });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('max-attempts');
    const log = await db.get('hemis_webhook_log/evt-dl');
    expect(log.val().status).toBe('deadletter');
  });

  it("18) getDueWebhookRetries - muddati yetganlarni qaytaradi", async () => {
    const db = createMockDb();
    await db.set('hemis_webhook_log/evt-due1', { status: 'retry', event: 'scores.updated', data: {}, nextRetryAt: 1000, attempts: 1 });
    await db.set('hemis_webhook_log/evt-due2', { status: 'retry', event: 'students.updated', data: {}, nextRetryAt: 999, attempts: 2 });
    await db.set('hemis_webhook_log/evt-future', { status: 'retry', event: 'scores.updated', data: {}, nextRetryAt: Date.now() + 999_999, attempts: 1 });
    await db.set('hemis_webhook_log/evt-done', { status: 'processed', event: 'scores.updated', data: {}, nextRetryAt: 1, attempts: 1 });
    const due = await getDueWebhookRetries(5000, { fbGet: db.get });
    expect(due.length).toBe(2);
    const ids = due.map((d) => d.eventId).sort();
    expect(ids).toEqual(['evt-due1', 'evt-due2']);
  });

  it("19) getDueWebhookRetries - bo'sh log -> []", async () => {
    const db = createMockDb();
    expect(await getDueWebhookRetries(5000, { fbGet: db.get })).toEqual([]);
  });
});
