/**
 * Deborah — O‘quvchi o‘quv rejimi (sinf / guruh / o‘quvchi)
 * -----------------------------------------------------------
 * Admin uchun: o‘quvchi/barcha ro‘yxatni boshqarish, guruh yaratish,
 * guruhga o‘quvchini qo‘shish, bazaviy grade policy sozlash,
 * sinf QR kodi (geofence bilan) olish.
 * O‘qituvchi uchun: o‘zga biriktirilgan guruhlar, o‘quvchilar va
 * ichki grade journal (HEMIS-ga sinq qilinmaydi).
 *
 * Barcha mutation yo‘llar requireAdminMfaStepUp yoki requireAdmin orqali
 * himoyalangan. O‘qituvchi o‘z guruhlariga ega bo‘lgan batafsil journalga
 * ega bo‘ladi.
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
  distanceMeters,
  classroomDisplayName,
  DEFAULT_GRADE_POLICY,
  CLASSROOM_QR_TTL_MS,
  CLASSROOM_JOIN_TICKET_TTL_MS,
  sha256,
} from '../src/modules/classrooms/service.js';

const router = Router();

/* ── QR check-in ticket (imza bilan, muddatli) ──
 * GET /api/classrooms/qr/token?group=<id>   (admin/teacher)
 * POST /api/classrooms/checkin               (public — QR orqali ochiladi)
 * Body: { token, name, latitude, longitude }
 */
function signQrToken(payload) {
  return sha256(JSON.stringify(payload) + '|' + Date.now() + '|' + Math.random().toString(36).slice(2, 12));
}

router.get('/api/classrooms/qr/token', requireAdmin, async (req, res) => {
  const { group } = req.query;
  const gid = classroomGroupId(group);
  if (!gid) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`classrooms/groups/${gid}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });
  const token = signQrToken({ group: gid, t: Date.now() });
  await fb.set(`classrooms/qr_tokens/${token}`, { group: gid, created_at: Date.now(), expires_at: Date.now() + CLASSROOM_QR_TTL_MS });
  res.json({ ok: true, token, url: `${req.protocol}://${req.get('host')}/classrooms/checkin?token=${encodeURIComponent(token)}`, expires_at: Date.now() + CLASSROOM_QR_TTL_MS });
});

router.post('/api/classrooms/checkin', async (req, res) => {
  const { token, name, latitude, longitude } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Token kerak' });
  const snap = await fb.get(`classrooms/qr_tokens/${token}`);
  if (!snap.exists()) return res.status(404).json({ ok: false, error: 'Token noto‘g‘ri yoki mudtati tugagan' });
  const rec = snap.val();
  if (Date.now() > rec.expires_at) { await fb.remove(`classrooms/qr_tokens/${token}`); return res.status(410).json({ ok: false, error: 'QR mudtati tugagan' }); }
  const groupId = rec.group;
  const cleanName = normalizePersonName(name);
  if (!cleanName) return res.status(400).json({ ok: false, error: 'Ism kiriting' });

  const groupSnap = await fb.get(`classrooms/groups/${groupId}`);
  const geofence = groupSnap.exists() ? groupSnap.val().geofence : null;
  let inRange = true;
  if (geofence && latitude != null && longitude != null) {
    const distance = distanceMeters({ latitude: geofence.latitude, longitude: geofence.longitude }, { latitude: Number(latitude), longitude: Number(longitude) });
    inRange = distance <= geofence.radiusMeters;
  }

  const memberKey = safeKey(cleanName);
  await fb.set(`classrooms/checkins/${groupId}/${memberKey}`, {
    name: cleanName,
    group: groupId,
    checked_in_at: Date.now(),
    inRange,
  });
  await fb.remove(`classrooms/qr_tokens/${token}`);
  res.json({ ok: true, group: groupId, name: cleanName, inRange });
});

/* ── Admin sinf boshqaruvi sahifasi ──
 * GET /classrooms/index
 */
router.get('/classrooms/index', requireAdmin, async (req, res) => {
  res.render('classrooms/index', { title: 'Sinf boshqaruvi' });
});

/* ── QR check-in page ──
 * GET /classrooms/checkin?token=...
 */
router.get('/classrooms/checkin', async (req, res) => {
  const { token } = req.query || {};
  if (!token) return res.redirect('/');
  res.render('classrooms/checkin', { title: 'Sinfga kirish', token });
});

/* ── teacher: check-in journal (baza, HEMIS-ga sinq yo‘q) ──
 * GET /api/teacher/classrooms/groups/:id/checkins
 */
router.get('/api/teacher/classrooms/groups/:id/checkins', requireRole('teacher'), async (req, res) => {
  const { id: groupId } = req.params;
  const ctx = roleCtx(req);
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const teachers = await fb.get(`classrooms/groups/${groupId}/teachers`);
  if (!(teachers.exists() && teachers.val()[ctx.safeKey])) return res.status(403).json({ ok: false, error: "Huquq yo'q" });
  const snap = await fb.get(`classrooms/checkins/${groupId}`);
  const all = snap.exists() ? snap.val() || {} : {};
  const rows = Object.entries(all).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => (b.checked_in_at || 0) - (a.checked_in_at || 0));
  res.json({ ok: true, checkins: rows });
});


/* ── helpers ────────────────────────────────────────────────────── */

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

async function getAllUsers() {
  const snap = await fb.get('users');
  return snap.exists() ? snap.val() || {} : {};
}

/* ── admin: qisqa o‘quvchi yaratish (bemoriy ro‘yxat) ──
 * Body: firstName, lastName, group, hemisId, username
 *   - group: mavjud guruh kodi yoki yangi nom (yaratiladi)
 *   - hemisId: majburiy, unikal
 *   - username: agar mavjud bo‘lsa — bu hisobga biriktiriladi;
 *     bo‘lmasa — avtomatik yangi student hisob yaratiladi (parol yo‘q,
 *     faqat ro‘yxatda; avtorizatsiya invite orqali)
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

  const users = await getAllUsers();
  // HEMIS ID unikalligini tekshirish
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
      // Yangi ro‘yxat hisob — faqat ro‘yxat joyida, parol yo‘q
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

  // O‘quvchini guruhga biriktirish (idempotent)
  if (targetKey) {
    await fb.set(`classrooms/groups/${gid}/members/${targetKey}`, {
      userId: targetKey,
      hemisId: h,
      firstName: first,
      lastName: last,
      group: gid,
      joined_at: Date.now(),
      source: 'admin',
    });
    await fb.set(`users/${targetKey}/classrooms/${gid}`, { joined_at: Date.now(), role: 'member' });
    // Agar user record bo‘lsa — group/hemisId yangilaymiz
    const existingUser = await fb.get(`users/${targetKey}`);
    if (existingUser.exists()) {
      await fb.update(`users/${targetKey}`, {
        firstName,
        lastName,
        hemisId: h,
        group: gid,
      });
    }
  }

  await fb.set(`classrooms/hemis_index/${h}`, {
    userId: targetKey || null,
    group: gid,
    firstName,
    lastName,
    indexed_at: Date.now(),
  });

  res.json({ ok: true, student: { key: targetKey, firstName, lastName, hemisId: h, group: gid } });
});

/* ── admin: guruh yaratish ──
 * Body: name
 */
router.post('/api/admin/classrooms/groups', requireAdminMfaStepUp, async (req, res) => {
  const { name } = req.body || {};
  const gid = classroomGroupId(name);
  if (!gid) return res.status(400).json({ ok: false, error: 'Guruh nomi noto‘g‘ri' });

  const existing = await fb.get(`classrooms/groups/${gid}`);
  if (existing.exists()) {
    return res.status(409).json({ ok: false, error: 'Bunaqa guruh allaqachon mavjud' });
  }

  const ctx = roleCtx(req);
  await fb.set(`classrooms/groups/${gid}`, {
    name: normalizeGroupName(name),
    code: gid,
    created_by: ctx.safeKey,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  res.json({ ok: true, group: { id: gid, name: normalizeGroupName(name) } });
});

/* ── admin: guruhga o‘qituvchi biriktirish (o‘qituvchi o‘z guruhini ko‘radi) ──
 * Body: groupId, teacherUsername (foydalanuvchi roli 'teacher' bo‘lishi kerak)
 */
router.post('/api/admin/classrooms/groups/:id/teacher', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId } = req.params;
  const { teacherUsername } = req.body || {};
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`classrooms/groups/${groupId}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });

  const tKey = classroomUserKey(teacherUsername);
  if (!tKey) return res.status(400).json({ ok: false, error: "O'qituvchi username noto'g'ri" });
  const teacherSnap = await fb.get(`users/${tKey}`);
  if (!teacherSnap.exists() || teacherSnap.val().role !== 'teacher') {
    return res.status(404).json({ ok: false, error: "O'qituvchi topilmadi yoki roli 'teacher' emas" });
  }

  await fb.set(`classrooms/groups/${groupId}/teachers/${tKey}`, {
    userId: tKey,
    username: teacherSnap.val().username || tKey,
    assigned_at: Date.now(),
    assigned_by: roleCtx(req).safeKey,
  });
  await fb.set(`users/${tKey}/classroom_groups/${groupId}`, { assigned_at: Date.now(), role: 'teacher' });
  res.json({ ok: true });
});

/* ── admin: o‘quvchi o‘chirish (gurhdan) ──
 * DELETE /api/admin/classrooms/groups/:id/members/:userId
 */
router.delete('/api/admin/classrooms/groups/:id/members/:userId', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId, userId } = req.params;
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '') || !/^[a-z0-9_-]{2,60}$/.test(userId || '')) {
    return res.status(400).json({ ok: false, error: 'Noto‘g‘ri identifikator' });
  }
  await fb.remove(`classrooms/groups/${groupId}/members/${userId}`);
  await fb.remove(`users/${userId}/classrooms/${groupId}`);
  res.json({ ok: true });
});

/* ── admin: o‘quvchi ro‘yxati (barcha guruhlar) ──
 * GET /api/admin/classrooms/students?group=<gid>
 */
router.get('/api/admin/classrooms/students', requireAdmin, async (req, res) => {
  const { group } = req.query;
  const groupsSnap = await fb.get('classrooms/groups');
  const groups = groupsSnap.exists() ? groupsSnap.val() || {} : {};
  const membersSnap = await fb.get('classrooms/members');
  let allMembers = membersSnap.exists() ? membersSnap.val() || {} : {};
  if (group) {
    if (!groups[group]) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });
    const gSnap = await fb.get(`classrooms/groups/${group}/members`);
    allMembers = gSnap.exists() ? gSnap.val() || {} : {};
  }
  const rows = [];
  for (const [gid, g] of Object.entries(groups)) {
    if (group && gid !== group) continue;
    const mSnap = await fb.get(`classrooms/groups/${gid}/members`);
    const members = mSnap.exists() ? mSnap.val() || {} : {};
    for (const [uid, m] of Object.entries(members)) {
      const hemis = await fb.get(`classrooms/hemis_index/${m.hemisId || ''}`);
      rows.push({
        userId: uid,
        group: gid,
        groupName: g.name || gid,
        firstName: m.firstName || '',
        lastName: m.lastName || '',
        hemisId: m.hemisId || (hemis.exists() ? '' : ''),
        joined_at: m.joined_at,
        source: m.source || 'admin',
      });
    }
  }
  res.json({ ok: true, groups: Object.entries(groups).map(([id, g]) => ({ id, name: g.name || id })), students: rows });
});

/* ── admin: grade policy o‘rnatish/Yangilash ──
 * POST /api/admin/classrooms/groups/:id/grade-policy
 * Body: { weights: {accuracy, speed}, thresholds: [{minPercent,grade}], below }
 */
router.post('/api/admin/classrooms/groups/:id/grade-policy', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId } = req.params;
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`classrooms/groups/${groupId}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });

  const validated = validateGradePolicy(req.body);
  if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error });

  await fb.set(`classrooms/groups/${groupId}/gradePolicy`, {
    ...validated.policy,
    updated_at: Date.now(),
    updated_by: roleCtx(req).safeKey,
  });
  res.json({ ok: true, gradePolicy: validated.policy });
});

/* ── admin: sinf geofence (QR radiusi/nuqta) ──
 * POST /api/admin/classrooms/groups/:id/geofence
 * Body: { latitude, longitude, radiusMeters }
 */
router.post('/api/admin/classrooms/groups/:id/geofence', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId } = req.params;
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  const groupSnap = await fb.get(`classrooms/groups/${groupId}`);
  if (!groupSnap.exists()) return res.status(404).json({ ok: false, error: 'Guruh topilmadi' });

  const validated = validateClassroomLocation(req.body);
  if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error });

  await fb.set(`classrooms/groups/${groupId}/geofence`, {
    ...validated.geofence,
    updated_at: Date.now(),
    updated_by: roleCtx(req).safeKey,
  });
  res.json({ ok: true, geofence: validated.geofence });
});

/* ── admin: geofence-ni o‘chirish ──
 * DELETE /api/admin/classrooms/groups/:id/geofence
 */
router.delete('/api/admin/classrooms/groups/:id/geofence', requireAdminMfaStepUp, async (req, res) => {
  const { id: groupId } = req.params;
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });
  await fb.remove(`classrooms/groups/${groupId}/geofence`);
  res.json({ ok: true });
});

/* ── teacher: o‘z guruhlari ──
 * GET /api/teacher/classrooms/groups
 */
router.get('/api/teacher/classrooms/groups', requireRole('teacher'), async (req, res) => {
  const ctx = roleCtx(req);
  const groupsSnap = await fb.get('classrooms/groups');
  const groups = groupsSnap.exists() ? groupsSnap.val() || {} : {};
  const mine = [];
  for (const [id, g] of Object.entries(groups)) {
    const teachers = await fb.get(`classrooms/groups/${id}/teachers`);
    const t = teachers.exists() ? teachers.val() || {} : {};
    if (t[ctx.safeKey]) {
      mine.push({ id, name: g.name || id, code: g.code || id, memberCount: Object.keys(g.members || {}).length });
    }
  }
  res.json({ ok: true, groups: mine });
});

/* ── teacher: guruhning o‘quvchilari ──
 * GET /api/teacher/classrooms/groups/:id/students
 */
router.get('/api/teacher/classrooms/groups/:id/students', requireRole('teacher'), async (req, res) => {
  const { id: groupId } = req.params;
  const ctx = roleCtx(req);
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '')) return res.status(400).json({ ok: false, error: 'Guruh noto‘g‘ri' });

  const teachers = await fb.get(`classrooms/groups/${groupId}/teachers`);
  if (!(teachers.exists() && teachers.val()[ctx.safeKey])) {
    return res.status(403).json({ ok: false, error: 'Bu guruhga kirish huquqi yo‘q' });
  }

  const groupSnap = await fb.get(`classrooms/groups/${groupId}`);
  const mSnap = await fb.get(`classrooms/groups/${groupId}/members`);
  const members = mSnap.exists() ? mSnap.val() || {} : {};
  const policySnap = await fb.get(`classrooms/groups/${groupId}/gradePolicy`);
  const geoSnap = await fb.get(`classrooms/groups/${groupId}/geofence`);

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
    group: { id: groupId, name: groupSnap.exists() ? groupSnap.val().name : groupId },
    students,
    gradePolicy: policySnap.exists() ? policySnap.val() : DEFAULT_GRADE_POLICY,
    geofence: geoSnap.exists() ? geoSnap.val() : null,
  });
});

/* ── teacher: o‘quvchi bazaviy natijasi (ichki journal, HEMIS-ga sinq yo‘q) ──
 * GET /api/teacher/classrooms/groups/:id/students/:userId/grade
 * Query: answers JSON massivi [{questionId,isCorrect,score}] va questionCount
 */
router.get('/api/teacher/classrooms/groups/:id/students/:userId/grade', requireRole('teacher'), async (req, res) => {
  const { id: groupId, userId } = req.params;
  const ctx = roleCtx(req);
  if (!/^[a-z0-9_-]{2,60}$/.test(groupId || '') || !/^[a-z0-9_-]{2,60}$/.test(userId || '')) {
    return res.status(400).json({ ok: false, error: 'Noto‘g‘ri identifikator' });
  }

  const teachers = await fb.get(`classrooms/groups/${groupId}/teachers`);
  if (!(teachers.exists() && teachers.val()[ctx.safeKey])) {
    return res.status(403).json({ ok: false, error: 'Bu guruhga kirish huquqi yo‘q' });
  }

  const member = await fb.get(`classrooms/groups/${groupId}/members/${userId}`);
  if (!member.exists()) return res.status(404).json({ ok: false, error: "O'quvchi a'zo emas" });

  const policySnap = await fb.get(`classrooms/groups/${groupId}/gradePolicy`);
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

/* ── o‘quvchi o‘z bazaviy natijasi ──
 * GET /api/user/classrooms/students/me/grade — o‘z guruhidagi bazaviy natija
 */
router.get('/api/user/classrooms/students/me/grade', requireRole('student'), async (req, res) => {
  const ctx = roleCtx(req);
  const member = await fb.get(`classrooms/members/${ctx.safeKey}`);
  const groupId = member.exists() && member.val().group ? member.val().group : null;
  if (!groupId) return res.status(404).json({ ok: false, error: "Siz hech qaysi guruhga biriktirilmagansiz" });

  const policySnap = await fb.get(`classrooms/groups/${groupId}/gradePolicy`);
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

export default router;
