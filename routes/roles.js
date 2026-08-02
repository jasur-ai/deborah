/**
 * Edikit — Role Workspace Routes (Prompt 68)
 *
 * teacher / student / proctor / marker / board scoped screens in the shared
 * role-aware shell. Security:
 *   - requireRole() — HTML ruxsatsiz → stealth 404, API → 403 JSON.
 *   - UI nav faqat ko'rinishni boshqaradi; har API write path server-side
 *     guard'larga ega (authorization.js ABAC, tenant scope).
 *   - Secret DTO (parol xesh, token) view'larga yuborilmaydi.
 */

import { Router } from 'express';
import { requireRole, ROLE_NAV, roleLabel, can } from '../middleware/roles.js';

const router = Router();

/** EJS'ga rol kontekstini uzatish (hech qanday secret DTO yo'q). */
function roleLocals(role, active, extra = {}) {
  return {
    role,
    roleLabel: roleLabel(role),
    navItems: ROLE_NAV[role] || ROLE_NAV.default,
    active, // sidebar uchun: workspace path (masalan '/teacher')
    title: extra.title,
    ...extra,
  };
}

// ── Teacher Workspace (Overview / Courses / Assessments / Grading) ──
router.get('/teacher', requireRole('teacher'), (req, res) => {
  const role = 'teacher';
  const tab = req.query.tab || 'overview';
  const canOverride = can(role, 'grade:override');
  const canPublish = can(role, 'test:publish');
  res.render('role/teacher', roleLocals(role, '/teacher', {
    title: "O'qituvchi ish maydoni",
    tab,
    canOverride,
    canPublish,
    username: req.session?.user?.username || '',
  }));
});

// ── Student Workspace (Calendar / Assignments / Portfolio) ──
router.get('/student', requireRole('student'), (req, res) => {
  const role = 'student';
  const tab = req.query.tab || 'calendar';
  res.render('role/student', roleLocals(role, '/student', {
    title: 'Talaba ish maydoni',
    tab,
    canAttempt: can(role, 'attempt:create'),
    canReadResult: can(role, 'result:read'),
    username: req.session?.user?.username || '',
  }));
});

// ── Proctor Workspace (Live monitoring) ──
router.get('/proctor', requireRole('proctor'), (req, res) => {
  const role = 'proctor';
  res.render('role/proctor', roleLocals(role, '/proctor', {
    title: 'Proktor — jonli monitoring',
    canPause: can(role, 'attempt:pause'),
    canTerminate: can(role, 'attempt:terminate'),
    username: req.session?.user?.username || '',
  }));
});

// ── Marker Workspace (Grading queue) ──
router.get('/marker', requireRole('marker'), (req, res) => {
  const role = 'marker';
  res.render('role/marker', roleLocals(role, '/marker', {
    title: 'Baholovchi — grading queue',
    canScore: can(role, 'grade:score'),
    username: req.session?.user?.username || '',
  }));
});

// ── Board Workspace (Ratification) ──
router.get('/board', requireRole('board'), (req, res) => {
  const role = 'board';
  res.render('role/board', roleLocals(role, '/board', {
    title: "Hay'at — ratifikatsiya",
    canRatify: can(role, 'result:ratify'),
    username: req.session?.user?.username || '',
  }));
});

export default router;
