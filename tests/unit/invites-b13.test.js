/**
 * AUTH B-13 — Invite accept (Google + parol) + enrollment
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - claimInviteForGoogle: yaroqli → USED + usedBy + usedProvider + enrollment
 *  - claimInviteForGoogle: replay (2-claim) → reject
 *  - claimInviteForGoogle: expired → reject; revoked → reject; bad format → reject
 *  - acceptInvite (password) writeInviteBinding refactor'dan keyin ham to'g'ri
 *    ishlaydi (enrollment + USED + usedBy)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  createInvitesForSession,
  acceptInvite,
  claimInviteForGoogle,
  getInviteByHash,
  INVITE_STATUS,
} from '../../src/modules/roster/invites.js';
import {
  createStagingSession,
  addParsedRows,
  saveColumnMapping,
  deleteStagingSession,
} from '../../src/modules/roster/index.js';

const MAPPING = {
  student_id: { field: 'userId', entity: 'user', required: true },
  email_col: { field: 'email', entity: 'user', required: false },
};

// B-13 xos identity — b11/b12 testlari bilan konflikt bo'lmasligi uchun unique.
const ROWS = [
  { rowIndex: 2, data: { student_id: 'B13X001', email_col: 'b13x001@test.uz', fan: 'Fizika', guruh: '2-guruh' } },
  { rowIndex: 3, data: { student_id: 'B13X002', email_col: 'b13x002@test.uz', fan: 'Matematika', guruh: '1-guruh' } },
  { rowIndex: 4, data: { student_id: 'B13X003', email_col: 'b13x003@test.uz', fan: 'Informatika', guruh: '3-guruh' } },
];

async function readyCommittedSession(tag = '') {
  const sid = await createStagingSession({
    filename: `b13-${tag}-${Date.now()}.xlsx`, extension: '.xlsx', fileSize: 100,
    uploadedBy: 'admin', totalRows: ROWS.length, totalSheets: 1, warnings: [],
  });
  await saveColumnMapping(sid, MAPPING);
  await addParsedRows(sid, 'Sheet1', ROWS);
  const { commitStagingSession } = await import('../../src/modules/roster/index.js');
  const res = await commitStagingSession(sid, 'admin');
  if (!res.ok) throw new Error(`commit failed: ${res.error}`);
  return sid;
}

/** Sessiya uchun bitta invite'ni qaytaradi (yoki hammasini). */
async function sessionInvites(sid) {
  const snap = await fb.get('invites');
  if (!snap.exists()) return [];
  return Object.values(snap.val()).filter((i) => i.sessionId === sid);
}

async function cleanup(...ids) {
  for (const sid of ids) {
    const snap = await fb.get(`roster_staging/${sid}`);
    if (snap.exists()) await deleteStagingSession(sid);
  }
  const invSnap = await fb.get('invites');
  if (invSnap.exists()) {
    for (const [hash, inv] of Object.entries(invSnap.val())) {
      if (String(inv.sessionId || '').startsWith('b13-') || (inv.identity || '').startsWith('B13X')) {
        await fb.remove(`invites/${hash}`);
      }
    }
  }
}

describe('AUTH B-13 — claimInviteForGoogle (Google accept)', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('Yaroqli claim → USED + usedBy + usedProvider google + enrollment', async () => {
    const sid = await readyCommittedSession('ok');
    try {
      await createInvitesForSession(sid);
      const inv = (await sessionInvites(sid)).find((i) => i.identity === 'B13X001');
      expect(inv).toBeTruthy();
      const userKey = 'google:gsub-b13-ok-1';

      const res = await claimInviteForGoogle({ tokenHash: inv.tokenHash, userKey });
      expect(res.ok).toBe(true);
      expect(res.invite.courseCode).toBe('Fizika');
      expect(res.invite.groupCode).toBe('2-guruh');

      const after = await fb.get(`invites/${inv.tokenHash}`);
      expect(after.val().status).toBe(INVITE_STATUS.USED);
      expect(after.val().usedBy).toBe(userKey);
      expect(after.val().usedProvider).toBe('google');

      // Enrollment yozildi (course/group prefilled)
      const enroll = await fb.get(`enrollments/${userKey}_Fizika`);
      expect(enroll.exists()).toBe(true);
      expect(enroll.val().groupCode).toBe('2-guruh');
      expect(enroll.val().status).toBe('active');

      // Endi link reject (ishlatilgan)
      const link = await getInviteByHash(inv.tokenHash);
      expect(link.ok).toBe(false);
    } finally {
      await cleanup(sid);
    }
  });

  it('Replay — bitta invite ikki marta claim bo\'lmaydi', async () => {
    const sid = await readyCommittedSession('rep');
    try {
      await createInvitesForSession(sid);
      const inv = (await sessionInvites(sid)).find((i) => i.identity === 'B13X002');

      const r1 = await claimInviteForGoogle({ tokenHash: inv.tokenHash, userKey: 'google:gsub-b13-rep-1' });
      expect(r1.ok).toBe(true);

      const r2 = await claimInviteForGoogle({ tokenHash: inv.tokenHash, userKey: 'google:gsub-b13-rep-2' });
      expect(r2.ok).toBe(false);
      expect(r2.error).toContain('ishlatilgan');

      // Ikkinchi user enrollment'ga ega emas
      const enroll2 = await fb.get(`enrollments/google:gsub-b13-rep-2_Matematika`);
      expect(enroll2.exists()).toBe(false);
    } finally {
      await cleanup(sid);
    }
  });

  it('Expired → reject (status EXPIRED yoziladi)', async () => {
    const sid = await readyCommittedSession('exp');
    try {
      await createInvitesForSession(sid);
      const inv = (await sessionInvites(sid)).find((i) => i.identity === 'B13X003');
      await fb.set(`invites/${inv.tokenHash}/expiresAt`, Date.now() - 1000);

      const res = await claimInviteForGoogle({ tokenHash: inv.tokenHash, userKey: 'google:gsub-b13-exp' });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('muddati');

      const after = await fb.get(`invites/${inv.tokenHash}`);
      expect(after.val().status).toBe(INVITE_STATUS.EXPIRED);
    } finally {
      await cleanup(sid);
    }
  });

  it('Revoked → reject; bad format → reject', async () => {
    const sid = await readyCommittedSession('rev');
    try {
      await createInvitesForSession(sid);
      const inv = (await sessionInvites(sid)).find((i) => i.identity === 'B13X003');
      await fb.set(`invites/${inv.tokenHash}/status`, INVITE_STATUS.REVOKED);

      const rev = await claimInviteForGoogle({ tokenHash: inv.tokenHash, userKey: 'google:gsub-b13-rev' });
      expect(rev.ok).toBe(false);
      expect(rev.error).toContain('bekor qilingan');

      // Bad format — 64-hex emas
      const bad = await claimInviteForGoogle({ tokenHash: 'short', userKey: 'google:gsub-b13-bad' });
      expect(bad.ok).toBe(false);
    } finally {
      await cleanup(sid);
    }
  });

  it('acceptInvite (parol) refactor\'dan keyin ham enrollment + USED yozadi', async () => {
    const sid = await readyCommittedSession('pw');
    try {
      const created = await createInvitesForSession(sid);
      const inv = (await sessionInvites(sid)).find((i) => i.identity === 'B13X001');
      const username = `b13pw_${Date.now() % 100000}`;

      const res = await acceptInvite({
        token: created.invites.find((i) => i.identity === 'B13X001').token,
        username,
        password: 'parol-2026-x-uzun',
        email: 'b13x001@test.uz',
        consent: true,
      });
      expect(res.ok).toBe(true);

      const after = await fb.get(`invites/${inv.tokenHash}`);
      expect(after.val().status).toBe(INVITE_STATUS.USED);
      expect(after.val().usedBy).toBe(username);

      const enroll = await fb.get(`enrollments/${username}_Fizika`);
      expect(enroll.exists()).toBe(true);
    } finally {
      await cleanup(sid);
    }
  });
});
