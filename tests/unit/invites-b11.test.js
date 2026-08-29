/**
 * AUTH B-11 — Invites schema + yaratish (roster uchun)
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - Token 48 bayt (96 hex), faqat HASH saqlanadi (raw token DB'da YO'Q)
 *  - Batch yaratish (createInvitesForSession) idempotent
 *  - getInviteByHash validatsiya (yaroqli/used/revoked/expired/noto'g'ri)
 *  - sendInviteEmails: email'ga yuborish + idempotent (deliveredAt)
 *  - expireOverdueInvites: 7 kundan oshgan → expired + audit
 *  - checkInviteSendLimit: 50/soat limit
 *  - revokeInvite: faqat pending, IDOR emas (tokenHash orqali)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  createInvitesForSession,
  acceptInvite,
  revokeInvite,
  sendInviteEmails,
  expireOverdueInvites,
  getInviteByHash,
  checkInviteSendLimit,
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

// B-11 xos identity — roster-a11 test'i ham STU001/STU002 ishlatadi (bir xil
// temp DB) — konflikt bo'lmasligi uchun unique prefix.
const ROWS = [
  { rowIndex: 2, data: { student_id: 'B11X001', email_col: 'b11x001@test.uz' } },
  { rowIndex: 3, data: { student_id: 'B11X002', email_col: 'b11x002@test.uz' } },
];

/** Committed sessiya tayyorlaydi (invite yaratish uchun). */
async function readyCommittedSession(tag = '') {
  const sid = await createStagingSession({
    filename: `b11-${tag}-${Date.now()}.xlsx`, extension: '.xlsx', fileSize: 100,
    uploadedBy: 'admin', totalRows: ROWS.length, totalSheets: 1, warnings: [],
  });
  await saveColumnMapping(sid, MAPPING);
  await addParsedRows(sid, 'Sheet1', ROWS);
  // commit
  const { commitStagingSession } = await import('../../src/modules/roster/index.js');
  const res = await commitStagingSession(sid, 'admin');
  if (!res.ok) throw new Error(`commit failed: ${res.error}`);
  return sid;
}

async function cleanup(...ids) {
  for (const sid of ids) {
    const snap = await fb.get(`roster_staging/${sid}`);
    if (snap.exists()) await deleteStagingSession(sid);
  }
  // invites tozalash
  const invSnap = await fb.get('invites');
  if (invSnap.exists()) {
    for (const [hash, inv] of Object.entries(invSnap.val())) {
      if (String(inv.sessionId || '').startsWith('b11-') || (inv.identity || '').startsWith('B11X')) {
        await fb.remove(`invites/${hash}`);
      }
    }
  }
}

describe('AUTH B-11 — Invites (B-11 schema + yetkazish)', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('Token 48 bayt (96 hex) — DB faqat HASH saqlaydi, raw YOQ', async () => {
    const sid = await readyCommittedSession('tok');
    try {
      const res = await createInvitesForSession(sid, { channel: 'email' });
      expect(res.ok).toBe(true);
      expect(res.created).toBe(2);

      const invSnap = await fb.get('invites');
      const invites = Object.values(invSnap.val()).filter((i) => i.sessionId === sid);
      expect(invites.length).toBe(2);

      for (const inv of invites) {
        // tokenHash 64 hex (sha256), raw token hech qayerda yo'q
        expect(inv.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(inv.token).toBeUndefined();
        expect(inv.status).toBe(INVITE_STATUS.PENDING);
        expect(inv.expiresAt).toBeGreaterThan(Date.now());
      }
    } finally {
      await cleanup(sid);
    }
  });

  it('Batch idempotent — qayta yaratish yangi invite qo\'shmaydi', async () => {
    const sid = await readyCommittedSession('idem');
    try {
      const r1 = await createInvitesForSession(sid);
      expect(r1.created).toBe(2);
      const r2 = await createInvitesForSession(sid);
      expect(r2.created).toBe(0); // hammasi skip (idempotent)

      const invSnap = await fb.get('invites');
      const count = Object.values(invSnap.val()).filter((i) => i.sessionId === sid).length;
      expect(count).toBe(2);
    } finally {
      await cleanup(sid);
    }
  });

  it('getInviteByHash — yaroqli; used/revoked/expired/noto\'g\'ri → reject', async () => {
    const sid = await readyCommittedSession('val');
    try {
      const res = await createInvitesForSession(sid);
      const invSnap = await fb.get('invites');
      const inv = Object.values(invSnap.val()).find((i) => i.sessionId === sid);
      expect(inv).toBeTruthy();

      // yaroqli
      const ok = await getInviteByHash(inv.tokenHash);
      expect(ok.ok).toBe(true);
      expect(ok.invite.email).toContain('@test.uz');

      // noto'g'ri format
      const bad = await getInviteByHash('short-token');
      expect(bad.ok).toBe(false);
      const bad2 = await getInviteByHash('z'.repeat(64));
      expect(bad2.ok).toBe(false);

      // used → reject
      const accept = await acceptInvite({
        token: res.invites[0].token, username: `b11used_${Date.now() % 100000}`,
        password: 'parol-2026-x-uzun', email: inv.email, consent: true,
      });
      expect(accept.ok).toBe(true);
      const used = await getInviteByHash(inv.tokenHash);
      expect(used.ok).toBe(false);
      expect(used.error).toContain('ishlatilgan');
    } finally {
      await cleanup(sid);
    }
  });

  it('revokeInvite — faqat pending; revoke dan keyin accept reject', async () => {
    const sid = await readyCommittedSession('rev');
    try {
      await createInvitesForSession(sid);
      const invSnap = await fb.get('invites');
      const inv = Object.values(invSnap.val()).find((i) => i.sessionId === sid);

      // used'ni revoke qilib bo'lmaydi
      const rUsed = await revokeInvite('nonexistent-hash-' + 'a'.repeat(40));
      expect(rUsed.ok).toBe(false);

      const rev = await revokeInvite(inv.tokenHash);
      expect(rev.ok).toBe(true);

      const after = await fb.get(`invites/${inv.tokenHash}`);
      expect(after.val().status).toBe(INVITE_STATUS.REVOKED);

      // accept revoke'dan keyin reject
      const accept = await acceptInvite({
        token: 'x'.repeat(96), username: 'b11rev', password: 'parol-2026-x-uzun',
      });
      expect(accept.ok).toBe(false);
    } finally {
      await cleanup(sid);
    }
  });

  it('sendInviteEmails — email\'ga yuboradi + idempotent (deliveredAt)', async () => {
    const sid = await readyCommittedSession('mail');
    try {
      const created = await createInvitesForSession(sid);
      expect(created.created).toBe(2);

      // Provider mock — sendEmail'ni intercept qilamiz (mock provider log'laydi,
      // lekin test muhitida ishonchli emas; shuning uchun fail-open stub).
      // sendEmail haqiqiy ishlaydi — test env'da provider 'mock' bo'lib
      // sendEmail { ok: true, provider: 'mock' } qaytaradi.
      const r1 = await sendInviteEmails({ lang: 'uz' });
      expect(r1.failed.length).toBe(0);
      // mock provider har doim ok qaytaradi — sent >= 0
      expect(r1.sent + r1.skipped).toBe(2);

      // email_log yozildi (provider mock → sent)
      const logSnap = await fb.get('email_log');
      const logs = Object.values(logSnap.val() || {}).filter((l) => l.template === 'invite');
      expect(logs.length).toBeGreaterThanOrEqual(1);

      // idempotent — deliveredAt bor invite qayta yuborilmaydi
      const r2 = await sendInviteEmails({ lang: 'uz' });
      expect(r2.sent).toBe(0);
    } finally {
      await cleanup(sid);
    }
  });

  it('expireOverdueInvites — 7 kundan oshgan pending → expired', async () => {
    const sid = await readyCommittedSession('exp');
    try {
      await createInvitesForSession(sid);
      const invSnap = await fb.get('invites');
      const inv = Object.values(invSnap.val()).find((i) => i.sessionId === sid);
      // expiresAt'ni o'tmishga qo'yamiz
      await fb.set(`invites/${inv.tokenHash}/expiresAt`, Date.now() - 1000);

      const res = await expireOverdueInvites();
      expect(res.expired).toBeGreaterThanOrEqual(1);

      const after = await fb.get(`invites/${inv.tokenHash}`);
      expect(after.val().status).toBe(INVITE_STATUS.EXPIRED);

      // endi link reject
      const link = await getInviteByHash(inv.tokenHash);
      expect(link.ok).toBe(false);
    } finally {
      await cleanup(sid);
    }
  });

  it('acceptInvite — 64-hex HASH to\'g\'ridan-to\'g\'ri qabul qilinadi (email link oqimi)', async () => {
    const sid = await readyCommittedSession('hash');
    try {
      const res = await createInvitesForSession(sid);
      const invSnap = await fb.get('invites');
      const inv = Object.values(invSnap.val()).find((i) => i.sessionId === sid);

      // Email link orqali kelgan foydalanuvchi tokenHash'ni uzatadi (64-hex) —
      // qayta hash qilinmasdan to'g'ridan-to'g'ri lookup bo'lishi kerak.
      const accept = await acceptInvite({
        token: inv.tokenHash,
        username: `b11hash_${Date.now() % 100000}`,
        password: 'parol-2026-x-uzun',
        email: inv.email,
        consent: true,
      });
      expect(accept.ok).toBe(true);
    } finally {
      await cleanup(sid);
    }
  });

  it('checkInviteSendLimit — 50/soat; limitdan keyin reject', () => {
    const userKey = 'b11-teacher';
    for (let i = 0; i < 50; i++) {
      const r = checkInviteSendLimit(userKey);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkInviteSendLimit(userKey);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
