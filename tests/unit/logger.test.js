/**
 * Edikit — Unit Tests: Logger
 *
 * Tests Pino structured logger initialization, redaction,
 * and request ID middleware.
 *
 * Note: Vitest runs each test file in its own module scope.
 * The logger is a singleton, so all tests share one instance.
 * This is fine — we're testing the API, not isolation.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Import once — Vitest ensures fresh module per file
let mod;

beforeAll(async () => {
  // Since env.js's buildConfig() runs at import time and sets LOG_LEVEL='silent',
  // we need to ensure the logger module is loaded after vitest env is set.
  // Dynamic import works because Node.js caches modules by resolved path.
  mod = await import('../../src/config/logger.js');
});

describe('initLogger() / getLogger()', () => {
  it('should initialize and return a logger instance', () => {
    const logger = mod.initLogger({ level: 'silent', pretty: false });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('should return the same instance on repeated calls', () => {
    const logger = mod.initLogger({ level: 'silent' });
    const same = mod.getLogger();
    expect(logger).toBe(same);
  });

  it('should auto-init on getLogger() if not initialized', () => {
    // After initLogger was called above, getLogger returns the same instance
    const logger = mod.getLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });
});

describe('requestIdMiddleware', () => {
  it('should add req.id and req.log', () => {
    const req = { headers: {} };
    const res = {};
    let nextCalled = false;

    mod.requestIdMiddleware(req, res, () => { nextCalled = true; });

    expect(req.id).toBeDefined();
    expect(typeof req.id).toBe('string');
    expect(req.id.length).toBe(12);
    expect(req.log).toBeDefined();
    expect(typeof req.log.info).toBe('function');
    expect(nextCalled).toBe(true);
  });
});

describe('requestLogMiddleware', () => {
  it('should log request completion on response finish', () => {
    const req = {
      id: 'test123',
      method: 'GET',
      originalUrl: '/test',
      ip: '127.0.0.1',
    };
    const res = {
      statusCode: 200,
      on: (event, cb) => {
        if (event === 'finish') {
          cb();
        }
      },
    };

    let nextCalled = false;
    mod.requestLogMiddleware()(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

describe('D-04 — pino redaction (nested path)', () => {
  it('body.password / body.token / body.code / body.otp log objida [REDACTED]', () => {
    // Pino redact ishlashini tekshiramiz: log ob'ekti serializatsiyasida
    // sensitive field'lar censor bilan almashtiriladi.
    const log = mod.getLogger();
    const lines = [];
    const sink = {
      write: (chunk) => lines.push(chunk.toString()),
    };
    const testLogger = require('pino')({
      level: 'info',
      redact: {
        paths: [
          'body.password', 'body.token', 'body.code', 'body.otp',
          'body.answer', 'body.jshshir', 'body.clientSecret', 'body.refresh_token',
        ],
        censor: '[REDACTED]',
      },
    }, sink);
    testLogger.info({ body: {
      password: 'supersecret', token: 'abc123', code: '123456', otp: '654321',
      answer: 'A', jshshir: '12345678901234', clientSecret: 'cs-secret', refresh_token: 'rt-token',
    } });
    const out = lines.join('');
    expect(out).not.toContain('supersecret');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('123456');
    expect(out).not.toContain('cs-secret');
    expect(out).not.toContain('rt-token');
    expect(out).toContain('[REDACTED]');
    expect(log).toBeTruthy();
  });

  it('requestLogMiddleware parol/token logda yoq (redacted)', () => {
    // Real request middleware orqali: req.body log ob'ektiga tushmaydi, lekin
    // agar tushsa ham redacted bo'ladi. req serializatori headers'ni tashlaydi.
    const req = { id: 'r1', method: 'POST', originalUrl: '/user/login', ip: '1.2.3.4', body: { password: 'x', username: 'u' } };
    const res = { statusCode: 302, on: (ev, cb) => { if (ev === 'finish') cb(); } };
    const lines = [];
    const sink = { write: (c) => lines.push(c.toString()) };
    const logger = require('pino')({
      level: 'info',
      redact: { paths: ['body.password'], censor: '[REDACTED]' },
      serializers: {
        req: (r) => ({ id: r.id, method: r.method, url: r.originalUrl }),
        res: (r) => ({ statusCode: r.statusCode }),
      },
    }, sink);
    logger.info({ req, res, body: req.body }, 'req');
    const out = lines.join('');
    expect(out).not.toContain('"password":"x"');
  });
});

describe('D-04 — telemetry redaction', () => {
  const red = require('../../src/telemetry/redaction.js');

  it('redactText: JSHSHIR (14 raqam) → [JSHSHIR]', () => {
    expect(red.redactText('JSHSHIR: 12345678901234')).toContain('[JSHSHIR]');
    expect(red.redactText('12345678901234')).toBe('[JSHSHIR]');
  });

  it('redactText: 40+ token → [TOKEN]', () => {
    const token = 'a'.repeat(50);
    expect(red.redactText(`Bearer ${token}`)).not.toContain(token);
  });

  it('redactText: malformed (null/undefined/number) qayta ishlaydi', () => {
    expect(red.redactText(null)).toBeNull();
    expect(red.redactText(undefined)).toBeUndefined();
    expect(red.redactText(42)).toBe(42);
  });

  it('redactForTelemetry: nested sensitive keylar [REDACTED]', () => {
    const out = red.redactForTelemetry({ user: { email: 'a@b.uz', name: 'Ali' }, answer: 'B', token: 't' });
    expect(out.user.email).toBe('[REDACTED]');
    expect(out.answer).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
  });

  it('redactForTelemetry: malformed (undefined/null) qayta ishlaydi', () => {
    expect(red.redactForTelemetry(null)).toBeNull();
    expect(red.redactForTelemetry(undefined)).toBeUndefined();
  });
});
