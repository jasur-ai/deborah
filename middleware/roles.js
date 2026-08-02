/**
 * Edikit — Role-Aware Shell (RBAC for the frontend shell)
 *
 * Prompt 68 — teacher, student, admin, proctor, marker va board journeylarini
 * yagona accessible shell'da tugatish (research.md §4.3 rollar, §28 a11y).
 *
 * SECURITY:
 *   - UI permission (sidebar nav) hech qachon backend authorization o'rnini
 *     bosmaydi — requireRole faqat SAHIFA ko'rinishini nazorat qiladi, har bir
 *     API write path o'z server-side guard'iga ega (authorization.js ABAC).
 *   - Ruxsatsiz HTML so'rov → 404 (sahifa "yo'q" bo'lib ko'rinadi, 403 emas —
 *     xuddi VIP tizimidagi kabi stealth tamoyil).
 *   - API so'rov → 403 JSON.
 *   - admin barcha rol workspace'larini preview qila oladi (superuser bypass).
 */

import { icon } from '../utils/icons.js';

// ── Role definitions ──
export const ROLES = {
  admin: { label: 'Administrator', icon: 'shield', color: 'var(--accent)' },
  teacher: { label: "O'qituvchi", icon: 'bookOpen', color: 'var(--accent-glow)' },
  student: { label: 'Talaba', icon: 'user', color: 'var(--green)' },
  proctor: { label: 'Proktor', icon: 'monitor', color: 'var(--cyan)' },
  marker: { label: 'Baholovchi', icon: 'clipboard', color: 'var(--purple)' },
  board: { label: "Hay'at", icon: 'award', color: 'var(--gold)' },
};

export const ROLE_LIST = Object.keys(ROLES);

// ── Per-role sidebar navigation (shell items) ──
// Har item: { href, icon, label, section? } — section berilsa bo'lim sarlavhasi.
export const ROLE_NAV = {
  admin: [
    { section: "Boshqaruv" },
    { href: '/admin/dashboard', icon: 'grid', label: 'Dashboard' },
    { href: '/admin/vip', icon: 'shield', label: 'VIP' },
    { href: '/admin/contracts', icon: 'file', label: 'API Contracts' },
    { href: '/admin/observability', icon: 'activity', label: 'Observability' },
    { href: '/admin/command-center', icon: 'zap', label: 'Command Center' },
    { href: '/admin/institutional', icon: 'briefcase', label: 'Institutional Handoff' },
    { href: '/admin/acceptance', icon: 'checkCircle', label: 'Release Acceptance' },
    { href: '/admin/reliability', icon: 'shieldCheck', label: 'Reliability' },
    { href: '/admin/security-guard', icon: 'shield', label: 'Security Guard' },
    { section: "Rol workspace'lar" },
    { href: '/teacher', icon: 'bookOpen', label: "O'qituvchi" },
    { href: '/proctor', icon: 'monitor', label: 'Proktor' },
    { href: '/marker', icon: 'clipboard', label: 'Baholovchi' },
    { href: '/board', icon: 'award', label: "Hay'at" },
    { href: '/student', icon: 'user', label: 'Talaba' },
  ],
  teacher: [
    { section: "Ish maydoni" },
    { href: '/teacher', icon: 'grid', label: 'Overview' },
    { href: '/teacher?tab=courses', icon: 'bookOpen', label: 'Kurslar' },
    { href: '/teacher?tab=assessments', icon: 'target', label: 'Baholashlar' },
    { href: '/teacher?tab=grading', icon: 'clipboard', label: 'Grading queue' },
    { section: "Asboblar" },
    { href: '/user/panel', icon: 'book', label: 'Testlarim' },
    { href: '/user/create-test', icon: 'plus', label: 'Yangi test' },
  ],
  student: [
    { section: "Talaba" },
    { href: '/user/panel', icon: 'grid', label: 'Panelim' },
    { href: '/student', icon: 'calendar', label: 'Kalendar' },
    { href: '/student?tab=assignments', icon: 'fileText', label: 'Topshiriqlar' },
    { href: '/user/portfolio', icon: 'award', label: 'Portfolio' },
    { href: '/user/security-profile', icon: 'shieldCheck', label: 'Xavfsizlik' },
  ],
  proctor: [
    { section: "Proktor" },
    { href: '/proctor', icon: 'monitor', label: 'Jonli monitoring' },
    { href: '/admin/camera-review', icon: 'camera', label: 'Camera review' },
    { href: '/admin/command-center', icon: 'zap', label: 'Command Center' },
  ],
  marker: [
    { section: "Baholovchi" },
    { href: '/marker', icon: 'clipboard', label: 'Grading queue' },
    { href: '/admin/marking', icon: 'checkCircle', label: 'Marking' },
    { href: '/admin/consideration', icon: 'alertTriangle', label: 'Consideration' },
  ],
  board: [
    { section: "Hay'at" },
    { href: '/board', icon: 'award', label: 'Ratifikatsiya' },
    { href: '/admin/board', icon: 'shield', label: 'Board' },
    { href: '/admin/grading', icon: 'trendUp', label: 'Grading' },
  ],
};

// ── Default nav (fallback) ──
ROLE_NAV.default = ROLE_NAV.student;

/** Role label (fallback-safe). */
export function roleLabel(role) {
  return ROLES[role]?.label || ROLES.student.label;
}

/** Resolve current role from session (admin bypass). */
export function resolveRole(req) {
  if (req?.session?.admin) return 'admin';
  if (req?.session?.user) return req.session.user.role || 'student';
  return null;
}

/**
 * requireRole(...roles) — middleware.
 * HTML: ruxsatsiz → 404 stealth. API: → 403 JSON. admin → always allowed.
 */
export function requireRole(...allowed) {
  return (req, res, next) => {
    const role = resolveRole(req);
    if (role === 'admin') return next();
    if (role && allowed.includes(role)) return next();

    const isApi = req.originalUrl?.startsWith('/api/') || req.path?.startsWith('/api/');

    // Login qilmagan — login sahifasiga (yoki API uchun 401 JSON).
    if (!role) {
      if (isApi || req.xhr || req.accepts('json')) {
        return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi', redirect: '/user/login' });
      }
      return res.redirect('/user/login');
    }

    // Login qilgan, lekin rolsiz — stealth 404 (sahifa "yo'q" ko'rinadi).
    if (isApi || req.xhr || req.accepts('json')) {
      return res.status(403).json({ error: 'Ruxsat etilmagan rol' });
    }
    return res.status(404).render('error', {
      title: '404 — Sahifa topilmadi',
      message: "So'ralgan sahifa mavjud emas",
      status: 404,
    });
  };
}

/**
 * Simple role→permission helper (thin mirror of authorization.js defaults).
 * UI-ga ma'lumot ko'rsatish uchun; backend guard'lar bundan mustaqil.
 */
export function can(role, action) {
  const PERMISSIONS = {
    admin: '*',
    teacher: ['test:create', 'test:read', 'test:update', 'test:publish', 'course:read', 'user:read', 'grade:read', 'grade:override'],
    student: ['test:read', 'course:read', 'attempt:create', 'result:read'],
    proctor: ['attempt:read', 'attempt:pause', 'attempt:terminate'],
    marker: ['grade:read', 'grade:score', 'workitem:read'],
    board: ['result:ratify', 'result:read', 'grade:read'],
  };
  const perms = PERMISSIONS[role] || [];
  return perms === '*' || perms.includes(action);
}

/** Build sidebar nav HTML (server-side) — icon helper orqali. */
export function renderRoleNav(role, activePath = '') {
  const items = ROLE_NAV[role] || ROLE_NAV.default;
  let html = '';
  for (const item of items) {
    if (item.section) {
      html += `<div class="shell-nav-sec">${item.section}</div>`;
      continue;
    }
    const isActive = activePath === item.href || (item.href.length > 1 && activePath.startsWith(item.href));
    html += `<a href="${item.href}" class="shell-nav-link${isActive ? ' active' : ''}">${icon(item.icon, 16)}<span>${item.label}</span></a>`;
  }
  return html;
}

export default { ROLES, ROLE_NAV, ROLE_LIST, roleLabel, resolveRole, requireRole, can, renderRoleNav };
