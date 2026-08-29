import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isHoneypotTriggered,
  verifyTurnstile,
  checkEmailRegisterLimit,
  _resetBotStores,
} from '../../src/modules/auth/bot-guard.js';

describe('B-08 — bot-guard: honeypot', () => {
  it('bo\'sh/undefined → bot emas (trigger yo\'q)', () => {
    expect(isHoneypotTriggered('')).toBe(false);
    expect(isHoneypotTriggered('   ')).toBe(false);
    expect(isHoneypotTriggered(undefined)).toBe(false);
    expect(isHoneypotTriggered(null)).toBe(false);
    expect(isHoneypotTriggered(0)).toBe(false);
  });

  it('to\'ldirilgan yashirin field → bot', () => {
    expect(isHoneypotTriggered('http://spam.example')).toBe(true);
    expect(isHoneypotTriggered(' x ')).toBe(true);
  });
});

describe('B-08 — bot-guard: Turnstile verify', () => {
  const OLD_SECRET = process.env.TURNSTILE_SECRET_KEY;

  afterEach(() => {
    if (OLD_SECRET === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = OLD_SECRET;
    vi.restoreAllMocks();
  });

  it('secret yo\'q → fail-open (skipped) — dev/test', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const r = await verifyTurnstile('any-token');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('secret bor + token yo\'q → turnstile_required', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    const r = await verifyTurnstile('');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('turnstile_required');
    expect(r.httpStatus).toBe(400);
  });

  it('secret bor + valid token → ok (siteverify success)', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    globalThis.fetch = fetchMock;
    const r = await verifyTurnstile('valid-token-abc');
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.secret).toBe('1x0000000000000000000000000000000AA');
    expect(body.response).toBe('valid-token-abc');
  });

  it('secret bor + invalid token → bot_detected (fail-closed)', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });
    const r = await verifyTurnstile('bad-token');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bot_detected');
    expect(r.httpStatus).toBe(403);
  });

  it('siteverify HTTP xato → turnstile_error', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const r = await verifyTurnstile('token');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('turnstile_error');
  });

  it('network outage → fail-open (signup buzilmaydi)', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await verifyTurnstile('token');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });
});

describe('B-08 — bot-guard: per-email register limit (3/soat)', () => {
  beforeEach(() => _resetBotStores());

  it('3 tadan keyin 4-chi blok (retryAfterSeconds > 0)', () => {
    const e = 'student@test.uz';
    expect(checkEmailRegisterLimit(e).allowed).toBe(true);
    expect(checkEmailRegisterLimit(e).allowed).toBe(true);
    expect(checkEmailRegisterLimit(e).allowed).toBe(true);
    const fourth = checkEmailRegisterLimit(e);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('case/space insensitive — bir xil email bir bucket', () => {
    checkEmailRegisterLimit('Student@Test.uz');
    checkEmailRegisterLimit(' student@test.uz ');
    checkEmailRegisterLimit('STUDENT@test.uz');
    expect(checkEmailRegisterLimit('student@test.uz').allowed).toBe(false);
  });

  it("boshqa email'lar alohida bucket (3/soat har biri)", () => {
    const a = 'a@test.uz';
    const b = 'b@test.uz';
    for (let i = 0; i < 3; i += 1) {
      expect(checkEmailRegisterLimit(a).allowed).toBe(true);
      expect(checkEmailRegisterLimit(b).allowed).toBe(true);
    }
    expect(checkEmailRegisterLimit(a).allowed).toBe(false);
    expect(checkEmailRegisterLimit(b).allowed).toBe(false);
  });

  it('email yo\'q/noto\'g\'ri → doim allowed', () => {
    expect(checkEmailRegisterLimit('').allowed).toBe(true);
    expect(checkEmailRegisterLimit(undefined).allowed).toBe(true);
  });
});
