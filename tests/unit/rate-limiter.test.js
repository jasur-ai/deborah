/**
 * Edikit — Rate Limiter Tests
 *
 * Tests:
 *   1. SlidingWindowCounter — unit tests
 *   2. ConnectionCounter — unit tests
 *   3. Socket.io event rate limiting — wrap() integration
 *   4. HTTP rate limiter config validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SlidingWindowCounter, ConnectionCounter, HTTP_LIMITS, SOCKET_LIMITS } from '../../src/config/rate-limiter.js';

// ═══════════════════════════════════════════════════════════════
// 1. SlidingWindowCounter
// ═══════════════════════════════════════════════════════════════

describe('SlidingWindowCounter', () => {
  let counter;

  beforeEach(() => {
    counter = new SlidingWindowCounter(3, 1000); // max 3 hits per second
  });

  it('should allow hits within limit', () => {
    expect(counter.check('key1').allowed).toBe(true);
    expect(counter.check('key1').allowed).toBe(true);
    expect(counter.check('key1').allowed).toBe(true);
  });

  it('should block hits over limit', () => {
    counter.check('key1');
    counter.check('key1');
    counter.check('key1');
    const result = counter.check('key1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetMs).toBeGreaterThan(0);
  });

  it('should track remaining count', () => {
    expect(counter.check('key1').remaining).toBe(2); // max=3, used=1, remaining=2
    expect(counter.check('key1').remaining).toBe(1);
    expect(counter.check('key1').remaining).toBe(0);
    expect(counter.check('key1').allowed).toBe(false);
  });

  it('should allow different keys independently', () => {
    expect(counter.check('keyA').allowed).toBe(true);
    expect(counter.check('keyA').allowed).toBe(true);
    expect(counter.check('keyA').allowed).toBe(true);
    expect(counter.check('keyA').allowed).toBe(false);

    // Different key should still be allowed
    expect(counter.check('keyB').allowed).toBe(true);
    expect(counter.check('keyB').allowed).toBe(true);
    expect(counter.check('keyB').allowed).toBe(true);
    expect(counter.check('keyB').allowed).toBe(false);
  });

  it('should expire old entries after windowMs', async () => {
    counter.check('key1'); // t=0
    counter.check('key1'); // t=0
    counter.check('key1'); // t=0
    expect(counter.check('key1').allowed).toBe(false);

    // Wait for window to expire
    await new Promise(r => setTimeout(r, 1100));

    // Should be allowed again
    expect(counter.check('key1').allowed).toBe(true);
  });

  it('should clear all buckets', () => {
    counter.check('key1');
    counter.check('key2');
    counter.check('key3');
    expect(counter.size).toBe(3);
    counter.clear();
    expect(counter.size).toBe(0);
  });

  it('should handle many keys', () => {
    for (let i = 0; i < 100; i++) {
      counter.check(`key${i}`);
    }
    expect(counter.size).toBe(100);
    // Each key should have used 1 of 3 allowed
    expect(counter.check('key50').remaining).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. ConnectionCounter
// ═══════════════════════════════════════════════════════════════

describe('ConnectionCounter', () => {
  let counter;

  beforeEach(() => {
    counter = new ConnectionCounter(2, 1000); // max 2 connections per second
  });

  it('should register connections within limit', () => {
    expect(counter.register('ip1').allowed).toBe(true);
    expect(counter.register('ip1').allowed).toBe(true);
  });

  it('should block connections over limit', () => {
    counter.register('ip1');
    counter.register('ip1');
    const result = counter.register('ip1');
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(2);
  });

  it('should unregister on disconnect', () => {
    counter.register('ip1');
    counter.register('ip1');
    expect(counter.register('ip1').allowed).toBe(false);

    counter.unregister('ip1'); // one disconnects
    expect(counter.register('ip1').allowed).toBe(true);
    expect(counter.register('ip1').allowed).toBe(false); // back to limit
  });

  it('should handle different IPs independently', () => {
    counter.register('ip1');
    counter.register('ip1');
    expect(counter.register('ip1').allowed).toBe(false);

    expect(counter.register('ip2').allowed).toBe(true);
    expect(counter.register('ip2').allowed).toBe(true);
    expect(counter.register('ip2').allowed).toBe(false);
  });

  it('should expire old connections', async () => {
    counter.register('ip1');
    counter.register('ip1');
    expect(counter.register('ip1').allowed).toBe(false);

    await new Promise(r => setTimeout(r, 1100));

    expect(counter.register('ip1').allowed).toBe(true);
  });

  it('should clear all', () => {
    counter.register('ip1');
    counter.register('ip2');
    expect(counter.size).toBe(2);
    counter.clear();
    expect(counter.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. HTTP Rate Limit Config Validation
// ═══════════════════════════════════════════════════════════════

describe('HTTP_LIMITS config', () => {
  it('should have all required limiters', () => {
    expect(HTTP_LIMITS.login).toBeDefined();
    expect(HTTP_LIMITS.general).toBeDefined();
    expect(HTTP_LIMITS.adminApi).toBeDefined();
    expect(HTTP_LIMITS.userApi).toBeDefined();
  });

  it('should have valid windowMs and max values', () => {
    for (const [name, limiter] of Object.entries(HTTP_LIMITS)) {
      expect(limiter.windowMs).toBeGreaterThan(0);
      expect(limiter.max).toBeGreaterThan(0);
      expect(limiter.message).toBeDefined();
      expect(limiter.message.error).toBeDefined();
    }
  });

  it('login limiter should skip non-POST methods', () => {
    expect(HTTP_LIMITS.login.skip({ method: 'GET' })).toBe(true);
    expect(HTTP_LIMITS.login.skip({ method: 'POST' })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Socket Rate Limit Config Validation
// ═══════════════════════════════════════════════════════════════

describe('SOCKET_LIMITS config', () => {
  it('should have connection limits', () => {
    expect(SOCKET_LIMITS.connection.windowMs).toBeGreaterThan(0);
    expect(SOCKET_LIMITS.connection.max).toBeGreaterThan(0);
  });

  it('should have all required event limits', () => {
    const requiredEvents = [
      'player:answer', 'player:join', 'player:rejoin',
      'player:checkCode', 'player:checkName',
      'host:create', 'host:start', 'host:next',
      'host:forceNext', 'host:end',
      'arena:botAnswer', 'arena:watch',
    ];
    for (const event of requiredEvents) {
      expect(SOCKET_LIMITS.events[event]).toBeDefined();
      expect(SOCKET_LIMITS.events[event].max).toBeGreaterThan(0);
      expect(SOCKET_LIMITS.events[event].windowMs).toBeGreaterThan(0);
    }
  });
});
