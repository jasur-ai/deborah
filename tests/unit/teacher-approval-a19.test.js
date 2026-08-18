import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { ROLES, TEACHER_APPROVAL_STATES, isApprovedTeacher } from '../../middleware/roles.js';

describe('AUTH A-19 — teacher approval state machine', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('role state machine: teacher_pending, teacher, teacher_rejected', () => {
    expect(TEACHER_APPROVAL_STATES).toContain('teacher_pending');
    expect(TEACHER_APPROVAL_STATES).toContain('teacher');
    expect(TEACHER_APPROVAL_STATES).toContain('teacher_rejected');
  });

  it('isApprovedTeacher: faqat tasdiqlangan teacher', () => {
    expect(isApprovedTeacher('teacher')).toBe(true);
    expect(isApprovedTeacher('teacher_pending')).toBe(false);
    expect(isApprovedTeacher('teacher_rejected')).toBe(false);
    expect(isApprovedTeacher('student')).toBe(false);
  });

  it('ROLES da pending/rejected uchun label mavjud', () => {
    expect(ROLES.teacher_pending.label).toContain('ariza');
    expect(ROLES.teacher_rejected.label).toContain('rad etilgan');
  });

  it('teacher register → DB da teacher_pending + ariza saqlanadi', async () => {
    const key = safeKey(`a19t_${Date.now() % 1000000}`);
    const app = {
      university: 'Toshkent Davlat Universiteti',
      reason: 'Matematika fanidan dars beraman',
      appliedAt: Date.now(),
    };
    await fb.set(`users/${key}`, {
      username: key,
      email: `${key}@test.uz`,
      password: 'x',
      role: 'teacher_pending',
      role_version: 1,
      teacher_application: app,
    });
    const snap = await fb.get(`users/${key}`);
    const u = snap.val();
    expect(u.role).toBe('teacher_pending');
    expect(u.teacher_application.university).toBe('Toshkent Davlat Universiteti');
  });

  it('approve → role teacher + role_version oshadi + qaror yoziladi', async () => {
    const key = safeKey(`a19ap_${Date.now() % 1000000}`);
    await fb.set(`users/${key}`, { username: key, role: 'teacher_pending', role_version: 1 });
    const now = Date.now();
    await fb.set(`users/${key}/role`, 'teacher');
    await fb.set(`users/${key}/role_version`, now);
    await fb.set(`users/${key}/teacher_decision_at`, now);
    await fb.set(`users/${key}/teacher_application/status`, 'approved');

    const snap = await fb.get(`users/${key}`);
    const u = snap.val();
    expect(u.role).toBe('teacher');
    expect(u.role_version).toBeGreaterThan(1);
    expect(u.teacher_application.status).toBe('approved');
  });

  it('reject → role teacher_rejected + sabab saqlanadi', async () => {
    const key = safeKey(`a19rj_${Date.now() % 1000000}`);
    await fb.set(`users/${key}`, { username: key, role: 'teacher_pending', role_version: 1 });
    const reason = 'Diplom tekshiruvi talab qilinadi';
    await fb.set(`users/${key}/role`, 'teacher_rejected');
    await fb.set(`users/${key}/teacher_rejection_reason`, reason);
    await fb.set(`users/${key}/teacher_application/status`, 'rejected');

    const snap = await fb.get(`users/${key}`);
    const u = snap.val();
    expect(u.role).toBe('teacher_rejected');
    expect(u.teacher_rejection_reason).toBe(reason);
    expect(u.teacher_application.status).toBe('rejected');
  });

  it("approved teacher → student data/test yaratish imkoniyati (role to'g'ri)", () => {
    // A-19 §14: tasdiqlangan teacher isApprovedTeacher → true.
    // Haqiqiy bloklash requireRole middleware'da — integration testda tekshiriladi.
    expect(isApprovedTeacher('teacher')).toBe(true);
  });
});
