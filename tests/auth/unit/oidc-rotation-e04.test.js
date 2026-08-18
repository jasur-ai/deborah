/**
 * Deborah — E-04a: JWKS key rotation monitoring (oidc.js)
 * ---------------------------------------------------------------------------
 * Yangi `kid` paydo bo'lsa → `oidc:jwks:rotated` audit event; grace window
 * 24 soat; JWKS unreachable → fail-soft (verify keyin hal qiladi).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchJwksKids,
  watchJwksRotation,
  getJwksRotationStatus,
  _resetJwksRotationState,
} from '../../../src/modules/auth/oidc.js';

function mockFetch(keys, { fail = false } = {}) {
  return async () => {
    if (fail) throw new Error('network down');
    return {
      ok: true,
      json: async () => ({ keys }),
    };
  };
}

describe('E-04a — JWKS key rotation monitoring', () => {
  beforeEach(() => {
    _resetJwksRotationState();
  });

  it('1) fetchJwksKids — kid\'lar ro\'yxatini oladi', async () => {
    const kids = await fetchJwksKids({ fetchFn: mockFetch([{ kid: 'k1' }, { kid: 'k2' }]) });
    expect(kids).toEqual(['k1', 'k2']);
  });

  it('2) fetchJwksKids — keys yo\'q bo\'lsa bo\'sh qaytaradi', async () => {
    const kids = await fetchJwksKids({ fetchFn: mockFetch([]) });
    expect(kids).toEqual([]);
  });

  it('3) fetchJwksKids — network fail → fail-soft bo\'sh qaytaradi', async () => {
    const kids = await fetchJwksKids({ fetchFn: mockFetch([], { fail: true }) });
    expect(kids).toEqual([]);
  });

  it('4) watchJwksRotation — birinchi ko\'rinish rotation hisoblanadi', async () => {
    const r1 = await watchJwksRotation({ fetchFn: mockFetch([{ kid: 'k1' }]), now: 1000 });
    expect(r1.rotated).toBe(true);
    expect(r1.newKids).toEqual(['k1']);
  });

  it('5) watchJwksRotation — bir xil kid qayta kelsa rotation YO\'Q', async () => {
    await watchJwksRotation({ fetchFn: mockFetch([{ kid: 'k1' }]), now: 1000 });
    const r2 = await watchJwksRotation({ fetchFn: mockFetch([{ kid: 'k1' }]), now: 2000 });
    expect(r2.rotated).toBe(false);
    expect(r2.newKids).toEqual([]);
  });

  it('6) watchJwksRotation — yangi kid qo\'shilsa rotation + audit', async () => {
    await watchJwksRotation({ fetchFn: mockFetch([{ kid: 'k1' }]), now: 1000 });
    const r2 = await watchJwksRotation({ fetchFn: mockFetch([{ kid: 'k1' }, { kid: 'k2' }]), now: 5000 });
    expect(r2.rotated).toBe(true);
    expect(r2.newKids).toEqual(['k2']);
  });

  it('7) getJwksRotationStatus — grace window 24h ichida inGrace true', async () => {
    await watchJwksRotation({ fetchFn: mockFetch([{ kid: 'k1' }]), now: 1000 });
    const status = getJwksRotationStatus({ now: 1000 + 23 * 3600 * 1000 }); // 23 soat keyin
    expect(status.inGrace).toBe(true);
    expect(status.lastRotationAt).toBe(1000);
    expect(status.seenKids).toEqual(['k1']);
  });

  it('8) getJwksRotationStatus — 24h dan keyin inGrace false', async () => {
    await watchJwksRotation({ fetchFn: mockFetch([{ kid: 'k1' }]), now: 1000 });
    const status = getJwksRotationStatus({ now: 1000 + 25 * 3600 * 1000 }); // 25 soat keyin
    expect(status.inGrace).toBe(false);
  });

  it('9) watchJwksRotation — JWKS unreachable → rotated false (fail-soft)', async () => {
    const r = await watchJwksRotation({ fetchFn: mockFetch([], { fail: true }), now: 1000 });
    expect(r.rotated).toBe(false);
    expect(r.kids).toEqual([]);
  });
});
