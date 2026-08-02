/**
 * Edikit — Origin Check Middleware Tests
 *
 * Tests:
 *   1. Origin allowlist — allowed origins pass
 *   2. Origin allowlist — blocked origins rejected
 *   3. GET requests skip check
 *   4. Same-origin requests via Host header
 *   5. Missing origin/referer allowed (legacy clients)
 */

import { describe, it, expect } from 'vitest';
import { originCheck } from '../../middleware/origin-check.js';

function createReq(method, origin, referer, host, path) {
  return {
    method: method || 'GET',
    path: path || '/',
    headers: {
      origin: origin || undefined,
      referer: referer || undefined,
      host: host || 'localhost:3000',
    },
    protocol: 'http',
    ip: '127.0.0.1',
    log: { warn: () => {} },
  };
}

function createRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
}

describe('originCheck middleware', () => {
  it('should allow GET requests without origin check', () => {
    const req = createReq('GET', 'http://evil.com');
    const res = createRes();
    let nextCalled = false;
    originCheck(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('should allow POST from allowed origin (localhost)', () => {
    const req = createReq('POST', 'http://localhost:3000');
    const res = createRes();
    let nextCalled = false;
    originCheck(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('should block POST from unknown origin', () => {
    const req = createReq('POST', 'http://evil-attacker.com');
    const res = createRes();
    originCheck(req, res, () => {});
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ORIGIN_BLOCKED');
  });

  it('should block POST with blocked Referer header', () => {
    const req = createReq('POST', null, 'http://evil-attacker.com/login');
    const res = createRes();
    originCheck(req, res, () => {});
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ORIGIN_BLOCKED');
  });

  it('should allow POST with missing origin/referer (legacy curl)', () => {
    const req = createReq('POST', null, null);
    const res = createRes();
    let nextCalled = false;
    originCheck(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('should allow POST with same-origin Host header', () => {
    const req = createReq('POST', null, null, 'localhost:3000');
    const res = createRes();
    let nextCalled = false;
    originCheck(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('should skip socket.io paths', () => {
    const req = createReq('POST', null, null, null, '/socket.io/?EIO=4');
    const res = createRes();
    let nextCalled = false;
    originCheck(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('should skip static file paths', () => {
    const req = createReq('POST', null, null, null, '/css/style.css');
    const res = createRes();
    let nextCalled = false;
    originCheck(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
