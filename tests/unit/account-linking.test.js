/**
 * Deborah — Account Linking Unit Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const testStore = {};

vi.mock('../../firebase/admin.js', () => {
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
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => {
        const parts = path.split('/').filter(Boolean);
        let cur = testStore;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
      }),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach(k => delete testStore[k]);
      }),
    },
    default: {},
  };
});

vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  AUDIT_ACTIONS: {
    ACCOUNT_LINKED: 'account:linked', ACCOUNT_UNLINKED: 'account:unlinked',
    IDENTITY_MISMATCH: 'identity:mismatch', IDENTITY_RESOLVED: 'identity:resolved',
  },
}));

describe('Account Linking', () => {
  let al;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(testStore).forEach(k => delete testStore[k]);
    al = await import('../../src/modules/auth/account-linking.js');
  });

  describe('Create Link Request', () => {
    it('should create a link request', async () => {
      const result = await al.createLinkRequest({ sourceUserId: 'a', targetUserId: 'b', sourceMethod: 'password', targetMethod: 'google' });
      expect(result.ok).toBe(true);
      expect(result.linkId).toBeDefined();
    });

    it('should reject missing users', async () => {
      expect((await al.createLinkRequest({ sourceUserId: 'a' })).ok).toBe(false);
    });

    it('should reject self-link', async () => {
      expect((await al.createLinkRequest({ sourceUserId: 'x', targetUserId: 'x' })).ok).toBe(false);
    });
  });

  describe('Duplicate Prevention', () => {
    it('should reject duplicate link request', async () => {
      await al.createLinkRequest({ sourceUserId: 'dup_a', targetUserId: 'dup_b' });
      const result = await al.createLinkRequest({ sourceUserId: 'dup_a', targetUserId: 'dup_b' });
      expect(result.ok).toBe(false);
    });

    it('should detect reversed direction', async () => {
      await al.createLinkRequest({ sourceUserId: 'x', targetUserId: 'y' });
      expect((await al.createLinkRequest({ sourceUserId: 'y', targetUserId: 'x' })).ok).toBe(false);
    });
  });

  describe('Approve Link Request', () => {
    it('should approve a pending request', async () => {
      const { linkId } = await al.createLinkRequest({ sourceUserId: 'app_a', targetUserId: 'app_b' });
      expect((await al.approveLinkRequest({ requestId: linkId, approvedBy: 'admin' })).ok).toBe(true);
    });

    it('should reject non-existent request', async () => {
      expect((await al.approveLinkRequest({ requestId: 'nope', approvedBy: 'admin' })).ok).toBe(false);
    });

    it('should reject already-resolved request', async () => {
      const { linkId } = await al.createLinkRequest({ sourceUserId: 'da', targetUserId: 'db' });
      await al.approveLinkRequest({ requestId: linkId, approvedBy: 'admin' });
      expect((await al.approveLinkRequest({ requestId: linkId, approvedBy: 'admin' })).ok).toBe(false);
    });

    it('should create bidirectional links', async () => {
      const { linkId } = await al.createLinkRequest({ sourceUserId: 'bi_a', targetUserId: 'bi_b' });
      await al.approveLinkRequest({ requestId: linkId, approvedBy: 'admin' });
      const aLinks = await al.getLinkedAccounts('bi_a');
      const bLinks = await al.getLinkedAccounts('bi_b');
      expect(aLinks.length).toBe(1);
      expect(aLinks[0].linkedUserId).toBe('bi_b');
      expect(bLinks.length).toBe(1);
      expect(bLinks[0].linkedUserId).toBe('bi_a');
    });
  });

  describe('Reject Link Request', () => {
    it('should reject and not create links', async () => {
      const { linkId } = await al.createLinkRequest({ sourceUserId: 'rj_a', targetUserId: 'rj_b' });
      expect((await al.rejectLinkRequest({ requestId: linkId, rejectedBy: 'admin' })).ok).toBe(true);
      expect(await al.getLinkedAccounts('rj_a')).toEqual([]);
    });
  });

  describe('Expired Request', () => {
    it('should reject expired link request', async () => {
      const { linkId } = await al.createLinkRequest({ sourceUserId: 'ea', targetUserId: 'eb' });
      const { fb } = await import('../../firebase/admin.js');
      const snap = await fb.get(`identity_mismatch_queue/${linkId}`);
      const req = snap.val();
      req.expiresAt = Date.now() - 1000;
      await fb.set(`identity_mismatch_queue/${linkId}`, req);
      const result = await al.approveLinkRequest({ requestId: linkId, approvedBy: 'admin' });
      expect(result.ok).toBe(false);
    });
  });

  describe('Remove/Unlink', () => {
    it('should remove a link', async () => {
      const { linkId } = await al.createLinkRequest({ sourceUserId: 'ula', targetUserId: 'ulb' });
      await al.approveLinkRequest({ requestId: linkId, approvedBy: 'admin' });
      expect((await al.removeLink({ userId1: 'ula', userId2: 'ulb', unlinkedBy: 'sys' })).ok).toBe(true);
      expect(await al.getLinkedAccounts('ula')).toEqual([]);
    });

    it('should error on non-existent link', async () => {
      expect((await al.removeLink({ userId1: 'x', userId2: 'y', unlinkedBy: 'admin' })).ok).toBe(false);
    });
  });

  describe('Get Linked Accounts', () => {
    it('should return linked accounts', async () => {
      const { linkId } = await al.createLinkRequest({ sourceUserId: 'la', targetUserId: 'lb', sourceMethod: 'password', targetMethod: 'google' });
      await al.approveLinkRequest({ requestId: linkId, approvedBy: 'admin' });
      const linked = await al.getLinkedAccounts('la');
      expect(linked.length).toBe(1);
      expect(linked[0].linkedUserId).toBe('lb');
      expect(linked[0].method).toBe('google');
    });

    it('should return empty for no links', async () => {
      expect(await al.getLinkedAccounts('lonely')).toEqual([]);
    });
  });

  describe('Identity Mismatch Queue', () => {
    it('should report and list mismatches', async () => {
      await al.reportIdentityMismatch({ email: 'a@test.com', reason: 'email_exists' });
      await al.reportIdentityMismatch({ email: 'b@test.com', reason: 'duplicate_account' });
      const entries = await al.getMismatchQueue();
      expect(entries.length).toBe(2);
    });

    it('should filter by status', async () => {
      await al.reportIdentityMismatch({ email: 'o@test.com', reason: 'email_exists' });
      expect((await al.getMismatchQueue({ status: 'open' })).length).toBe(1);
      expect((await al.getMismatchQueue({ status: 'resolved' })).length).toBe(0);
    });
  });

  describe('Mismatch Resolution', () => {
    it('should resolve a mismatch', async () => {
      const eid = await al.reportIdentityMismatch({ email: 'r@test.com', reason: 'duplicate_account' });
      expect((await al.resolveMismatch({ entryId: eid, resolvedBy: 'admin', resolution: 'merged' })).ok).toBe(true);
      expect((await al.getMismatchQueue({ status: 'open' })).length).toBe(0);
    });

    it('should error on non-existent', async () => {
      expect((await al.resolveMismatch({ entryId: 'nope', resolvedBy: 'admin', resolution: 'dismissed' })).ok).toBe(false);
    });
  });

  describe('Count Open Mismatches', () => {
    it('should return correct count', async () => {
      expect(await al.countOpenMismatches()).toBe(0);
      await al.reportIdentityMismatch({ email: 'c1@test.com', reason: 'email_exists' });
      await al.reportIdentityMismatch({ email: 'c2@test.com', reason: 'duplicate_account' });
      expect(await al.countOpenMismatches()).toBe(2);
    });
  });
});
