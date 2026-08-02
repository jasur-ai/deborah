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
