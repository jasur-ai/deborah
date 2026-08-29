/**
 * AUTH D-19 §08/§17 — Auth load SLO unit testlari.
 * ---------------------------------------------------------------------------
 *  - 4 profil: login-storm (5000), teacher (1000), mfa-storm, forgot-storm.
 *  - loginP95Ms < 2000ms (exam start SLO).
 *  - errorRate < 0.1%.
 *  - falseLockouts = 0 (kampus NAT — bir ASN ko'p IP, C-01).
 */

import { describe, it, expect } from 'vitest';
import { AUTH_LOAD_PROFILES, evaluateAuthLoadSlo } from '../../../src/modules/reliability/reliability.schema.js';

describe('AUTH D-19 §06 — auth load profillari mavjud', () => {
  it('4 ta profil: login-storm / teacher / mfa / forgot', () => {
    const ids = AUTH_LOAD_PROFILES.map((p) => p.id);
    expect(ids).toEqual([
      'auth-login-storm',
      'auth-teacher-login',
      'auth-mfa-storm',
      'auth-forgot-storm',
    ]);
  });

  it('login-storm: 5000 talaba, SLO p95 < 2000ms, error < 0.1%, lockout 0', () => {
    const p = AUTH_LOAD_PROFILES[0];
    expect(p.expected.concurrentLogins).toBe(5000);
    expect(p.slo.loginP95Ms).toBe(2000);
    expect(p.slo.errorRate).toBe(0.001);
    expect(p.slo.falseLockouts).toBe(0);
  });
});

describe('AUTH D-19 §08 — SLO evaluation', () => {
  it('yaxshi ko\'rsatkichlar (p95 1500, error 0.0005, lockout 0) → PASS', () => {
    const r = evaluateAuthLoadSlo({
      profileId: 'auth-login-storm',
      observed: { loginP95Ms: 1500, errorRate: 0.0005, falseLockouts: 0 },
    });
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('p95 2500 (> 2000 SLO) → FAIL (loginP95Ms)', () => {
    const r = evaluateAuthLoadSlo({
      profileId: 'auth-login-storm',
      observed: { loginP95Ms: 2500, errorRate: 0.0005, falseLockouts: 0 },
    });
    expect(r.ok).toBe(false);
    const c = r.checks.find((x) => x.name === 'loginP95Ms');
    expect(c.ok).toBe(false);
    expect(c.observed).toBe(2500);
    expect(c.target).toBe(2000);
  });

  it('errorRate 0.01 (1% > 0.1%) → FAIL', () => {
    const r = evaluateAuthLoadSlo({
      profileId: 'auth-teacher-login',
      observed: { loginP95Ms: 1500, errorRate: 0.01, falseLockouts: 0 },
    });
    expect(r.ok).toBe(false);
    expect(r.checks.find((x) => x.name === 'errorRate').ok).toBe(false);
  });

  it('falseLockouts 1 → FAIL + kampus NAT securityGuard (C-01)', () => {
    const r = evaluateAuthLoadSlo({
      profileId: 'auth-login-storm',
      observed: { loginP95Ms: 1500, errorRate: 0.0005, falseLockouts: 1 },
    });
    expect(r.ok).toBe(false);
    expect(r.securityGuard).toContain('false-lockout');
    expect(r.securityGuard).toContain('C-01');
  });

  it('noma\'lum profil → error', () => {
    const r = evaluateAuthLoadSlo({ profileId: 'auth-nope', observed: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Unknown auth load profile');
  });

  it('barcha 4 profil synthetic default (p95 1500) bilan PASS', () => {
    for (const p of AUTH_LOAD_PROFILES) {
      const r = evaluateAuthLoadSlo({
        profileId: p.id,
        observed: { loginP95Ms: 1500, errorRate: 0.0005, falseLockouts: 0 },
      });
      expect(r.ok, `${p.id} PASS bo'lishi kerak`).toBe(true);
    }
  });
});
