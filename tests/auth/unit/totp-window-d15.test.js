/**
 * AUTH D-15 §09 — TOTP valid_window=1 boundary (wsl qo'shimchasi)
 * -----------------------------------------------------------------
 *  - verifyTotpCode ±1 step qabul, ±2 step rad (RFC 6238 window=1).
 *  - otplib v13: `window` ignored — epochTolerance (sekund) kerak.
 *    Bu test real bug fosh qildi: window:1 bilan ±1 step rad edi.
 *  - vi fake timers: otplib Date.now() ishlatadi — aniq, race'siz.
 *  - Anchor joriy step O'RTASIDA (00:00:10) — ±30s qo'shni step'larga tushadi.
 * Manba: RFC 6238 (TOTP), NIST SP 800-63B.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generate, generateSecret } from 'otplib';
import { verifyTotpCode } from '../../../src/modules/auth/mfa-totp.js';

// 20 bayt (160 bit) secret — otplib v13 guardrail (min 16 bayt)
const SECRET = generateSecret();
const STEP_MS = 30000;
// Step 0 o'rtasi: 2026-08-17T00:00:10Z (step 0 = 00:00:00–00:00:29)
const ANCHOR = Date.parse('2026-08-17T00:00:10Z');

afterEach(() => vi.useRealTimers());

describe('AUTH D-15 §09 — TOTP valid_window=1 boundary', () => {
  it('joriy step → qabul (RFC 6238)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
    const token = await generate({ secret: SECRET });
    vi.setSystemTime(ANCHOR);
    expect(await verifyTotpCode(SECRET, token)).toBe(true);
  });

  it('-1 step (30s oldin) → qabul — window=1 qamraydi (clock drift)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
    const token = await generate({ secret: SECRET });
    vi.setSystemTime(ANCHOR - STEP_MS);
    expect(await verifyTotpCode(SECRET, token)).toBe(true);
  });

  it('+1 step (30s keyin) → qabul — clock skew tolerant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
    const token = await generate({ secret: SECRET });
    vi.setSystemTime(ANCHOR + STEP_MS);
    expect(await verifyTotpCode(SECRET, token)).toBe(true);
  });

  it('-2 step (60s oldin) → RAD — window chegarasi', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
    const token = await generate({ secret: SECRET });
    vi.setSystemTime(ANCHOR - 2 * STEP_MS);
    expect(await verifyTotpCode(SECRET, token)).toBe(false);
  });

  it('+2 step (60s keyin) → RAD', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
    const token = await generate({ secret: SECRET });
    vi.setSystemTime(ANCHOR + 2 * STEP_MS);
    expect(await verifyTotpCode(SECRET, token)).toBe(false);
  });

  it('noto\'g\'ri secret / noto\'g\'ri token / bo\'sh token → false (fail-closed)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
    const token = await generate({ secret: SECRET });
    expect(await verifyTotpCode('AAAAAAAAAAAAAAAAAAAA', token)).toBe(false);
    expect(await verifyTotpCode(SECRET, '000000')).toBe(false);
    expect(await verifyTotpCode(SECRET, '')).toBe(false);
    expect(await verifyTotpCode(SECRET, '12345')).toBe(false);
  });
});
