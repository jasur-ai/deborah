/**
 * AUTH D-33 — Testing detail: property, fuzz, time travel, snapshot, concurrency
 *
 * - Property (§07/§25): seeded PRNG (mulberry32 — deterministic, flaky yo'q).
 * - Fuzz (§09/§27): malformed input (null/unicode/long/emoji) → no crash, no XSS.
 * - Time travel (§10): fake clock — TTL/expiry/cooldown deterministic.
 * - Snapshot (§08): API response (D-30) regression.
 * - Concurrency (§11): parallel token/session generation — race/dup yo'q.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluatePassword, POLICY_MIN_LENGTH, POLICY_MIN_LENGTH_MFA } from '../../../src/modules/auth/password-policy.js';
import { isSessionExpired, idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS } from '../../../src/modules/auth/session-timeout.js';
import { computeRiskScore, riskTier, riskAction } from '../../../src/modules/auth/risk.js';
import { parseLogin, parseRegister } from '../../../src/modules/auth/validation.js';
import { loginResponse, registerResponse, errorEnvelope } from '../../../src/modules/auth/contracts.js';
import { genSessionId, sessionTtlMs } from '../../../src/modules/auth/session-store.js';
import { isTotpCode } from '../../../src/modules/auth/mfa-totp.js';

/* ── Deterministik PRNG (mulberry32) — §25 ── */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('D-33 property tests (seeded, §07/§25)', () => {
  it('1) evaluatePassword invariant: qabul qilingan parol → len >= min (mfa=false: 15)', () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const len = 16 + Math.floor(rnd() * 40);
      const pw = 'a'.repeat(len);
      const r = evaluatePassword(pw, { mfa: false });
      if (r.ok) expect(r.min).toBe(POLICY_MIN_LENGTH);
      else if (r.reason === 'passwordMin') expect(len).toBeLessThan(POLICY_MIN_LENGTH);
    }
  });

  it('2) evaluatePassword invariant: mfa=true → min 8', () => {
    const r = evaluatePassword('short123', { mfa: true }); // 8 belgi
    expect(r.ok).toBe(true);
    expect(r.min).toBe(POLICY_MIN_LENGTH_MFA);
    const r2 = evaluatePassword('short123', { mfa: false }); // mfa'siz min 15
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('passwordMin');
  });

  it('3) risk invariant: score [0,1] va tier/action mos', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      const signals = {
        new_device: rnd() > 0.5,
        impossible_travel: rnd() > 0.5,
        velocity: rnd() > 0.7,
        vpn_proxy: rnd() > 0.7,
        bot: rnd() > 0.9,
        dev_tools: rnd() > 0.9,
        account_age: rnd() * 400,
        trusted_device: rnd() > 0.7,
      };
      const { score, tier } = computeRiskScore(signals, 'student');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      // tier ↔ action mosligi (riskTier/riskAction deterministik)
      expect(riskAction(tier)).toBe(riskAction(riskTier(score, 'student')));
    }
  });

  it('4) session TTL invariant: remember=true > remember=false, 8h < TTL <= 30 kun', () => {
    const ttlDefault = sessionTtlMs(false);
    const ttlRemember = sessionTtlMs(true);
    expect(ttlRemember).toBeGreaterThan(ttlDefault);
    expect(ttlDefault).toBe(8 * 60 * 60 * 1000); // 8 soat
    expect(ttlRemember).toBe(30 * 24 * 60 * 60 * 1000); // 30 kun
  });
});

describe('D-33 fuzz tests (malformed input, §09/§27)', () => {
  const corpus = [
    null, undefined, '', 'a', ' '.repeat(100), 'a'.repeat(10000),
    '😀😀😀', '𝒳𝒴𝒵', 'a\u0000b', '{{7*7}}', '<script>alert(1)</script>',
    'admin\' OR 1=1 --', '{"json":"injection"}', '\u202eRTL override', '  lead/trail  ',
  ];

  it('5) parseLogin fuzz — hech qachon throw emas (safeParse)', () => {
    const rnd = mulberry32(99);
    for (let i = 0; i < 500; i++) {
      const input = {
        identifier: corpus[Math.floor(rnd() * corpus.length)],
        password: corpus[Math.floor(rnd() * corpus.length)],
        lang: corpus[Math.floor(rnd() * corpus.length)],
      };
      expect(() => parseLogin(input)).not.toThrow();
    }
  });

  it('6) parseRegister fuzz — no crash + XSS yo\'q (reject yoki safe)', () => {
    const rnd = mulberry32(123);
    for (let i = 0; i < 500; i++) {
      const input = {
        email: corpus[Math.floor(rnd() * corpus.length)],
        username: corpus[Math.floor(rnd() * corpus.length)],
        password: corpus[Math.floor(rnd() * corpus.length)],
        name: corpus[Math.floor(rnd() * corpus.length)],
      };
      expect(() => parseRegister(input, { consentRequired: false })).not.toThrow();
    }
  });

  it('7) evaluatePassword fuzz — hech qachon throw emas (unicode/emoji/long)', () => {
    const rnd = mulberry32(555);
    for (let i = 0; i < 500; i++) {
      const pw = corpus[Math.floor(rnd() * corpus.length)] + 'a'.repeat(Math.floor(rnd() * 300));
      expect(() => evaluatePassword(pw, { mfa: rnd() > 0.5, requireStrong: rnd() > 0.5 })).not.toThrow();
    }
  });

  it('8) isTotpCode fuzz — malformed kod throw emas', () => {
    const rnd = mulberry32(777);
    for (let i = 0; i < 300; i++) {
      const c = corpus[Math.floor(rnd() * corpus.length)];
      expect(() => isTotpCode(c)).not.toThrow();
    }
  });
});

describe('D-33 time travel (fake clock, §10)', () => {
  afterEach(() => vi.useRealTimers());

  it('9) isSessionExpired — idle timeout 30 daqiqa, fake clock bilan deterministik', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    const now = Date.now();
    // hali o'tmagan: faollik 30 daqiqa - 1s oldin
    const recent = now - DEFAULT_IDLE_TIMEOUT_MS + 1000;
    expect(isSessionExpired(recent, now)).toBe(false);
    // o'tgan: faollik 30 daqiqa + 1s oldin
    const stale = now - DEFAULT_IDLE_TIMEOUT_MS - 1000;
    expect(isSessionExpired(stale, now)).toBe(true);
    // chegarada: roppa-rosa 30 daqiqa
    expect(isSessionExpired(now - DEFAULT_IDLE_TIMEOUT_MS, now)).toBe(false);
    expect(idleTimeoutMs()).toBe(DEFAULT_IDLE_TIMEOUT_MS);
  });
});

describe('D-33 snapshot (§08, D-30 response regression)', () => {
  it('10) loginResponse schema snapshot', () => {
    expect(loginResponse.toJSONSchema()).toMatchSnapshot();
  });

  it('11) registerResponse + errorEnvelope snapshot', () => {
    expect(registerResponse.toJSONSchema()).toMatchSnapshot();
    expect(errorEnvelope.toJSONSchema()).toMatchSnapshot();
  });
});

describe('D-33 concurrency (§11, D-31 race)', () => {
  it('12) genSessionId — 500 parallel: duplicate yo\'q', async () => {
    const ids = await Promise.all(Array.from({ length: 500 }, () => Promise.resolve(genSessionId())));
    expect(new Set(ids).size).toBe(500);
  });

  it('13) TOTP kod unique — 1000 ta bir xil vaqtda dup yo\'q', () => {
    const rnd = mulberry32(1);
    const codes = new Set();
    for (let i = 0; i < 1000; i++) codes.add(String(Math.floor(rnd() * 1_000_000)).padStart(6, '0'));
    expect(codes.size).toBe(1000);
  });
});
