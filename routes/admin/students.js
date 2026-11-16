/**
 * Deborah — Admin Student Management
 * Admin adds students (ism, familiya, guruh, yonalish), creates groups, assigns to teachers
 */

import { Router } from 'express';
import { fb } from '../../firebase/admin.js';
import { requireAdmin, requireAdminMfaStepUp } from '../../middleware/auth.js';
import { safeKey } from '../../utils/helpers.js';
import { DB_PATHS } from '../../utils/constants.js';
import { AUDIT_ACTIONS, logAuthEvent } from '../../src/modules/auth/audit.js';

const router = Router();
router.use(requireAdmin);

// ── GET /admin/students — Barcha talabalar ro'yxati ──
router.get('/students', async (req, res) => {
  try {
    const snap = await fb.get('students');
    const students = snap.exists() ? snap.val() : {};

    // Group students by group_id
    const groupsMap = {};
    Object.entries(students).forEach(([key, s]) => {
      const gid = s.group_id || 'ungsish';
      if (!groupsMap[gid]) groupsMap[gid] = [];
      groupsMap[gid].push({ id: key, ...s });
    });

    // Get groups for dropdown
    const groupsSnap = await fb.get('groups');
    const groups = groupsSnap.exists() ? groupsSnap.val() : {};

    // Get teachers for assignment dropdown
    const usersSnap = await fb.get('users');
    const users = usersSnap.exists() ? usersSnap.val() : {};
    const teachers = Object.entries(users)
      .filter(([, u]) => u.role === 'teacher' || u.role === 'teacher_pending')
      .map(([key, u]) => ({ id: key, username: u.username || key, name: u.name || u.username || key }));

    res.render('admin/students', {
      title: 'Talabalar boshqaruvi',
      students: Object.entries(students).map(([key, s]) => ({ id: key, ...s })),
      groups,
      teachers,
      activeTab: 'students',
      csrfToken: req.session?.csrfToken || '',
    });
  } catch (err) {
    console.error('Students page error:', err);
    res.render('admin/students', { title: 'Talabalar boshqaruvi', students: [], groups: {}, teachers: [], error: err.message, csrfToken: '' });
  }
});

// ── POST /admin/api/students — Yangi talaba qo'shish ──
router.post('/api/students', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { ism, familiya, guruh, yonalish, group_id } = req.body;
    if (!ism || !familiya) return res.status(400).json({ error: 'Ism va familiya majburiy' });

    const studentKey = safeKey(`${ism}_${familiya}_${Date.now()}`);
    await fb.set(`students/${studentKey}`, {
      ism,
      familiya,
      guruh: guruh || '',
      yonalish: yonalish || '',
      group_id: group_id || '',
      created_at: Date.now(),
      created_by: req.session.admin?.username || 'admin',
    });

    await logAuthEvent({
      action: AUDIT_ACTIONS.STUDENT_ADDED,
      outcome: 'success',
      actorId: req.session.admin?.username || 'admin',
      details: { studentId: studentKey, ism, familiya, guruh, yonalish, group_id },
    });

    res.json({ success: true, studentId: studentKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/api/students/:id — Talabani o'chirish ──
router.delete('/api/students/:id', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { id } = req.params;
    await fb.remove(`students/${id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/students/:id/move — Talabani boshqa guruhga o'tqizish ──
router.post('/api/students/:id/move', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { id } = req.params;
    const { group_id } = req.body;
    await fb.update(`students/${id}`, { group_id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/api/groups — Barcha guruhlar ──
router.get('/api/groups', async (req, res) => {
  try {
    const snap = await fb.get('groups');
    const groups = snap.exists() ? snap.val() : {};
    const list = Object.entries(groups).map(([key, g]) => ({ id: key, ...g }));
    res.json({ groups: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/groups — Yangi guruh yaratish (o'qituvchi biriktirish bilan) ──
router.post('/api/groups', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { title, teacherId, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Guruh nomi majburiy' });
    const groupKey = safeKey(`group_${title}_${Date.now()}`);
    await fb.set(`groups/${groupKey}`, {
      title,
      teacherId: teacherId || '',
      description: description || '',
      created_at: Date.now(),
      created_by: req.session.admin?.username || 'admin',
    });
    await logAuthEvent({
      action: AUDIT_ACTIONS.STUDENT_ADDED,
      outcome: 'success',
      actorId: req.session.admin?.username || 'admin',
      details: { action: 'group:create', groupId: groupKey, title, teacherId },
    });
    res.json({ success: true, groupId: groupKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /admin/api/groups/:id — Guruhni tahrirlash (o'qituvchi biriktirish) ──
router.put('/api/groups/:id', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, teacherId, description } = req.body;
    await fb.update(`groups/${id}`, {
      ...(title !== undefined ? { title } : {}),
      ...(teacherId !== undefined ? { teacherId } : {}),
      ...(description !== undefined ? { description } : {}),
      updated_at: Date.now(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/api/groups/:id — Guruhni o'chirish ──
router.delete('/api/groups/:id', requireAdminMfaStepUp, async (req, res) => {
  try {
    const { id } = req.params;
    await fb.remove(`groups/${id}`);
    // Barcha o'quvchilardan guruh_id ni tozalash
    const studentsSnap = await fb.get('students');
    if (studentsSnap.exists()) {
      const students = studentsSnap.val();
      for (const [key, s] of Object.entries(students)) {
        if (s.group_id === id) {
          await fb.update(`students/${key}`, { group_id: '' });
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
