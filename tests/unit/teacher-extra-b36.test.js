import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import {
  createRoleInvite, createBulkTeacherInvites, parseBulkTeacherFile,
  BULK_MAX_PER_BATCH, EMAIL_RE,
} from '../../src/modules/roster/bulk-invite.js';
import {
  addCoTeacher, removeCoTeacher, listCoTeachers, isCourseTeacher,
  bindCoTeacher, normalizeCourseCode, CO_TEACHER_MAX_PER_COURSE,
} from '../../src/modules/teacher/co-teacher.js';
import { getCooldownUntil, TEACHER_COOLDOWN_MS } from '../../src/modules/auth/teacher-approval.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('B-36 — bulk teacher invite', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('EMAIL_RE: valid/invalid', () => {
    expect(EMAIL_RE.test('a@test.uz')).toBe(true);
    expect(EMAIL_RE.test('a.b+c@sub.test.co')).toBe(true);
    expect(EMAIL_RE.test('not-an-email')).toBe(false);
    expect(EMAIL_RE.test('=HYPERLINK("http://evil")@x')).toBe(false); // formula injection
    expect(EMAIL_RE.test('a@')).toBe(false);
  });

  it('createRoleInvite: teacher — single-use token hash, 7 kun expiry', async () => {
    const r = await createRoleInvite({ email: 't1@test.uz', name: 'Ali Valiyev', role: 'teacher' });
    expect(r.ok).toBe(true);
    expect(r.invite.status).toBe('pending');
    expect(r.invite.role).toBe('teacher');
    expect(r.invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // 7 kun expiry (B-11 kontrakti)
    expect(r.invite.expiresAt - r.invite.createdAt).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('createRoleInvite: duplicate email → duplicate_invite (skip), already registered → skip', async () => {
    const a = await createRoleInvite({ email: 'dup@test.uz', role: 'teacher' });
    expect(a.ok).toBe(true);
    const b = await createRoleInvite({ email: 'dup@test.uz', role: 'teacher' });
    expect(b.ok).toBe(false);
    expect(b.error).toBe('duplicate_invite');

    // User ro'yxatdan o'tgan — invite yaratilmaydi
    await fb.set('users/reg', { username: 'reg', email: 'reg@test.uz' });
    await fb.set(`users_email_index/${safeKey('reg@test.uz')}`, 'reg');
    const c = await createRoleInvite({ email: 'reg@test.uz', role: 'teacher' });
    expect(c.ok).toBe(false);
    expect(c.error).toBe('already_registered');
  });

  it('createBulkTeacherInvites: qisman muvaffaqiyat — valid created, invalid error list, limit 100', async () => {
    const rows = [
      { email: 'b1@test.uz', name: 'B1' },
      { email: 'not-valid', name: 'B2' },          // invalid → errors
      { email: 'dup@test.uz', name: 'Dup' },        // duplicate → skipped
      { email: 'reg@test.uz', name: 'Reg' },        // registered → skipped
    ];
    const r = await createBulkTeacherInvites({ rows, by: 'admin-x' });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(2);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].error).toBe('invalid_email');
    expect(BULK_MAX_PER_BATCH).toBe(100);
  });

  it('parseBulkTeacherFile: CSV — valid rows + invalid list (encoding/columns)', async () => {
    const csvPath = join(tmpdir(), `b36-${Date.now()}.csv`);
    writeFileSync(csvPath, 'email,ism\na@test.uz,Anna\nb@test.uz,Behruz\nbad-email,X\n', 'utf8');
    try {
      const { rows, invalid } = await parseBulkTeacherFile(csvPath);
      expect(rows.length).toBe(2);
      expect(rows[0].email).toBe('a@test.uz');
      expect(rows[1].name).toBe('Behruz');
      expect(invalid.length).toBe(1);
      expect(invalid[0].reason).toBe('invalid_email');
    } finally {
      unlinkSync(csvPath);
    }
  });

  it('parseBulkTeacherFile: formula injection (Excel) email rad etiladi', async () => {
    const csvPath = join(tmpdir(), `b36-inj-${Date.now()}.csv`);
    writeFileSync(csvPath, 'email,ism\n=HYPERLINK("http://evil.example"),X\nnormal@test.uz,N\n', 'utf8');
    try {
      const { rows, invalid } = await parseBulkTeacherFile(csvPath);
      // Formula email valid emas — invalid list; normal qator o'tadi
      expect(rows.length).toBe(1);
      expect(invalid.length).toBe(1);
    } finally {
      unlinkSync(csvPath);
    }
  });
});

describe('B-36 — co-teacher (scope, limit, owner)', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('normalizeCourseCode: slug-ish, max 32', () => {
    expect(normalizeCourseCode('  Matematika 101! ')).toBe('matematika-101');
    expect(normalizeCourseCode('A'.repeat(50)).length).toBeLessThanOrEqual(32);
  });

  it('addCoTeacher: owner qo\'shadi; limit 3; 4-chi → co_teacher_limit', async () => {
    await fb.set('users/own1', { username: 'own1', role: 'teacher' });
    for (let i = 1; i <= CO_TEACHER_MAX_PER_COURSE; i += 1) {
      const r = await addCoTeacher({ ownerKey: 'own1', courseCode: 'math-101', email: `co${i}@test.uz` });
      expect(r.ok).toBe(true);
      expect(r.invite.role).toBe('co_teacher');
      expect(r.invite.scope.courseCode).toBe('math-101');
      expect(r.invite.scope.owner).toBe('own1');
    }
    const fourth = await addCoTeacher({ ownerKey: 'own1', courseCode: 'math-101', email: 'co4@test.uz' });
    expect(fourth.ok).toBe(false);
    expect(fourth.error).toBe('co_teacher_limit');
  });

  it('kurs boshqa teacher\'ga tegishli — course_owned (tenant scope)', async () => {
    await fb.set('users/own2', { username: 'own2', role: 'teacher' });
    await fb.set('users/other1', { username: 'other1', role: 'teacher' });
    await addCoTeacher({ ownerKey: 'own2', courseCode: 'fiz-101', email: 'f1@test.uz' });
    const steal = await addCoTeacher({ ownerKey: 'other1', courseCode: 'fiz-101', email: 'f2@test.uz' });
    expect(steal.ok).toBe(false);
    expect(steal.error).toBe('course_owned');
  });

  it('removeCoTeacher: faqat owner; boshqa user → forbidden', async () => {
    const r = await removeCoTeacher({ ownerKey: 'own2', courseCode: 'fiz-101', coTeacherKey: 'f2@test.uz' });
    // f2 invite yaratilmagan (course_owned) — not_found
    expect(['not_found', 'forbidden']).toContain(r.error || 'ok');
    // Owner bo'lmagan teacher remove qilolmaydi
    const nonOwner = await removeCoTeacher({ ownerKey: 'other1', courseCode: 'fiz-101', coTeacherKey: 'x' });
    expect(nonOwner.error).toBe('forbidden');
  });

  it('bindCoTeacher: co_teacher kursga yoziladi; isCourseTeacher scope — boshqa kurs YO\'Q', async () => {
    await fb.set('users/own3', { username: 'own3', role: 'teacher' });
    await fb.set('users/co-a', { username: 'co-a', role: 'co_teacher' });
    await fb.set(`co_teacher_records/math-2`, { owner: 'own3', createdAt: Date.now(), coTeachers: {} });

    const bound = await bindCoTeacher({ userKey: 'co-a', courseCode: 'math-2', owner: 'own3' });
    expect(bound.ok).toBe(true);

    expect(await isCourseTeacher('co-a', 'math-2')).toBe(true);
    expect(await isCourseTeacher('co-a', 'boshqa-kurs')).toBe(false); // §10: faqat o'z kursi
    expect(await isCourseTeacher('own3', 'math-2')).toBe(true);
    expect(await isCourseTeacher('random', 'math-2')).toBe(false);

    const list = await listCoTeachers('math-2');
    expect(list.ok).toBe(true);
    expect(list.owner).toBe('own3');
    expect(list.coTeachers.length).toBe(1);
    expect(list.coTeachers[0].userKey).toBe('co-a');
  });

  it('bindCoTeacher: limit accept\'da ham qayta tekshiriladi (defense)', async () => {
    await fb.set('users/own4', { username: 'own4', role: 'teacher' });
    await fb.set('users/co-b', { username: 'co-b', role: 'co_teacher' });
    await fb.set(`co_teacher_records/full-1`, { owner: 'own4', createdAt: Date.now(), coTeachers: {
      c1: { addedAt: Date.now() }, c2: { addedAt: Date.now() }, c3: { addedAt: Date.now() },
    } });
    const r = await bindCoTeacher({ userKey: 'co-b', courseCode: 'full-1', owner: 'own4' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('co_teacher_limit');
  });
});

describe('B-36 — appeal cooldown', () => {
  it('getCooldownUntil: decidedAt + cooldown; TEACHER_COOLDOWN_MS 30 kun', () => {
    const decidedAt = Date.now() - 10 * 86400000;
    expect(getCooldownUntil(decidedAt) - decidedAt).toBe(TEACHER_COOLDOWN_MS);
    expect(TEACHER_COOLDOWN_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
