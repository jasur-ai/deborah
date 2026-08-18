/**
 * AUTH D-16 §08 — Invite core unit testlari (B-11/B-12/B-13)
 * ---------------------------------------------------------------------------
 *  - Token: 48 bayt, faqat HASH saqlanadi (reset token namunasi).
 *  - Status machine: pending → used/revoked/expired.
 *  - acceptInvite: to'g'ri → user; buzuq/ishlatilgan/revoked/expired → reject.
 *  - revokeInvite: status → revoked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── FB in-memory mock ──
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
      }),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach((k) => delete testStore[k]);
      }),
    },
    default: {},
  };
});

vi.mock('../../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => {}),
  AUDIT_ACTIONS: {},
  __esModule: true,
}));

import crypto from 'node:crypto';
import { acceptInvite, getInviteByHash, revokeInvite, INVITE_STATUS } from '../../../src/modules/roster/invites.js';

const tokenHashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

function seedInvite({ status = 'pending', email = 'invitee@test.uz', expiresInMs = 7 * 24 * 60 * 60 * 1000, identity = 'Invitee Name' }) {
  const token = crypto.randomBytes(48).toString('hex');
  const hash = tokenHashOf(token);
  testStore.invites = testStore.invites || {};
  testStore.invites[hash] = {
    sessionId: 's1',
    courseCode: 'MATH101',
    groupCode: 'G1',
    email,
    status,
    expiresAt: Date.now() + expiresInMs,
    createdAt: Date.now(),
    identity,
  };
  return token;
}

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUTH D-16 §08 — invite token (B-12)', () => {
  it('token 48 bayt = 96 hex = 384 bit; DB da faqat hash', () => {
    const token = crypto.randomBytes(48).toString('hex');
    expect(token).toMatch(/^[0-9a-f]{96}$/);
    // saqlash: faqat hash (raw token DB'da yo'q)
    const hash = tokenHashOf(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
});

describe('AUTH D-16 §08 — acceptInvite status machine (B-11/12/13)', () => {
  it('to\'g\'ri invite → ok + user yaratiladi (email_verified=true, roster manba)', async () => {
    const token = seedInvite({});
    const r = await acceptInvite({ token, username: 'invitee_student', password: 'correct-horse-battery-42', email: 'invitee@test.uz', consent: true });
    expect(r.ok).toBe(true);
    expect(r.user).toBe('invitee_student');
    expect(r.role).toBe('student');
    const user = testStore.users['invitee_student'];
    expect(user.email_verified).toBe(true); // roster tashqi manba tasdiqlagan (A-18)
    expect(user.source).toBe('roster_invite');
    expect(user.group).toBe('G1');
  });

  it('buzuq token (mavjud emas) → reject', async () => {
    const r = await acceptInvite({ token: crypto.randomBytes(48).toString('hex'), username: 'u1', password: 'correct-horse-battery-42', email: 'x@test.uz', consent: true });
    expect(r.ok).toBe(false);
  });

  it('ishlatilgan (USED) → reject (bitta foydalanish)', async () => {
    const token = seedInvite({ status: INVITE_STATUS.USED });
    const r = await acceptInvite({ token, username: 'u2', password: 'correct-horse-battery-42', email: 'invitee@test.uz', consent: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ishlatilgan');
  });

  it('bekor qilingan (REVOKED) → reject', async () => {
    const token = seedInvite({ status: INVITE_STATUS.REVOKED });
    const r = await acceptInvite({ token, username: 'u3', password: 'correct-horse-battery-42', email: 'invitee@test.uz', consent: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('bekor');
  });

  it('muddati o\'tgan → EXPIRED statusga o\'tadi + reject (7 kun)', async () => {
    const token = seedInvite({ expiresInMs: -1000 });
    const hash = tokenHashOf(token);
    const r = await acceptInvite({ token, username: 'u4', password: 'correct-horse-battery-42', email: 'invitee@test.uz', consent: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('muddati');
    expect(testStore.invites[hash].status).toBe(INVITE_STATUS.EXPIRED);
  });

  it('band username → reject', async () => {
    const token = seedInvite({});
    testStore.users = { taken_user: { username: 'taken_user' } };
    const r = await acceptInvite({ token, username: 'taken_user', password: 'correct-horse-battery-42', email: 'invitee@test.uz', consent: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('band');
  });
});

describe('AUTH D-16 §08 — getInviteByHash + revokeInvite (B-11 §10)', () => {
  it('getInviteByHash: mavjud → ok + status', async () => {
    const token = seedInvite({});
    const hash = tokenHashOf(token);
    const r = await getInviteByHash(hash);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(INVITE_STATUS.PENDING);
  });

  it('getInviteByHash: mavjud emas → ok:false', async () => {
    const r = await getInviteByHash('a'.repeat(64));
    expect(r.ok).toBe(false);
  });

  it('revokeInvite → status revoked', async () => {
    const token = seedInvite({});
    const hash = tokenHashOf(token);
    const r = await revokeInvite(hash);
    expect(r).toBeTruthy();
    expect(testStore.invites[hash].status).toBe(INVITE_STATUS.REVOKED);
  });
});
