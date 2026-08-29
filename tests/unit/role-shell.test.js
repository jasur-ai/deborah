/**
 * Deborah — Role-Aware Shell (unit, Prompt 68)
 *
 * Pure logic tests for middleware/roles.js:
 *   - Role definitions + per-role nav (teacher/student/admin/proctor/marker/board)
 *   - resolveRole() from session shape
 *   - requireRole() middleware decision (admin bypass, allowed role, stealth 404,
 *     API 403, unauthenticated redirect/401)
 *   - can() permission helper
 */

import { describe, it, expect } from 'vitest';
import {
  ROLES,
  ROLE_LIST,
  ROLE_NAV,
  roleLabel,
  resolveRole,
  requireRole,
  can,
  renderRoleNav,
} from '../../middleware/roles.js';

function mockRes() {
  const res = { statusCode: 200, body: null, redirectUrl: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.render = (view, locals) => { res.body = { view, locals }; return res; };
  res.redirect = (url) => { res.redirectUrl = url; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

function callMiddleware(mw, session) {
  const req = {
    session,
    originalUrl: '/teacher',
    path: '/teacher',
    xhr: false,
    accepts: () => false,
  };
  const res = mockRes();
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return { res, nexted };
}

describe('roles — definitions', () => {
  it('defines all 9 roles with labels and icons', () => {
    // AUTH A-19: teacher_pending/teacher_rejected qo'shildi (approval state'lar)
    // AUTH B-36: co_teacher qo'shildi (kurs-scoped hamkor rol)
    expect(ROLE_LIST).toEqual(['admin', 'teacher', 'teacher_pending', 'teacher_rejected', 'student', 'proctor', 'marker', 'board', 'co_teacher']);
    for (const r of ROLE_LIST) {
      expect(ROLES[r].label).toBeTruthy();
      expect(ROLES[r].icon).toBeTruthy();
    }
  });

  it('provides per-role nav with href/icon/label entries', () => {
    for (const r of ['admin', 'teacher', 'student', 'proctor', 'marker', 'board']) {
      const nav = ROLE_NAV[r];
      expect(Array.isArray(nav)).toBe(true);
      expect(nav.length).toBeGreaterThan(0);
      const links = nav.filter((i) => i.href);
      for (const l of links) {
        expect(l.href).toMatch(/^\//);
        expect(l.icon).toBeTruthy();
        expect(l.label).toBeTruthy();
      }
    }
  });

  it('falls back to student nav for unknown roles', () => {
    expect(ROLE_NAV.default).toBe(ROLE_NAV.student);
  });

  it('roleLabel handles unknown roles safely', () => {
    expect(roleLabel('teacher')).toBe("O'qituvchi");
    expect(roleLabel('nope')).toBe('Talaba');
  });
});

describe('roles — resolveRole', () => {
  it('returns admin for admin session', () => {
    expect(resolveRole({ session: { admin: { username: 'a' } } })).toBe('admin');
  });

  it('returns user role when present', () => {
    expect(resolveRole({ session: { user: { role: 'teacher' } } })).toBe('teacher');
  });

  it('defaults to student for user without role', () => {
    expect(resolveRole({ session: { user: { username: 'u' } } })).toBe('student');
  });

  it('returns null when not logged in', () => {
    expect(resolveRole({ session: {} })).toBe(null);
    expect(resolveRole({})).toBe(null);
  });
});

describe('roles — requireRole', () => {
  it('allows admin through any role workspace (superuser bypass)', () => {
    const mw = requireRole('teacher');
    const { nexted } = callMiddleware(mw, { admin: { username: 'a' } });
    expect(nexted).toBe(true);
  });

  it('allows a user with the required role', () => {
    const mw = requireRole('teacher');
    const { nexted } = callMiddleware(mw, { user: { role: 'teacher' } });
    expect(nexted).toBe(true);
  });

  it('rejects a logged-in user with a different role via stealth 404 (HTML)', () => {
    const mw = requireRole('teacher');
    const { res } = callMiddleware(mw, { user: { role: 'student' } });
    expect(res.statusCode).toBe(404);
    expect(res.body.view).toBe('error');
  });

  it('rejects a wrong role via 403 JSON for API requests', () => {
    const mw = requireRole('proctor');
    const req = { session: { user: { role: 'student' } }, originalUrl: '/api/x', path: '/api/x', xhr: true, accepts: () => true };
    const res = mockRes();
    let nexted = false;
    mw(req, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Ruxsat etilmagan rol');
  });

  it('redirects unauthenticated users to /user/login (HTML)', () => {
    const mw = requireRole('teacher');
    const { res, nexted } = callMiddleware(mw, {});
    expect(nexted).toBe(false);
    expect(res.redirectUrl).toBe('/user/login');
  });

  it('returns 401 JSON for unauthenticated API requests', () => {
    const mw = requireRole('teacher');
    const req = { session: {}, originalUrl: '/api/x', path: '/api/x', xhr: true, accepts: () => true };
    const res = mockRes();
    let nexted = false;
    mw(req, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Avtorizatsiya talab qilinadi');
  });
});

describe('roles — can() permission helper', () => {
  it('grants teacher test:create and grade:override', () => {
    expect(can('teacher', 'test:create')).toBe(true);
    expect(can('teacher', 'grade:override')).toBe(true);
  });

  it('denies teacher attempt:create (student-only)', () => {
    expect(can('teacher', 'attempt:create')).toBe(false);
  });

  it('grants student attempt:create and result:read', () => {
    expect(can('student', 'attempt:create')).toBe(true);
    expect(can('student', 'result:read')).toBe(true);
  });

  it('admin gets everything', () => {
    expect(can('admin', 'anything:at:all')).toBe(true);
  });

  it('denies board grade:score (marker-only)', () => {
    expect(can('board', 'grade:score')).toBe(false);
  });
});

describe('roles — renderRoleNav', () => {
  it('renders nav sections and links as HTML', () => {
    const html = renderRoleNav('teacher', '/teacher');
    expect(html).toContain('shell-nav-link');
    expect(html).toContain('Ish maydoni');
    expect(html).toContain("Umumiy ko'rinish"); // BUG-034
    expect(html).toContain('active');
  });

  it('falls back to default nav for unknown role', () => {
    const html = renderRoleNav('nope', '');
    expect(html).toContain('shell-nav-link');
  });
});
