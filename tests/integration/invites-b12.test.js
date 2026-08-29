/**
 * AUTH B-12 — Invite aktivatsiya view + validatsiya
 * -------------------------------------------------------------------
 * Integration:
 *  - GET /invite/:token — yaroqli invite → 200 + invite.ejs render
 *    (kurs/guruh prefilled, email prefilled+disabled, no-referrer, CSRF)
 *  - GET /invite/:invalid — 404 (noto'g'ri format / topilmadi)
 *  - GET /invite/:used — 404 + 'ishlatilgan' UX xabari
 *  - GET /invite/:expired — 404 + 'muddati o'tgan' UX xabari
 *  - POST /api/roster/invites/accept — forma oqimi: user + enrollment
 *    yaratiladi, invite USED, email_verified true, guruh prefilled
 *  - Per-IP brute-force rate limit (B-12 §15/§27): 30/15 daqiqa → 429
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { createStagingSession, addParsedRows, saveColumnMapping, deleteStagingSession } from '../../src/modules/roster/index.js';
import { createInvitesForSession } from '../../src/modules/roster/invites.js';

const PORT = 34772;

let app;
let httpServer;
let base;
let invitesByRow = {}; // rowIndex -> { tokenHash, ... }

const MAPPING = {
  student_id: { field: 'userId', entity: 'user', required: true },
  email_col: { field: 'email', entity: 'user', required: false },
};

// 5 qator: X001 render, X003 used, X004 expired, X005 accept; X002 oddiy qator.
const ROWS = [
  { rowIndex: 2, data: { student_id: 'B12X001', email_col: 'b12x001@test.uz', fan: 'Fizika', guruh: '2-guruh' } },
  { rowIndex: 3, data: { student_id: 'B12X002', email_col: 'b12x002@test.uz', fan: 'Fizika', guruh: '2-guruh' } },
  { rowIndex: 4, data: { student_id: 'B12X003', email_col: 'b12x003@test.uz', fan: 'Matematika', guruh: '1-guruh' } },
  { rowIndex: 5, data: { student_id: 'B12X004', email_col: 'b12x004@test.uz', fan: 'Informatika', guruh: '3-guruh' } },
  { rowIndex: 6, data: { student_id: 'B12X005', email_col: 'b12x005@test.uz', fan: 'Fizika', guruh: '3-guruh' } },
];

async function sessionInvites() {
  const snap = await fb.get('invites');
  if (!snap.exists()) return {};
  return Object.values(snap.val()).filter((i) => String(i.sessionId || '').startsWith('b12-'));
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(PORT, r));
  base = `http://localhost:${PORT}`;

  // Committed sessiya + invites
  const sid = await createStagingSession({
    filename: `b12-${Date.now()}.xlsx`, extension: '.xlsx', fileSize: 100,
    uploadedBy: 'admin', totalRows: ROWS.length, totalSheets: 1, warnings: [],
  });
  await saveColumnMapping(sid, MAPPING);
  await addParsedRows(sid, 'Sheet1', ROWS);
  const { commitStagingSession } = await import('../../src/modules/roster/index.js');
  const res = await commitStagingSession(sid, 'admin');
  if (!res.ok) throw new Error(`commit failed: ${res.error}`);
  const createdInvites = await createInvitesForSession(sid);
  expect(createdInvites.created).toBe(5);

  const snaps = await fb.get('invites');
  const all = Object.values(snaps.val()).filter((i) => i.sessionId === sid);
  for (const inv of all) {
    const rowNum = Number(String(inv.identity).replace('B12X', ''));
    invitesByRow[rowNum] = inv;
  }
  expect(Object.keys(invitesByRow).length).toBe(5);
});

afterAll(async () => {
  // Invite orqali yaratilgan user'larni tozalash (boshqa testlar bilan konflikt)
  const usersSnap = await fb.get('users');
  if (usersSnap.exists()) {
    for (const [key, u] of Object.entries(usersSnap.val())) {
      if (u.source === 'roster_invite' && String(u.inviteTokenHash || '').startsWith('')) {
        const invSnap = await fb.get(`invites/${u.inviteTokenHash}`);
        if (invSnap.exists() && String(invSnap.val().sessionId || '').startsWith('b12-')) {
          await fb.remove(`users/${key}`);
          await fb.remove(`enrollments/${key}_${invSnap.val().courseCode}`);
        }
      }
    }
  }
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH B-12 — Invite aktivatsiya view', () => {
  it('GET /invite/:token — yaroqli → 200 + to\'liq render (kurs/guruh/email prefilled)', async () => {
    const inv = invitesByRow[1];
    expect(inv).toBeTruthy();
    const res = await fetch(`${base}/invite/${inv.tokenHash}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');

    const html = await res.text();
    // Forma + token hidden
    expect(html).toContain('id="form-invite"');
    expect(html).toContain(`name="token" value="${inv.tokenHash}"`);
    // Kurs/guruh/email prefilled
    expect(html).toContain('Fizika');
    expect(html).toContain('2-guruh');
    expect(html).toContain(`value="b12x001@test.uz"`);
    // Email input disabled (invite'dan kelgan — o\'zgartirilmaydi)
    expect(html).toMatch(/id="inv-email"[^>]*disabled/);
    // Google bog'lash havolasi token'ni uzatadi (B-13 tayyor)
    expect(html).toContain(`/auth/google?invite=${encodeURIComponent(inv.tokenHash)}`);
    // Welcoming + button
    expect(html).toContain('Siz Deborah platformasiga taklif qilindingiz');
    expect(html).toContain('Taklifni qabul qilish');
  });

  it('GET /invite/:invalid — noto\'g\'ri format → 404', async () => {
    const res = await fetch(`${base}/invite/short-token`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('Taklif havolasi noto');
  });

  it('GET /invite/:unknown — 64-hex lekin mavjud emas → 404', async () => {
    const res = await fetch(`${base}/invite/${'z'.repeat(64)}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('Taklif havolasi noto');
  });

  it('GET /invite/:used — ishlatilgan → 404 + UX xabar', async () => {
    const inv = invitesByRow[3];
    // Avval accept qilamiz (invite USED bo\'ladi)
    const accept = await fetch(`${base}/api/roster/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: inv.tokenHash,
        username: `b12used_${Date.now() % 100000}`,
        password: 'parol-2026-x-uzun',
        consent: true,
      }),
    });
    expect(accept.status).toBe(200);
    const acceptBody = await accept.json();
    expect(acceptBody.ok).toBe(true);

    // Endi link 404 + 'ishlatilgan' xabari
    const res = await fetch(`${base}/invite/${inv.tokenHash}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('allaqachon ishlatilgan');
  });

  it('GET /invite/:expired — muddati o\'tgan → 404 + UX xabar', async () => {
    const inv = invitesByRow[4];
    // expiresAt'ni o\'tmishga qo\'yamiz
    await fb.set(`invites/${inv.tokenHash}/expiresAt`, Date.now() - 1000);
    const res = await fetch(`${base}/invite/${inv.tokenHash}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    // EJS apostrofni HTML-escape qiladi: o&#39;tgan
    expect(html).toContain("muddati o&#39;tgan");
  });

  it('POST /api/roster/invites/accept — forma oqimi: user + enrollment + USED', async () => {
    const inv = invitesByRow[5];
    const username = `b12acc_${Date.now() % 100000}`;
    const res = await fetch(`${base}/api/roster/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: inv.tokenHash,
        username,
        password: 'parol-2026-x-uzun',
        consent: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user).toBe(safeKey(username));
    expect(body.group).toBe('3-guruh');

    // User DB'da: role student, guruh prefilled, email roster'dan, verified
    const user = await fb.get(`users/${safeKey(username)}`);
    expect(user.exists()).toBe(true);
    const u = user.val();
    expect(u.role).toBe('student');
    expect(u.group).toBe('3-guruh');
    expect(u.email).toBe('b12x005@test.uz');
    expect(u.email_verified).toBe(true);
    expect(u.source).toBe('roster_invite');

    // Enrollment (course prefilled)
    const enroll = await fb.get(`enrollments/${safeKey(username)}_Fizika`);
    expect(enroll.exists()).toBe(true);
    expect(enroll.val().status).toBe('active');

    // Invite USED + usedBy
    const after = await fb.get(`invites/${inv.tokenHash}`);
    expect(after.val().status).toBe('used');
    expect(after.val().usedBy).toBe(safeKey(username));
  });

  it('Per-IP rate limit — 30/15 daqiqa; limitdan keyin 429', async () => {
    // Ilgari 3 ta GET bo\'lgan (render + used + expired) — shuning uchun
    // limitga yetish uchun qolganini to\'ldirib, 429 ni tekshiramiz.
    let got429 = false;
    for (let i = 0; i < 32; i++) {
      const res = await fetch(`${base}/invite/${'f'.repeat(64)}`);
      if (res.status === 429) {
        got429 = true;
        const html = await res.text();
        expect(html).toContain('429');
        break;
      }
    }
    expect(got429).toBe(true);
  });
});
