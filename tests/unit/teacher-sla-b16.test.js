/**
 * AUTH B-16 — Teacher approval SLA (eslatma + eskalatsiya)
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - slaStateFor: normal | reminded | window-exceeded | escalated (24s/72s/7kun)
 *  - runTeacherSla: yangi ariza → hech narsa; 30s → reminded (+count); idempotent
 *  - runTeacherSla: 8 kun → escalated (+escalated_at); idempotent (takroriy emas)
 *  - teacher_applications sla_state yoziladi
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { slaStateFor, runTeacherSla } from '../../src/modules/auth/teacher-sla.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('AUTH B-16 — teacher SLA', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('slaStateFor: normal / reminded / window-exceeded / escalated', () => {
    expect(slaStateFor(0)).toBe('normal');
    expect(slaStateFor(10 * HOUR)).toBe('normal');
    expect(slaStateFor(24 * HOUR + 1000)).toBe('reminded');
    expect(slaStateFor(3 * DAY)).toBe('window-exceeded'); // 72s window tugadi
    expect(slaStateFor(8 * DAY)).toBe('escalated');       // 7 kun
  });

  /** Pending teacher + canonical application yaratadi. */
  async function mkPending(key, ageMs) {
    const appliedAt = Date.now() - ageMs;
    await fb.set(`users/${safeKey(key)}`, {
      username: safeKey(key), email: `${safeKey(key)}@test.uz`,
      role: 'teacher_pending', role_version: 1,
      teacher_application: { university: 'TATU', reason: 'Dars', appliedAt, status: 'pending' },
    });
    await fb.set(`teacher_applications/ta_${safeKey(key)}`, {
      id: `ta_${safeKey(key)}`, user_id: safeKey(key), username: safeKey(key),
      email: `${safeKey(key)}@test.uz`, full_name: safeKey(key), university: 'TATU',
      subject: 'Matematika', experience: '', reason: 'Dars', status: 'pending',
      created_at: appliedAt, lang: 'uz', sla_state: 'normal',
    });
  }

  it('runTeacherSla: yangi ariza → hech narsa (reminded=0, escalated=0)', async () => {
    await mkPending('b16new', 2 * HOUR);
    const r = await runTeacherSla();
    expect(r.reminded).toBe(0);
    expect(r.escalated).toBe(0);
    // sla_state o'zgarmadi
    const app = await fb.get('teacher_applications/ta_b16new');
    expect(app.val().sla_state).toBe('normal');
  });

  it('runTeacherSla: 30s ariza → reminded (count=1) + idempotent', async () => {
    await mkPending('b16rem', 30 * HOUR);
    const r1 = await runTeacherSla();
    expect(r1.reminded).toBe(1);

    const app = await fb.get('teacher_applications/ta_b16rem');
    expect(app.val().sla_state).toBe('reminded');
    expect(app.val().reminder_count).toBe(1);
    expect(app.val().last_reminded_at).toBeGreaterThan(0);

    // Darhol qayta yugurish → takroriy email YO'Q (idempotent, B-16 §30)
    const r2 = await runTeacherSla();
    expect(r2.reminded).toBe(0);
    const app2 = await fb.get('teacher_applications/ta_b16rem');
    expect(app2.val().reminder_count).toBe(1);
  });

  it('runTeacherSla: 8 kun → escalated (+escalated_at) + idempotent', async () => {
    await mkPending('b16esc', 8 * DAY);
    const r1 = await runTeacherSla();
    expect(r1.escalated).toBe(1);

    const app = await fb.get('teacher_applications/ta_b16esc');
    expect(app.val().sla_state).toBe('escalated');
    expect(app.val().escalated_at).toBeGreaterThan(0);

    // Idempotent — takroriy eskalatsiya YO'Q
    const r2 = await runTeacherSla();
    expect(r2.escalated).toBe(0);
  });

  it('runTeacherSla: 72s window → reminded (3-reminder bosqichida)', async () => {
    await mkPending('b16win', 4 * DAY);
    const r1 = await runTeacherSla();
    // 4 kun = 96s > 72s window — eslatma to'g'ri keladi (agar count < 3)
    expect(r1.reminded).toBe(1);
    const app = await fb.get('teacher_applications/ta_b16win');
    expect(app.val().reminder_count).toBe(1);
    expect(app.val().sla_state).toBe('reminded');
  });
});
