/**
 * AUTH B-29 — Teacher approval detail.
 *  1. parseRegister: teacher maydonlari (university/subject/experience/reason)
 *  2. Form validatsiya: university 200, subject 100, experience 0-50, reason 500
 *  3. submitTeacherApplication: duplicate (pending/approved) → duplicate_application
 *  4. validateTeacherTransition: rejected→pending faqat cooldown o'tgach
 *  5. buildApplicationRecord: PII minimal + slice limitlar
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { registerSchema, parseRegister } from '../../src/modules/auth/validation.js';
import {
  submitTeacherApplication,
  buildApplicationRecord,
  validateTeacherTransition,
  TEACHER_TRANSITIONS,
} from '../../src/modules/auth/teacher-approval.js';

beforeAll(async () => {
  await snapshotDb();
});

afterAll(async () => {
  await restoreDb();
});

describe('B-29 — teacher application form validatsiya', () => {
  it('B-33 RELEASE fix: brauzer payload (barcha forma maydonlari bo\'sh string) — student register OK', () => {
    // Brauzer HAR DOIM barcha input'larni yuboradi: university='', subject='',
    // experience='', reason='', website='', invite='' — bu B-29'dan beri student
    // register'ini buzgan edi (optional() bo'sh stringni o'tkazmasdi → 'required').
    const r = parseRegister({
      mode: 'reg', consent: 'on', lang: 'uz', website: '', university: '', subject: '',
      experience: '', reason: '', name: 'Student User', email: 's@test.uz',
      username: 'suser123', password: 'Str0ng!Pass2026!x', invite: '',
      consent: true, // AUTH D-24 §10: qonuniy rozilik
    });
    expect(r.ok).toBe(true);
    expect(r.email).toBe('s@test.uz');
    // Teacher maydonlari bo'sh qoladi — keyingi qadamda wantsTeacher route check
    expect(r.university).toBe('');
  });

  it('registerSchema: teacher maydonlari yaroqli qiymatlarni qabul qiladi', () => {
    const r = registerSchema.safeParse({
      username: 'b29teacher',
      password: 'Str0ng!Pass2026Secure1',
      email: 'b29t@test.uz',
      university: 'Toshkent Davlat Universiteti',
      subject: 'Matematika',
      experience: '10',
      reason: "O'qituvchiman",
    });
    expect(r.success).toBe(true);
    expect(r.data.university).toBe('Toshkent Davlat Universiteti');
    expect(r.data.experience).toBe('10');
  });

  const base = {
    username: 'b29x',
    password: 'Str0ng!Pass2026Secure1',
    email: 'b29x@test.uz',
  };

  it('experience: 0-50 oralig\'i; 51 yoki harf rad', () => {
    expect(registerSchema.safeParse({ ...base, experience: '50' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, experience: '0' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, experience: '51' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, experience: 'abc' }).success).toBe(false);
    // Bo'sh experience optional — ruxsat
    expect(registerSchema.safeParse({ ...base, experience: '' }).success).toBe(true);
  });

  it('university/subject/reason limitlar', () => {
    expect(registerSchema.safeParse({ ...base, university: 'x'.repeat(201) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, university: 'x'.repeat(200) }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, subject: 'x'.repeat(101) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, reason: 'x'.repeat(501) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, reason: 'x'.repeat(500) }).success).toBe(true);
  });

  it('parseRegister: teacher maydonlarini qaytaradi', () => {
    const r = parseRegister({
      username: 'b29parse',
      password: 'Str0ng!Pass2026Secure1',
      email: 'b29p@test.uz',
      university: 'Toshkent Davlat Universiteti',
      subject: 'Fizika',
      experience: '5',
      reason: 'Ilmiy darajam bor',
      consent: true, // AUTH D-24 §10: qonuniy rozilik
    });
    expect(r.ok).toBe(true);
    expect(r.university).toBe('Toshkent Davlat Universiteti');
    expect(r.subject).toBe('Fizika');
    expect(r.experience).toBe('5');
    expect(r.reason).toBe('Ilmiy darajam bor');
  });

  it('buildApplicationRecord: PII minimal + slice limitlar', () => {
    const app = buildApplicationRecord({
      userKey: 'b29build',
      username: 'b29build',
      email: 'b29b@test.uz',
      name: 'B29 Teacher',
      university: 'U'.repeat(300),
      subject: 'S'.repeat(150),
      experience: '20',
      reason: 'R'.repeat(600),
      appId: 'ta_b29build_1',
    });
    expect(app.university.length).toBe(200);
    expect(app.subject.length).toBe(100);
    expect(app.reason.length).toBe(500);
    expect(app.status).toBe('pending');
    expect(app.cooldown_until).toBeNull();
  });
});

describe('B-29 — duplicate + cooldown', () => {
  it('submitTeacherApplication: teacher_pending → duplicate_application blok', async () => {
    const key = 'b29duppending';
    await fb.set(`users/${key}`, {
      username: 'b29duppending',
      email: 'b29dup@test.uz',
      role: 'teacher_pending',
      created_at: Date.now(),
    });
    // B-29: duplicate check canonical teacher_applications'ga qaraydi — TIRIK
    // (pending/approved) ariza yozamiz
    await fb.set(`teacher_applications/ta_b29duppending_1`, {
      id: 'ta_b29duppending_1',
      user_id: key,
      username: 'b29duppending',
      email: 'b29dup@test.uz',
      university: 'TDU',
      subject: 'Matematika',
      status: 'pending',
      created_at: Date.now(),
    });
    const r = await submitTeacherApplication({
      userKey: key, username: 'b29duppending', email: 'b29dup@test.uz',
      university: 'TDU', subject: 'Matematika', experience: '3', reason: '',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('duplicate_application');
  });

  it('submitTeacherApplication: teacher (approved) → duplicate_application blok', async () => {
    const key = 'b29dupapproved';
    await fb.set(`users/${key}`, {
      username: 'b29dupapproved',
      email: 'b29dap@test.uz',
      role: 'teacher',
      created_at: Date.now(),
    });
    await fb.set(`teacher_applications/ta_b29dupapproved_1`, {
      id: 'ta_b29dupapproved_1',
      user_id: key,
      username: 'b29dupapproved',
      email: 'b29dap@test.uz',
      university: 'TATU',
      subject: 'Informatika',
      status: 'approved',
      created_at: Date.now(),
    });
    const r = await submitTeacherApplication({
      userKey: key, username: 'b29dupapproved', email: 'b29dap@test.uz',
      university: 'TATU', subject: 'Informatika', experience: '8', reason: '',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('duplicate_application');
  });

  it('submitTeacherApplication: yangi user → ok (ariza yaratiladi)', async () => {
    const key = `b29new${Date.now()}`;
    const r = await submitTeacherApplication({
      userKey: key, username: key, email: `${key}@test.uz`, name: 'New Teacher',
      university: 'SamDU', subject: 'Kimyo', experience: '2', reason: 'Tajribam bor',
    });
    expect(r.ok).toBe(true);
    expect(r.app.status).toBe('pending');
    expect(r.app.university).toBe('SamDU');
  });

  it('validateTeacherTransition: rejected→pending faqat cooldown o\'tgach', () => {
    const now = Date.now();
    // Cooldown 30 kun — hali o'tmagan
    const blocked = validateTeacherTransition('teacher_rejected', 'teacher_pending', {
      now, decidedAt: now - 10 * 24 * 60 * 60 * 1000, // 10 kun
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.remainingMs).toBeGreaterThan(0);
    // 31 kun o'tgan
    const ok = validateTeacherTransition('teacher_rejected', 'teacher_pending', {
      now, decidedAt: now - 31 * 24 * 60 * 60 * 1000,
    });
    expect(ok.ok).toBe(true);
  });

  it('TEACHER_TRANSITIONS: pending→approved, pending→rejected ruxsat; approved→pending yo\'q', () => {
    expect(TEACHER_TRANSITIONS.teacher_pending).toContain('teacher');
    expect(TEACHER_TRANSITIONS.teacher_pending).toContain('teacher_rejected');
    expect(TEACHER_TRANSITIONS.teacher || []).not.toContain('teacher_pending');
  });
});
