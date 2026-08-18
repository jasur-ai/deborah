/**
 * AUTH D-04 — Logging + redaction (integration)
 *
 * 1. Central redaction config (D-04 §07) — barcha sensitive body field'lar
 *    redact list'da.
 * 2. Haqiqiy markaziy config (REDACT_CONFIG) pino orqali — login paroli,
 *    token, JSHSHIR, answer log satrida [REDACTED] bo'ladi (child process
 *    o'rniga real config + real pino pipeline tekshiriladi).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import pino from 'pino';
import { REDACT_CONFIG_D04 } from '../../src/config/logger.js';

describe('AUTH D-04 — redaction contract (integration)', () => {
  it('central redact config barcha sensitive body field\'larni qamraydi (D-04 §07)', () => {
    const src = readFileSync('src/config/logger.js', 'utf8');
    const required = [
      'body.password', 'body.token', 'body.code', 'body.otp', 'body.secret',
      'body.answer', 'body.jshshir', 'body.clientSecret', 'body.refresh_token',
      'body.accessToken', 'body.apiKey', 'body.newPassword', 'body.backupCode',
      'req.headers.authorization', 'res.headers["set-cookie"]',
    ];
    for (const p of required) {
      expect(src, `redact path yo'q: ${p}`).toContain(p);
    }
  });

  it('login paroli / token / JSHSHIR / answer log satrida [REDACTED] bo\'ladi (real config)', () => {
    const lines = [];
    const sink = { write: (c) => lines.push(c.toString()) };
    const log = pino({
      level: 'info',
      redact: REDACT_CONFIG_D04,
      serializers: {
        req: (r) => ({ id: r.id, method: r.method, url: r.url }),
        res: (r) => ({ statusCode: r.statusCode }),
      },
    }, sink);

    // Real login so'roviga o'xshash log obyekti — parol + token + PII
    log.info({
      req: { id: 'r1', method: 'POST', url: '/user/login' },
      body: { username: 'd04user', password: 'd04-super-secret-xyz' },
    }, 'login attempt');
    log.info({
      body: { token: 'd04-verify-token-abc123', jshshir: '12345678901234', answer: 'B' },
    }, 'verify');
    log.info({
      body: { email: 'd04@test.uz', backupCode: 'd04-bk-9999', clientSecret: 'd04-cs' },
    }, 'profile');

    const out = lines.join('');
    expect(out).not.toContain('d04-super-secret-xyz');
    expect(out).not.toContain('d04-verify-token-abc123');
    expect(out).not.toContain('12345678901234');
    expect(out).not.toContain('d04-bk-9999');
    expect(out).not.toContain('d04-cs');
    // email — PII, shuning uchun ham redact qilinadi
    expect(out).not.toContain('d04@test.uz');
    expect(out).toContain('[REDACTED]');
    // username va url redact emas — foydali log ma'lumoti saqlanadi
    expect(out).toContain('d04user');
    expect(out).toContain('/user/login');
  });
});
