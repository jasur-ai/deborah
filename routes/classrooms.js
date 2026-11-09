/**
 * Deborah — O'quvchi / guruh / o'qituvchi (eski shamola bilan mos)
 * - Admin: o'quvchi qo'shish (HEMIS ID shart), guruh yaratish, o'qituvchi biriktirish,
 *          grade policy va geofence, QR tekshiruvi.
 * - O'qituvchi: o'zga biriktirilgan guruhlar, o'quvchilar, ichki grade journal.
 * Eski uslub: groups/{gid}, users/{key}/group, groups/{gid}/teachers/{tkey}.
 */

import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireAdminMfaStepUp } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { safeKey } from '../utils/helpers.js';
import {
  classroomGroupId,
  normalizeGroupName,
  normalizePersonName,
  normalizeHemisId,
  classroomUserKey,
  validateClassroomLocation,
  validateGradePolicy,
  calculateClassroomGrade,
  classroomDisplayName,
  DEFAULT_GRADE_POLICY,
  CLASSROOM_QR_TTL_MS,
  sha256,
} from '../src/modules/classrooms/service.js';

const router = Router();

function roleCtx(req) {
  const session = req.session || {};
  const isAdmin = Boolean(session.admin);
  const user = session.user || {};
  return {
    isAdmin,
    role: session.admin ? 'admin' : user.role || 'student',
    username: isAdmin ? (session.admin.username || 'admin') : user.username || '',
    safeKey: isAdmin ? (session.admin.safeKey || session.admin.username || 'admin') : user.safeKey || '',
  };
}

/* ── Admin: o'quvchi qo'shish (HEMIS ID majburiy) ──
 * Body: firstName, lastName, group, hemisId, username (ixtiyoriy)
 */
router.post('/api/admin/classrooms/students', requireAdminMfaStepUp, async (req, res) => {
  const { firstName, lastName, group, hemisId, username } = req.body || {};
  const gid = classroomGroupId(group);
  if (!gid) return res.status(400).json({ ok: false, error: 'Guruh nomi noto‘g‘ri' });
  const h = normalizeHemisId(hemisId);
  if (!h) return res.status(400).json({ ok: false, error: 'HEMIS ID noto‘g‘ri' });
  const first = normalizePersonName(firstName);
  const last = normalizePersonName(lastName);
  if (!first || !last) return res.status(400).json({ ok: false, error: 'Ism va familiya shart' });

  // HEMIS ID unikalmi? barcha users'dan qidiramiz (eski uslub)
  const usersSnap = await fb.get('users');
  const users = usersSnap.exists() ? usersSnap.val() || {} : {};
  for (const [uKey, u] of Object.entries(users)) {
    if (u && u.hemisId === h) {
      return res.status(409).json({ ok: false, error: 'Bu HEMIS ID allaqachon boshqa o‘quvchiga tegishli' });
    }
  }

  let targetKey = null;
  if (username) {
    const k = classroomUserKey(username);
    if (!k) return res.status(400).json({ ok: false, error: 'Username noto‘g‘ri' });
    const existing = await fb.get(`users/${k}`);
    if (!existing.exists()) {
      await fb.set(`users/${k}`, {
        username: k,
        password: '',
        role: 'student',
        hemisId: h,
        firstName: first,
        lastName: last,
        group: gid,
        created_at: Date.now(),
        source: 'classroom_roster',
        isVip: false,
        classroomOnly: true,
      });
    }
    targetKey = k;
  }

  // Guruhni yaratish (agar yo'q bo'lsa) — eski groups/{id} yo'li
  const groupSnap = await fb.get(`groups/${gid}`);
  if (!groupSnap.exists()) {
    await fb.set(`groups/${gid}`, {
      name: normalizeGroupName(group),
      code: gid,
      created_at: Date.now(),
      source: 'classroom_admin',
    });
  }

  // O'quvchini guruhga biriktirish: users/{key}/group = gid (eski uslub)
  if (targetKey) {
    await fb.update(`users/${targetKey}`, {
      firstName,
      lastName,
      hemisId: h,
      group: gid,
    });
    await fb.set(`groups/${gid}/members/${targetKey}`, {
      userId: targetKey,
      hemisId: h,
      firstName,
      lastName,
      joined_at: Date.now(),
      source: 'admin',
    });
  }

  await fb.set(`groups/${gid}/hemis_index/${h}`, {
    userId: targetKey || null,
    firstName,
    lastName,
    indexed_at: Date.now(),
  });

  res.json({ ok: true, student: { key: targetKey, firstName, lastName, hemisId: h, group: gid } });
});

/* ── Admin: guruh yaratish ──
 * Body: name
 */
router.post('/api/admin/classrooms/groups', requireAdminMfaStepUp, async (req, res) => {
  const { name } = req.body || {};
  const gid = classroomGroupId(name);
  if (!gid) return res.status(400).json({ ok: false, error: 'Guruh nomi noto‘g‘ri' });
  const existing = await fb.get(`groups/${gid}`);
  if (existing.exists()) {
    return res.status(409).json({ ok: false, error: 'Bunaqa guruh allaqachon mavjud' });
  }
  const ctx = roleCtx(req);
  await fb.set(`groups/${gid}`, {
    name: normalizeGroupName(name),
    code: gid,
    created_by: ctx.safeKey,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  res.json({ ok: true, group: { id: gid, name: normalizeGroupName(name) } });
});

/* ── Admin: guruhga o'qituvchi biriktirish ──
 * Body: teacherUsername
 */
router.post('/api/admin/classrooms/groups/:id/teacher', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId } = req.params;
  const { teacherUsername } = req.body || {};
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`groups/${groupId}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });

  const tKey = classroomUserKey(teacherUsername);
  if (!tKey) return res.status(400).json({ ok: false, error: "O'qituvchi username noto'g'ri" });
  const teacherSnap = await fb.get(`users/${tKey}`);
  if (!teacherSnap.exists() || teacherSnap.val().role !== 'teacher') {
    return res.status(404).json({ ok: false, error: "O'qituvchi topilmadi yoki roli 'teacher' emas" });
  }

  await fb.set(`groups/${groupId}/teachers/${tKey}`, {
    userId: tKey,
    username: teacherSnap.val().username || tKey,
    assigned_at: Date.now(),
    assigned_by: roleCtx(req).safeKey,
  });
  await fb.set(`users/${tKey}/groups_teaching/${groupId}`, { assigned_at: Date.now(), role: 'teacher' });
  res.json({ ok: true });
});

/* ── Admin: o'quvchini guruhdan o'chirish ──
 * DELETE /api/admin/classrooms/groups/:id/members/:userId
 */
router.delete('/api/admin/classrooms/groups/:id/members/:userId', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId, userId } = req.params;
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '') || !/^[a-z0-9_-]{2,60}$/.test(userId || '')) {
    return res.status(400).json({ ok: false, error: 'Noto‘g‘ri identifikator' });
  }
  await fb.remove(`groups/${groupId}/members/${userId}`);
  await fb.remove(`users/${userId}/groups_teaching/${groupId}`);
  await fb.remove(`users/${userId}/group`);
  res.json({ ok: true });
});

/* ── Admin: o'quvchi ro'yxati ──
 * GET /api/admin/classrooms/students?group=<gid>
 */
router.get('/api/admin/classrooms/students', requireAdmin, async (req, res) => {
  const { group } = req.query;
  const groupsSnap = await fb.get('groups');
  const groups = groupsSnap.exists() ? groupsSnap.val() || {} : {};
  const rows = [];
  for (const [gid, g] of Object.entries(groups)) {
    if (group && gid !== group) continue;
    const mSnap = await fb.get(`groups/${gid}/members`);
    const members = mSnap.exists() ? mSnap.val() || {} : {};
    for (const [uid, m] of Object.entries(members)) {
      rows.push({
        userId: uid,
        group: gid,
        groupName: g.name || gid,
        firstName: m.firstName || '',
        lastName: m.lastName || '',
        hemisId: m.hemisId || '',
        joined_at: m.joined_at,
        source: m.source || 'admin',
      });
    }
  }
  res.json({ ok: true, groups: Object.entries(groups).map(([id, g]) => ({ id, name: g.name || id })), students: rows });
});

/* ── Admin: grade policy ──
 * POST /api/admin/classrooms/groups/:id/grade-policy
 */
router.post('/api/admin/classrooms/groups/:id/grade-policy', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId } = req.params;
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`groups/${groupId}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });
  const validated = validateGradePolicy(req.body);
  if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error });
  await fb.set(`groups/${groupId}/gradePolicy`, {
    ...validated.policy,
    updated_at: Date.now(),
    updated_by: roleCtx(req).safeKey,
  });
  res.json({ ok: true, gradePolicy: validated.policy });
});

/* ── Admin: geofence ──
 * POST /api/admin/classrooms/groups/:id/geofence
 */
router.post('/api/admin/classrooms/groups/:id/geofence', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId } = req.params;
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`groups/${groupId}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });
  const validated = validateClassroomLocation(req.body);
  if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error });
  await fb.set(`groups/${groupId}/geofence`, {
    ...validated.geofence,
    updated_at: Date.now(),
    updated_by: roleCtx(req).safeKey,
  });
  res.json({ ok: true, geofence: validated.geofence });
});

/* ── Admin: geofence o'chirish ──
 * DELETE /api/admin/classrooms/groups/:id/geofence
 */
router.delete('/api/admin/classrooms/groups/:id/geofence', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId } = req.params;
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  await fb.remove(`groups/${groupId}/geofence`);
  res.json({ ok: true });
});

/* ── QR token (admin/teacher) ──
 * GET /api/classrooms/qr/token?group=<id>
 */
router.get('/api/classrooms/qr/token', requireAdmin, async (req, res) => {
  const { group } = req.query;
  const gid = classroomGroupId(group);
  if (!gid) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`groups/${gid}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });
  const token = sha256(JSON.stringify({ group: gid, t: Date.now() }) + '|' + Math.random().toString(36).slice(2, 12));
  await fb.set(`classrooms_qr_tokens/${token}`, { group: gid, created_at: Date.now(), expires_at: Date.now() + CLASSROOM_QR_TTL_MS });
  res.json({ ok: true, token, url: `${req.protocol}://${req.get('host')}/classrooms/checkin?token=${encodeURIComponent(token)}`, expires_at: Date.now() + CLASSROOM_QR_TTL_MS });
});

/* ── QR check-in (public) ──
 * POST /api/classrooms/checkin  body: { token, name, latitude, longitude }
 */
router.post('/api/classrooms/checkin', async (req, res) => {
  const { token, name, latitude, longitude } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Token kerak' });
  const snap = await fb.get(`classrooms_qr_tokens/${token}`);
  if (!snap.exists()) return res.status(404).json({ ok: false, error: 'Token noto‘g‘ri yoki mudtati tugagan' });
  const rec = snap.val();
  if (Date.now() > rec.expires_at) { await fb.remove(`classrooms_qr_tokens/${token}`); return res.status(410).json({ ok: false, error: 'QR mudtati tugagan' }); }
  const groupId = rec.group;
  const cleanName = normalizePersonName(name);
  if (!cleanName) return res.status(400).json({ ok: false, error: 'Ism kiriting' });

  const groupSnap = await fb.get(`groups/${groupId}`);
  const geofence = groupSnap.exists() ? groupSnap.val().geofence : null;
  let inRange = true;
  if (geofence && latitude != null && longitude != null) {
    // Haversine (qarama-qarshi yulduzcha uchun ko'rinish saqlanmaydi)
    const rad = (v) => (v * Math.PI) / 180;
    const R = 6_371_000;
    const dLat = rad(geofence.latitude - Number(latitude));
    const dLon = rad(geofence.longitude - Number(longitude));
    const la1 = rad(geofence.latitude);
    const la2 = rad(Number(latitude));
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    inRange = dist <= geofence.radiusMeters;
  }

  const memberKey = safeKey(cleanName);
  await fb.set(`groups/${groupId}/checkins/${memberKey}`, {
    name: cleanName,
    group: groupId,
    checked_in_at: Date.now(),
    inRange,
  });
  await fb.remove(`classrooms_qr_tokens/${token}`);
  res.json({ ok: true, group: groupId, name: cleanName, inRange });
});

/* ── Teacher: o'z guruhlari ──
 * GET /api/teacher/classrooms/groups
 */
router.get('/api/teacher/classrooms/groups', requireRole('teacher'), async (req, res) => {
  const ctx = roleCtx(req);
  const groupsSnap = await fb.get('groups');
  const groups = groupsSnap.exists() ? groupsSnap.val() || {} : {};
  const mine = [];
  for (const [id, g] of Object.entries(groups)) {
    const teachers = g.teachers || {};
    if (teachers[ctx.safeKey]) {
      const mSnap = await fb.get(`groups/${id}/members`);
      const members = mSnap.exists() ? mSnap.val() || {} : {};
      mine.push({ id, name: g.name || id, code: g.code || id, memberCount: Object.keys(members).length });
    }
  }
  res.json({ ok: true, groups: mine });
});

/* ── Teacher: guruhning o'quvchilari ──
 * GET /api/teacher/classrooms/groups/:id/students
 */
router.get('/api/teacher/classrooms/groups/:id/students', requireRole('teacher'), async (req, res) => {
  const { id: groupId } = req.params;
  const ctx = roleCtx(req);
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`groups/${groupId}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });
  const teachers = groupSnap.val().teachers || {};
  if (!teachers[ctx.safeKey]) {
    return res.status(403).json({ ok: false, error: 'Bu guruhga kirish huquqi yo‘q' });
  }
  const mSnap = await fb.get(`groups/${groupId}/members`);
  const members = mSnap.exists() ? mSnap.val() || {} : {};
  const policySnap = await fb.get(`groups/${groupId}/gradePolicy`);
  const geoSnap = await fb.get(`groups/${groupId}/geofence`);
  const students = [];
  for (const [uid, m] of Object.entries(members)) {
    students.push({
      userId: uid,
      firstName: m.firstName || '',
      lastName: m.lastName || '',
      displayName: classroomDisplayName(m),
      hemisId: m.hemisId || '',
      group: groupId,
      joined_at: m.joined_at,
    });
  }
  res.json({
    ok: true,
    group: { id: groupId, name: groupSnap.val().name || groupId },
    students,
    gradePolicy: policySnap.exists() ? policySnap.val() : DEFAULT_GRADE_POLICY,
    geofence: geoSnap.exists() ? geoSnap.val() : null,
  });
});

/* ── Teacher: o'quvchi bazaviy baho (ichki journal, HEMIS-ga sinq yo'q) ──
 * GET /api/teacher/classrooms/groups/:id/students/:userId/grade?questionCount=N&answers=[...]
 */
router.get('/api/teacher/classrooms/groups/:id/students/:userId/grade', requireRole('teacher'), async (req, res) => {
  const { id: groupId, userId } = req.params;
  const ctx = roleCtx(req);
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '') || !/^[a-z0-9_-]{2,60}$/.test(userId || '')) {
    return res.status(400).json({ ok: false, error: 'Noto‘g‘ri identifikator' });
  }
  const groupSnap = await fb.get(`groups/${groupId}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });
  const teachers = groupSnap.val().teachers || {};
  if (!teachers[ctx.safeKey]) return res.status(403).json({ ok: false, error: "Huquq yo'q" });
  const member = await fb.get(`groups/${groupId}/members/${userId}`);
  if (!member.exists()) return res.status(404).json({ ok: false, error: "O'quvchi a'zo emas" });
  const policySnap = await fb.get(`groups/${groupId}/gradePolicy`);
  const questionCount = Number(req.query.questionCount || 0);
  const answers = req.query.answers ? (() => {
    try { return JSON.parse(req.query.answers); } catch (_) { return []; }
  })() : [];
  const result = calculateClassroomGrade({
    answers,
    questionCount,
    policy: policySnap.exists() ? policySnap.val() : DEFAULT_GRADE_POLICY,
  });
  res.json({ ok: true, student: { userId, ...member.val(), displayName: classroomDisplayName(member.val()) }, grade: result });
});

/* ── O'quvchi o'z bahosi ──
 * GET /api/user/classrooms/students/me/grade
 */
router.get('/api/user/classrooms/students/me/grade', requireRole('student'), async (req, res) => {
  const ctx = roleCtx(req);
  const userSnap = await fb.get(`users/${ctx.safeKey}`);
  const groupId = userSnap.exists() && userSnap.val().group ? userSnap.val().group : null;
  if (!groupId) return res.status(404).json({ ok: false, error: "Siz hech qaysi guruhga biriktirilmagansiz" });
  const policySnap = await fb.get(`groups/${groupId}/gradePolicy`);
  const questionCount = Number(req.query.questionCount || 0);
  const answers = req.query.answers ? (() => {
    try { return JSON.parse(req.query.answers); } catch (_) { return []; }
  })() : [];
  const result = calculateClassroomGrade({
    answers,
    questionCount,
    policy: policySnap.exists() ? policySnap.val() : DEFAULT_GRADE_POLICY,
  });
  res.json({ ok: true, group: groupId, grade: result });
});

/* ── Admin sinf boshqaruvi sahifasi ──
 * GET /classrooms/index
 */
router.get('/classrooms/index', requireAdmin, async (req, res) => {
  res.render('classrooms/index', { title: 'Sinf boshqaruvi' });
});

/* ── QR check-in sahifasi ──
 * GET /classrooms/checkin?token=...
 */
router.get('/classrooms/checkin', async (req, res) => {
  const { token } = req.query || {};
  if (!token) return res.redirect('/');
  res.render('classrooms/checkin', { title: 'Sinfga kirish', token });
});

export default router;
