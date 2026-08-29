/**
 * AUTH D-16 §09 — Teacher approval edge-case (wsl qo'shimchasi)
 * -----------------------------------------------------------------
 *  - validateTeacherTransition: cooldown boundary (now === cooldownUntil),
 *    decidedAt=0 (hech qachon rad etilmagan), no_op, invalid_transition.
 *  - buildApplicationRecord: PII slice limitlar (B-29 §06).
 *  - decideTeacherApplication: reject/approve → user + canonical record
 *    (reject_reason, cooldown_until, reviewed_by, justification).
 * Manba: B-14 §07/§09, B-16.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const testStore = {};

vi.mock('../../../firebase/admin.js', () => {
  function navigate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
      if (current === null || typeof current !== 'object' || !(parts[i] in current))
        return { found: false, parent: current, key: parts[i] };
      if (i === parts.length - 1) return { found: true, value: current[parts[i]], parent: current, key: parts[i] };
      current = current[parts[i]];
    }
    return { found: true, value: current, parent: null, key: null };
  }
  function setAt(store, path, value) {
    const parts = path.split('/').filter(Boolean);
    let cur = store;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
  }
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => setAt(testStore, path, value)),
      update: vi.fn(async (path, patch) => {
        const r = navigate(testStore, path);
        if (r.found && typeof r.value === 'object' && r.value !== null) {
          Object.assign(r.value, JSON.parse(JSON.stringify(patch)));
        } else {
          setAt(testStore, path, patch);
        }
        return {};
      }),
      remove: vi.fn(async (path) => setAt(testStore, path, null)),
    },
  };
});

vi.mock('../../../src/modules/auth/audit.js', () => ({
  AUDIT_ACTIONS: {
    TEACHER_APPROVED: 'teacher:approved',
    TEACHER_REJECTED: 'teacher:rejected',
    TEACHER_APPLICATION: 'teacher:application',
  },
  logAuthEvent: vi.fn(async () => {}),
  audit: vi.fn(async () => {}),
}));

const { fb } = await import('../../../firebase/admin.js');
const {
  validateTeacherTransition,
  getCooldownUntil,
  buildApplicationRecord,
  decideTeacherApplication,
  TEACHER_COOLDOWN_MS,
} = await import('../../../src/modules/auth/teacher-approval.js');

beforeEach(() => {
  for (const k of Object.keys(testStore)) delete testStore[k];
  vi.clearAllMocks();
});

describe('AUTH D-16 §09 — validateTeacherTransition boundary', () => {
  it('rejected→pending: now === cooldownUntil → RUXSAT (cooldown aynan tugadi)', () => {
    const decidedAt = 1_000_000_000_000;
    const cooldownUntil = decidedAt + TEACHER_COOLDOWN_MS;
    const r = validateTeacherTransition('teacher_rejected', 'teacher_pending', {
      now: cooldownUntil,
      decidedAt,
    });
    expect(r.ok).toBe(true);
  });    it('rejected→pending: now cooldown tugashidan 1ms oldin → blok (remainingMs > 0)', () => {
    const decidedAt = 1_000_000_000_000;
    const r = validateTeacherTransition('teacher_rejected', 'teacher_pending', {
      now: decidedAt + TEACHER_COOLDOWN_MS - 1,
      decidedAt,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('cooldown_active');
    expect(r.remainingMs).toBeGreaterThan(0);
    expect(r.cooldownUntil).toBe(decidedAt + TEACHER_COOLDOWN_MS);
  });

  it('decidedAt=0 (hech qachon rad etilmagan) → rejected→pending ruxsat', () => {
    // cooldownUntil = 0 + 30 kun; hozirgi vaqt ancha keyin → o'tgan
    const r = validateTeacherTransition('teacher_rejected', 'teacher_pending', {
      now: Date.now(),
      decidedAt: 0,
    });
    expect(r.ok).toBe(true);
  });

  it('no_op: bir xil role → no_op', () => {
    const r = validateTeacherTransition('teacher_pending', 'teacher_pending');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_op');
  });

  it('invalid_transition: teacher→pending ruxsat emas (revoke faqat rejected)', () => {
    const r = validateTeacherTransition('teacher', 'teacher_pending');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_transition');
    expect(r.to).toBe('teacher_pending');
  });

  it('getCooldownUntil: 0 → 0 (record yo\'q)', () => {
    expect(getCooldownUntil(0)).toBe(0);
    expect(getCooldownUntil(1_000_000_000_000)).toBe(1_000_000_000_000 + TEACHER_COOLDOWN_MS);
  });
});

describe('AUTH D-16 §09 — buildApplicationRecord PII slice (B-29 §06)', () => {
  it('university 200 / subject 100 / reason 500 / experience 1000 limitlar', () => {
    const rec = buildApplicationRecord({
      userKey: 'user_1',
      username: 'tch',
      university: 'U'.repeat(250),
      subject: 'S'.repeat(150),
      reason: 'R'.repeat(600),
      experience: 'E'.repeat(1200),
      appId: 'ta_1',
    });
    expect(rec.university).toHaveLength(200);
    expect(rec.subject).toHaveLength(100);
    expect(rec.reason).toHaveLength(500);
    expect(rec.experience).toHaveLength(1000);
  });

  it('bo\'sh username/email → bo\'sh string (PII minimal)', () => {
    const rec = buildApplicationRecord({ userKey: 'user_1' });
    expect(rec.username).toBe('');
    expect(rec.email).toBe('');
    expect(rec.status).toBe('pending');
    expect(rec.cooldown_until).toBeNull();
    expect(rec.reject_reason).toBeNull();
  });
});

describe('AUTH D-16 §09 — decideTeacherApplication (B-14 §15)', () => {
  it('reject → user: rejection_reason + cooldown_until; canonical: reject_reason + cooldown_until + reviewed_by/at', async () => {
    const key = 'tch_reject';
    await fb.set(`users/${key}`, {
      role: 'teacher_pending',
      teacher_application: { appId: 'ta_rej', appliedAt: 1_000_000_000_000 },
    });
    await fb.set(`teacher_applications/ta_rej`, { id: 'ta_rej', status: 'pending' });

    const r = await decideTeacherApplication({
      userKey: key, decision: 'reject', by: 'admin_1', justification: 'hujjatlar yetarli emas',
    });
    expect(r.ok).toBe(true);
    expect(r.role).toBe('teacher_rejected');

    const u = (await fb.get(`users/${key}`)).val();
    expect(u.role).toBe('teacher_rejected');
    expect(u.teacher_rejection_reason).toBe('hujjatlar yetarli emas');
    expect(u.teacher_cooldown_until).toBe(getCooldownUntil(u.teacher_decision_at));
    expect(u.role_version).toBe(u.teacher_decision_at);

    const app = (await fb.get(`teacher_applications/ta_rej`)).val();
    expect(app.status).toBe('rejected');
    expect(app.reject_reason).toBe('hujjatlar yetarli emas');
    expect(app.cooldown_until).toBe(getCooldownUntil(u.teacher_decision_at));
    expect(app.reviewed_by).toBe('admin_1');
    expect(app.reviewed_at).toBe(u.teacher_decision_at);
  });

  it('approve → user role teacher; canonical justification + status approved', async () => {
    const key = 'tch_appr';
    await fb.set(`users/${key}`, {
      role: 'teacher_pending',
      teacher_application: { appId: 'ta_appr', appliedAt: 1_000_000_000_000 },
    });
    await fb.set(`teacher_applications/ta_appr`, { id: 'ta_appr', status: 'pending' });

    const r = await decideTeacherApplication({
      userKey: key, decision: 'approve', by: 'admin_1', justification: 'tajriba tasdiqlandi',
    });
    expect(r.ok).toBe(true);
    expect(r.role).toBe('teacher');

    const u = (await fb.get(`users/${key}`)).val();
    expect(u.role).toBe('teacher');
    expect(u.teacher_rejection_reason).toBeUndefined();

    const app = (await fb.get(`teacher_applications/ta_appr`)).val();
    expect(app.status).toBe('approved');
    expect(app.justification).toBe('tajriba tasdiqlandi');
    expect(app.reject_reason).toBeNull();
    expect(app.cooldown_until).toBeNull();
  });

  it('not_found: user yo\'q → error', async () => {
    const r = await decideTeacherApplication({
      userKey: 'no_such_user', decision: 'approve', by: 'admin_1',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not_found');
  });
});
