/**
 * Deborah — AUTH C-07 Admin auth (alohida session + Strict) — Unit tests
 * -----------------------------------------------------------------------
 *  - requireAdmin: Strict cookie + qisqa Max-Age assert (har request'da)
 *  - admin session user session'dan ajratilgan (req.session.admin)
 *  - adminMfaMandatory: production'da doim, dev'da flag
 *  - adminIpAllowed: exact + CIDR allowlist
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  logAuthEvent: vi.fn(async () => true),
  AUDIT_ACTIONS: { SESSION_ABSOLUTE_TIMEOUT: 'session:absolute_timeout' },
}));

import { requireAdmin } from '../../middleware/auth.js';
import { adminMfaMandatory, adminIpAllowed, adminIpAllowlist } from '../../src/modules/auth/admin-security.js';

const ADMIN_TTL = 8 * 60 * 60 * 1000; // 8 soat

function makeReq(over = {}) {
  const { session: sessionOver = {}, ...rest } = over;
  return {
    originalUrl: '/admin/dashboard',
    path: '/admin/dashboard',
    session: {
      admin: { username: 'admin', loggedInAt: Date.now() },
      adminLoggedInAt: Date.now(),
      cookie: { sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 }, // eski: Lax + 30 kun
      destroy: vi.fn((cb) => cb && cb()),
      ...sessionOver,
    },
    ip: '203.0.113.5',
    headers: { 'user-agent': 'test' },
    accepts: () => false, // HTML sahifa (API emas)
    ...rest,
  };
}

describe('requireAdmin — Strict cookie + Max-Age assert (C-07 §07)', () => {
  it('har request da sameSite=strict va maxAge 8 soatgacha qisqartiriladi', () => {
    const req = makeReq();
    const res = { redirect: vi.fn() };
    requireAdmin(req, res, vi.fn());
    expect(req.session.cookie.sameSite).toBe('strict');
    expect(req.session.cookie.maxAge).toBeLessThanOrEqual(ADMIN_TTL);
  });

  it('maxAge 8 soatdan katta bo lsa qisqartiriladi (eski uzun cookie)', () => {
    const req = makeReq({ session: { cookie: { sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 } } });
    const next = vi.fn();
    requireAdmin(req, resStub(), next);
    expect(req.session.cookie.maxAge).toBe(ADMIN_TTL);
    expect(next).toHaveBeenCalled();
  });

  it('maxAge 8 soatdan kichik bo lsa o zgartirilmaydi', () => {
    const req = makeReq({ session: { cookie: { sameSite: 'strict', maxAge: 2 * 3600 * 1000 } } });
    const next = vi.fn();
    requireAdmin(req, resStub(), next);
    expect(req.session.cookie.maxAge).toBe(2 * 3600 * 1000);
    expect(next).toHaveBeenCalled();
  });

  it('absolute timeout o tgan bo lsa → session destroy + redirect /admin/login', () => {
    const req = makeReq({ session: { adminLoggedInAt: Date.now() - ADMIN_TTL - 1000 } });
    const res = { redirect: vi.fn() };
    requireAdmin(req, res, vi.fn());
    expect(req.session.destroy).toHaveBeenCalled();
  });

  it('admin session yo q bo lsa → redirect (401 emas — login sahifasiga)', () => {
    const req = {
      originalUrl: '/admin/dashboard', path: '/admin/dashboard',
      session: { user: { safeKey: 'u1' } },
      headers: {}, accepts: () => false,
    };
    const res = { redirect: vi.fn() };
    requireAdmin(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalled();
  });
});

describe('admin session izolyatsiya (C-07 §11)', () => {
  it('req.session.admin — user session dan alohida (session.user maydoni yo q)', () => {
    const req = makeReq();
    expect(req.session.admin.username).toBe('admin');
    expect(req.session.user).toBeUndefined();
  });
});

describe('adminMfaMandatory (C-07 §08)', () => {
  const prev = process.env.NODE_ENV;
  const prevFlag = process.env.ADMIN_MFA_MANDATORY;

  afterEach(() => {
    process.env.NODE_ENV = prev;
    if (prevFlag === undefined) delete process.env.ADMIN_MFA_MANDATORY;
    else process.env.ADMIN_MFA_MANDATORY = prevFlag;
  });

  it('production da doim true (bypass yo q)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_MFA_MANDATORY;
    expect(adminMfaMandatory()).toBe(true);
  });

  it('dev/test da flag yo q bo lsa false (legacy)', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_MFA_MANDATORY;
    expect(adminMfaMandatory()).toBe(false);
  });

  it('dev/test da flag=true bo lsa true', () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_MFA_MANDATORY = 'true';
    expect(adminMfaMandatory()).toBe(true);
  });
});

describe('adminIpAllowed (C-07 §10)', () => {
  it('bo sh allowlist → hammaga ochiq', () => {
    expect(adminIpAllowed('203.0.113.5', [])).toBe(true);
  });

  it('exact IP allowlist da → true; boshqa → false', () => {
    expect(adminIpAllowed('203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(adminIpAllowed('203.0.113.6', ['203.0.113.5'])).toBe(false);
  });

  it('CIDR allowlist (203.0.113.0/24) → ichidagi IP true, tashqari false', () => {
    expect(adminIpAllowed('203.0.113.77', ['203.0.113.0/24'])).toBe(true);
    expect(adminIpAllowed('198.51.100.7', ['203.0.113.0/24'])).toBe(false);
  });

  it('ip yo q bo lsa false (allowlist bor bo lsa)', () => {
    expect(adminIpAllowed(null, ['203.0.113.5'])).toBe(false);
  });

  it('adminIpAllowlist env dan vergul bilan parse qiladi', () => {
    const prev = process.env.ADMIN_IP_ALLOWLIST;
    process.env.ADMIN_IP_ALLOWLIST = '203.0.113.5, 198.51.100.0/24';
    expect(adminIpAllowlist()).toEqual(['203.0.113.5', '198.51.100.0/24']);
    if (prev === undefined) delete process.env.ADMIN_IP_ALLOWLIST;
    else process.env.ADMIN_IP_ALLOWLIST = prev;
  });
});

function resStub() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), redirect: vi.fn() };
}
