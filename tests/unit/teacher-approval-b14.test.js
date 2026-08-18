/**
 * AUTH B-14 — Teacher approval: state machine + schema (Entra PIM)
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - validateTeacherTransition: yaroqli/noto'g'ri o'tishlar + cooldown qoidasi
 *  - getCooldownUntil: reject'dan keyin 30 kun
 *  - submitTeacherApplication: canonical teacher_applications/{id} record
 *    (B-14 §07 barcha maydonlar) + inline + ok
 *  - submitTeacherApplication: teacher_rejected + cooldown faol → blok
 *  - decideTeacherApplication approve: role teacher + record approved + reviewed_by
 *  - decideTeacherApplication reject: role teacher_rejected + cooldown_until + reject_reason
 *  - decideTeacherApplication invalid transition → invalid_transition
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import {
  TEACHER_COOLDOWN_MS,
  TEACHER_TRANSITIONS,
  validateTeacherTransition,
  getCooldownUntil,
  submitTeacherApplication,
  decideTeacherApplication,
} from '../../src/modules/auth/teacher-approval.js';

describe('AUTH B-14 — teacher approval state machine', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('validateTeacherTransition: B-14 §09 qoidalari', () => {
    // pending → teacher (approve) | pending → teacher_rejected (reject)
    expect(validateTeacherTransition('teacher_pending', 'teacher').ok).toBe(true);
    expect(validateTeacherTransition('teacher_pending', 'teacher_rejected').ok).toBe(true);
    // rejected → pending (cooldown o'tgan bo'lsa)
    const longAgo = Date.now() - TEACHER_COOLDOWN_MS - 1000;
    expect(validateTeacherTransition('teacher_rejected', 'teacher_pending', { decidedAt: longAgo }).ok).toBe(true);
    // teacher → teacher_rejected (revoke)
    expect(validateTeacherTransition('teacher', 'teacher_rejected').ok).toBe(true);
    // Noto'g'ri o'tishlar
    expect(validateTeacherTransition('teacher', 'teacher_pending').ok).toBe(false);
    expect(validateTeacherTransition('student', 'teacher').ok).toBe(false);
    expect(validateTeacherTransition('teacher_pending', 'student').ok).toBe(false);
    // no_op
    expect(validateTeacherTransition('teacher_pending', 'teacher_pending').error).toBe('no_op');
    expect(TEACHER_TRANSITIONS.teacher_pending).toContain('teacher');
  });

  it('validateTeacherTransition: rejected → pending faqat cooldown o\'tgach', () => {
    const decidedAt = Date.now() - 1000; // 1 soniya oldin reject
    const blocked = validateTeacherTransition('teacher_rejected', 'teacher_pending', { decidedAt });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('cooldown_active');
    expect(blocked.remainingMs).toBeGreaterThan(0);
    expect(blocked.cooldownUntil).toBe(decidedAt + TEACHER_COOLDOWN_MS);
  });

  it('getCooldownUntil: reject vaqtidan 30 kun keyin', () => {
    const t = 1700000000000;
    expect(getCooldownUntil(t)).toBe(t + TEACHER_COOLDOWN_MS);
    expect(getCooldownUntil(0)).toBe(0);
  });

  it('submitTeacherApplication: canonical record (B-14 §07) + inline + ok', async () => {
    const key = safeKey(`b14sub_${Date.now() % 1000000}`);
    const res = await submitTeacherApplication({
      userKey: key,
      username: key,
      email: `${key}@test.uz`,
      name: 'B14 Teacher',
      university: 'Toshkent Davlat Universiteti',
      subject: 'Matematika',
      experience: '5 yil',
      reason: 'Algebra va geometriyadan dars beraman',
      lang: 'uz',
    });
    expect(res.ok).toBe(true);
    expect(res.appId).toMatch(/^ta_/);

    // Canonical record — barcha §07 maydonlari
    const rec = await fb.get(`teacher_applications/${res.appId}`);
    expect(rec.exists()).toBe(true);
    const r = rec.val();
    expect(r.user_id).toBe(key);
    expect(r.full_name).toBe('B14 Teacher');
    expect(r.email).toBe(`${key}@test.uz`);
    expect(r.university).toBe('Toshkent Davlat Universiteti');
    expect(r.subject).toBe('Matematika');
    expect(r.experience).toBe('5 yil');
    expect(r.reason).toContain('Algebra');
    expect(r.status).toBe('pending');
    expect(r.reviewed_by).toBeNull();
    expect(r.reject_reason).toBeNull();
    expect(r.cooldown_until).toBeNull();
    expect(r.created_at).toBeGreaterThan(0);

    // Inline (users schema)
    const user = await fb.get(`users/${key}/teacher_application`);
    expect(user.exists()).toBe(true);
    expect(user.val().appId).toBe(res.appId);
  });

  it('submitTeacherApplication: teacher_rejected + cooldown faol → blok', async () => {
    const key = safeKey(`b14cool_${Date.now() % 1000000}`);
    const decidedAt = Date.now() - 60 * 1000; // 1 daqiqa oldin reject
    await fb.set(`users/${key}`, {
      username: key, role: 'teacher_rejected',
      teacher_decision_at: decidedAt,
    });

    const res = await submitTeacherApplication({ userKey: key, username: key, university: 'X', reason: 'Qayta ariza' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('cooldown_active');
    expect(res.remainingMs).toBeGreaterThan(0);
    // Canonical record YOZILMADI
    const apps = await fb.get('teacher_applications');
    const mine = apps.exists() ? Object.values(apps.val()).filter((a) => a.user_id === key) : [];
    expect(mine.length).toBe(0);
  });

  it('decideTeacherApplication approve: role teacher + record approved + reviewed_by', async () => {
    const key = safeKey(`b14app_${Date.now() % 1000000}`);
    const submitted = await submitTeacherApplication({ userKey: key, username: key, university: 'TATU', reason: 'Dasturlash darslari', lang: 'uz' });
    expect(submitted.ok).toBe(true);
    await fb.set(`users/${key}/role`, 'teacher_pending');

    const res = await decideTeacherApplication({
      userKey: key, decision: 'approve', by: 'admin', justification: 'Diplom va tajriba tekshirildi, yetarli',
    });
    expect(res.ok).toBe(true);
    expect(res.role).toBe('teacher');

    const u = await fb.get(`users/${key}`);
    expect(u.val().role).toBe('teacher');
    expect(u.val().teacher_decision_by).toBe('admin');
    expect(u.val().teacher_application.status).toBe('approved');
    // role_version oshdi
    expect(u.val().role_version).toBeGreaterThan(1);

    const rec = await fb.get(`teacher_applications/${submitted.appId}`);
    expect(rec.val().status).toBe('approved');
    expect(rec.val().reviewed_by).toBe('admin');
    expect(rec.val().justification).toContain('Diplom');
  });

  it('decideTeacherApplication reject: role teacher_rejected + cooldown_until + reject_reason', async () => {
    const key = safeKey(`b14rej_${Date.now() % 1000000}`);
    const submitted = await submitTeacherApplication({ userKey: key, username: key, university: 'X', reason: 'Ariza', lang: 'uz' });
    await fb.set(`users/${key}/role`, 'teacher_pending');

    const res = await decideTeacherApplication({
      userKey: key, decision: 'reject', by: 'admin', justification: 'Diplom hujjati talab qilinadi',
    });
    expect(res.ok).toBe(true);
    expect(res.role).toBe('teacher_rejected');

    const u = await fb.get(`users/${key}`);
    expect(u.val().role).toBe('teacher_rejected');
    expect(u.val().teacher_rejection_reason).toContain('Diplom');
    expect(u.val().teacher_cooldown_until).toBe(getCooldownUntil(u.val().teacher_decision_at));

    const rec = await fb.get(`teacher_applications/${submitted.appId}`);
    expect(rec.val().status).toBe('rejected');
    expect(rec.val().reject_reason).toContain('Diplom');
    expect(rec.val().cooldown_until).toBe(u.val().teacher_cooldown_until);
  });

  it('decideTeacherApplication: no\'to\'g\'ri o\'tish → invalid_transition', async () => {
    const key = safeKey(`b14bad_${Date.now() % 1000000}`);
    await fb.set(`users/${key}`, { username: key, role: 'student', role_version: 1 });

    const res = await decideTeacherApplication({ userKey: key, decision: 'approve', by: 'admin', justification: 'x'.repeat(12) });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_transition');
    expect(res.role).toBe('student');
  });
});
