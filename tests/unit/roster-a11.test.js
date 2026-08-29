/**
 * AUTH A-11 — Roster import: mapping + commit + rollback + invite
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - Commit HAQIQATAN users/enrollments/groups yozadi (A-10'da `item.entity`
 *    bug'i tufayli hech narsa yozilmasdi — A-11 §10 fix)
 *  - Data-level idempotency: bir xil fayl qayta commit → duplicate yo'q
 *  - buildRowStatusReport (§11) + reconcileSession (§29)
 *  - Invite life-cycle (§13-15): yaratish → accept (guruh prefilled) →
 *    1-marta (replay reject) → revoke → expiry → pending summary
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  createStagingSession,
  addParsedRows,
  saveColumnMapping,
  commitStagingSession,
  deleteStagingSession,
  buildRowStatusReport,
  reconcileSession,
  rollbackStagingSession,
} from '../../src/modules/roster/index.js';
import {
  createInvitesForSession,
  acceptInvite,
  revokeInvite,
  listInvites,
  getPendingInviteSummary,
} from '../../src/modules/roster/index.js';

const MAPPING = {
  student_id: { field: 'userId', entity: 'user', required: true },
  name: { field: 'displayName', entity: 'user', required: false },
  course_code: { field: 'courseCode', entity: 'course', required: true },
  term: { field: 'termCode', entity: 'term', required: true },
  group: { field: 'groupName', entity: 'group', required: false },
};

const ROWS = [
  { rowIndex: 2, data: { student_id: 'STU001', name: 'Aliyev Ali', course_code: 'MATH101', term: '2026', group: 'A' } },
  { rowIndex: 3, data: { student_id: 'STU002', name: 'Valiyev Vali', course_code: 'MATH101', term: '2026', group: 'A' } },
];

/** Sessiya yaratish + mapping + rows (commit'ga tayyor holat). */
async function readySession(tag = '') {
  const sid = await createStagingSession({
    filename: `a11-${tag}-${Date.now()}.xlsx`, extension: '.xlsx', fileSize: 100,
    uploadedBy: 'admin', totalRows: ROWS.length, totalSheets: 1, warnings: [],
  });
  await saveColumnMapping(sid, MAPPING);
  await addParsedRows(sid, 'Sheet1', ROWS);
  return sid;
}

async function cleanup(...ids) {
  for (const sid of ids) {
    const snap = await fb.get(`roster_staging/${sid}`);
    if (snap.exists()) await deleteStagingSession(sid);
  }
}

describe('A-11 — commit HAQIQATAN yozadi (A-10 bug fix)', () => {
  let sid;

  afterEach(async () => {
    if (sid) await cleanup(sid);
    await fb.remove('users/stu001');
    await fb.remove('users/stu002');
    await fb.remove('enrollments/stu001_MATH101');
    await fb.remove('enrollments/stu002_MATH101');
    await fb.remove('groups/a');
  });

  // CI'da oldingi test fayllar DB'ga iz qoldirishi mumkin — commit'ni
  // deterministik qilish uchun har testdan oldin ham tozalaymiz.
  beforeEach(async () => {
    await fb.remove('users/stu001');
    await fb.remove('users/stu002');
    await fb.remove('enrollments/stu001_MATH101');
    await fb.remove('enrollments/stu002_MATH101');
    await fb.remove('groups/a');
  });

  it('create → user (parol yo\'q, guruh prefilled) + enrollment + guruh', async () => {
    sid = await readySession('commit');
    const result = await commitStagingSession(sid, 'admin', { hash: 'h1' });
    expect(result.ok).toBe(true);
    expect(result.stats.created).toBeGreaterThanOrEqual(4); // 2 user + 2 enroll

    const user = await fb.get('users/stu001');
    expect(user.exists()).toBe(true);
    expect(user.val().username).toBe('stu001');
    expect(user.val().password).toBe('');            // parol invite'da beriladi
    expect(user.val().group).toBe('A');              // guruh prefilled
    expect(user.val().source).toBe('roster');

    const enroll = await fb.get('enrollments/stu001_MATH101');
    expect(enroll.exists()).toBe(true);
    expect(enroll.val().courseCode).toBe('MATH101');
    expect(enroll.val().groupCode).toBe('A');

    const group = await fb.get('groups/a');
    expect(group.exists()).toBe(true);
    expect(group.val().name).toBe('A');
  });

  it('data-level idempotency: bir xil fayl qayta commit → duplicate yo\'q', async () => {
    const sid1 = await readySession('idem1');
    const r1 = await commitStagingSession(sid1, 'admin', { hash: 'h1' });
    expect(r1.ok).toBe(true);

    // Xuddi shu qatorlar bilan YANGI sessiya (qayta yuklash simulyatsiyasi)
    const sid2 = await readySession('idem2');
    const r2 = await commitStagingSession(sid2, 'admin', { hash: 'h1' });
    expect(r2.ok).toBe(true);

    // Diff existing user+enrollment topadi → YANGI hech narsa yaratilmaydi
    expect(r2.stats.created).toBe(0);
    expect(r2.stats.createdUsers).toBe(0);
    // User hali bitta — duplicate YO'Q
    const usersSnap = await fb.get('users/stu001');
    expect(usersSnap.exists()).toBe(true);

    await cleanup(sid1, sid2);
  });

  it('double commit (bir xil sessiya) → reject', async () => {
    sid = await readySession('double');
    const r1 = await commitStagingSession(sid, 'admin', { hash: 'h1' });
    expect(r1.ok).toBe(true);
    const r2 = await commitStagingSession(sid, 'admin', { hash: 'h1' });
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/cannot be committed/i);
  });

  it('commit -> rollback -> state tiklanadi', async () => {
    sid = await readySession('roll');
    await commitStagingSession(sid, 'admin', { hash: 'h1' });
    expect((await fb.get('users/stu001')).exists()).toBe(true);

    const rb = await rollbackStagingSession(sid);
    expect(rb.ok).toBe(true);
    expect((await fb.get('users/stu001')).exists()).toBe(false);
  });
});

describe('A-11 — row status + reconciliation', () => {
  let sid;

  afterEach(async () => {
    if (sid) await cleanup(sid);
    await fb.remove('users/stu001');
    await fb.remove('users/stu002');
    await fb.remove('enrollments/stu001_MATH101');
    await fb.remove('enrollments/stu002_MATH101');
    await fb.remove('groups/a');
  });

  it('buildRowStatusReport — hamma qator ok (xatolar bo\'lmasa)', async () => {
    sid = await readySession('status');
    await commitStagingSession(sid, 'admin', { hash: 'h1' });
    const report = await buildRowStatusReport(sid);
    expect(report.error).toBeUndefined();
    expect(report.rows.length).toBe(2);
    expect(report.rows.every(r => r.status === 'ok')).toBe(true);
    expect(report.summary).toMatchObject({ total: 2, ok: 2, error: 0 });
  });

  it('reconcileSession — expected vs actual counts', async () => {
    sid = await readySession('recon');
    const r = await commitStagingSession(sid, 'admin', { hash: 'h1' });
    expect(r.ok).toBe(true);

    const rec = await reconcileSession(sid);
    expect(rec.error).toBeUndefined();
    expect(rec.status).toBe('committed');
    expect(rec.matched).toBe(true);
    expect(rec.actual.users).toBeGreaterThanOrEqual(2);
  });
});

describe('A-11 — invite life-cycle (§13-15)', () => {
  let sid;
  let createdTokens = [];

  afterEach(async () => {
    if (sid) await cleanup(sid);
    await fb.remove('users/stu001');
    await fb.remove('users/stu002');
    await fb.remove('users/ali_a11');
    await fb.remove('enrollments/stu001_MATH101');
    await fb.remove('enrollments/stu002_MATH101');
    await fb.remove('enrollments/ali_a11_MATH101');
    await fb.remove('groups/a');
    // Barcha invite'larni tozalaymiz
    const invSnap = await fb.get('invites');
    if (invSnap.exists()) {
      for (const [h] of Object.entries(invSnap.val())) await fb.remove(`invites/${h}`);
    }
    createdTokens = [];
  });

  it('commit -> invite yaratish -> accept (guruh prefilled) -> replay reject', async () => {
    sid = await readySession('inv1');
    await commitStagingSession(sid, 'admin', { hash: 'h1' });

    const inv = await createInvitesForSession(sid, { channel: 'email' });
    expect(inv.ok).toBe(true);
    expect(inv.created).toBe(2); // 2 talaba
    expect(inv.invites[0].token).toBeTruthy(); // dev/test token qaytadi
    const token = inv.invites[0].token;
    createdTokens.push(inv.invites[0].id);

    // Accept — guruh prefilled + enroll
    const ac = await acceptInvite({ token, username: 'ali_a11', password: 'parol-2026-x-uzun', consent: true });
    expect(ac.ok).toBe(true);
    expect(ac.user).toBe('ali_a11');
    expect(ac.group).toBe('A');

    const user = await fb.get('users/ali_a11');
    expect(user.exists()).toBe(true);
    expect(user.val().group).toBe('A');
    expect(user.val().source).toBe('roster_invite');
    expect(user.val().password.startsWith('$argon2')).toBe(true);
    expect((await fb.get('enrollments/ali_a11_MATH101')).exists()).toBe(true);

    // Invite endi used
    const list = await listInvites(sid);
    expect(list.counts.used).toBe(1);
    expect(list.counts.pending).toBe(1);

    // Replay → reject (1 marta)
    const replay = await acceptInvite({ token, username: 'ali_a11_2', password: 'parol-2026-x-uzun' });
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatch(/allaqachon ishlatilgan/);
  });

  it('revoke -> accept reject', async () => {
    sid = await readySession('inv2');
    await commitStagingSession(sid, 'admin', { hash: 'h2' });

    const inv = await createInvitesForSession(sid);
    const token = inv.invites[0].token;
    createdTokens.push(inv.invites[0].id);

    const rv = await revokeInvite(inv.invites[0].id);
    expect(rv.ok).toBe(true);

    const ac = await acceptInvite({ token, username: 'ali_a11', password: 'parol-2026-x-uzun', consent: true });
    expect(ac.ok).toBe(false);
    expect(ac.error).toMatch(/bekor qilingan/);
  });

  it('expired invite -> reject + status expired', async () => {
    sid = await readySession('inv3');
    await commitStagingSession(sid, 'admin', { hash: 'h3' });

    const inv = await createInvitesForSession(sid);
    const token = inv.invites[0].id ? inv.invites[0].token : null;
    // Muddatni o'tkazamiz
    await fb.set(`invites/${inv.invites[0].id}/expiresAt`, Date.now() - 1000);

    const ac = await acceptInvite({ token, username: 'ali_a11', password: 'parol-2026-x-uzun', consent: true });
    expect(ac.ok).toBe(false);
    expect(ac.error).toMatch(/muddati o'tgan|o\'tgan/);

    const snap = await fb.get(`invites/${inv.invites[0].id}`);
    expect(snap.val().status).toBe('expired');
  });

  it('getPendingInviteSummary — pending count', async () => {
    sid = await readySession('inv4');
    await commitStagingSession(sid, 'admin', { hash: 'h4' });
    await createInvitesForSession(sid);

    const summary = await getPendingInviteSummary();
    expect(summary.totalPending).toBeGreaterThanOrEqual(2);
    expect(summary.bySession[0].sessionId).toBe(sid);
    expect(summary.bySession[0].pending).toBeGreaterThanOrEqual(2);
  });
});
