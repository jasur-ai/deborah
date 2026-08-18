/**
 * Deborah — Socket Identity Unit Tests
 *
 * Tests:
 *   1. createTicket / verifyTicket — HMAC-signed tickets
 *   2. Ticket expiry
 *   3. Malformed / forged ticket rejection
 *   4. createHostGrant / verifyHostReconnect — persistent host grants
 *   5. checkOwnership — ABAC logic
 *   6. Ticket TTL enforcement
 */

import { describe, it, expect } from 'vitest';
import { createSocketIdentity } from '../../middleware/socket-identity.js';

const TEST_SECRET = 'test-secret-key-for-unit-tests-only';

// Since socket-identity uses Firebase (fb), we test ticket logic only
// The Firebase-dependent methods (createHostGrant, verifyHostReconnect, checkOwnership)
// are tested via integration tests.

describe('createTicket / verifyTicket', () => {
  const identity = createSocketIdentity(TEST_SECRET);

  it('should create a valid ticket', () => {
    const { ticket, expiresAt, nonce } = identity.createTicket('abc12', 'host', 'TestHost');
    expect(ticket).toBeDefined();
    expect(typeof ticket).toBe('string');
    expect(ticket.split(':').length).toBe(6); // code:role:identity:expiresAt:nonce:hmac
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(nonce).toBeDefined();
    expect(nonce.length).toBe(16); // 8 bytes hex
  });

  it('should verify a valid ticket', () => {
    const { ticket } = identity.createTicket('abc12', 'host', 'TestHost');
    const result = identity.verifyTicket(ticket);
    expect(result.valid).toBe(true);
    expect(result.code).toBe('abc12');
    expect(result.role).toBe('host');
    expect(result.identity).toBe('TestHost');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('should create player tickets', () => {
    const { ticket } = identity.createTicket('xyz99', 'player', 'Player1');
    const result = identity.verifyTicket(ticket);
    expect(result.valid).toBe(true);
    expect(result.role).toBe('player');
    expect(result.identity).toBe('Player1');
    expect(result.code).toBe('xyz99');
  });

  it('should reject a ticket with forged signature', () => {
    const { ticket } = identity.createTicket('abc12', 'host', 'TestHost');
    const forgedTicket = ticket.slice(0, -5) + 'AAAAA'; // Corrupt the HMAC
    const result = identity.verifyTicket(forgedTicket);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('signature');
  });

  it('should reject a ticket with modified payload', () => {
    const { ticket } = identity.createTicket('abc12', 'host', 'TestHost');
    const parts = ticket.split(':');
    parts[0] = 'xyz99'; // Change the code
    const tampered = parts.join(':');
    const result = identity.verifyTicket(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('signature');
  });

  it('should reject a malformed ticket', () => {
    expect(identity.verifyTicket('short').valid).toBe(false);
    expect(identity.verifyTicket('').valid).toBe(false);
    expect(identity.verifyTicket(null).valid).toBe(false);
    expect(identity.verifyTicket(undefined).valid).toBe(false);
  });

  it('should reject an expired ticket', () => {
    // Create a ticket with already-expired TTL (negative)
    const pastTicket = identity.createTicket('abc12', 'host', 'TestHost', -1000);
    const result = identity.verifyTicket(pastTicket.ticket);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expired');
  });
});

describe('Ticket with different secrets', () => {
  it('should NOT verify a ticket from a different secret', () => {
    const identityA = createSocketIdentity('secret-a');
    const identityB = createSocketIdentity('secret-b');

    const { ticket } = identityA.createTicket('abc12', 'host', 'HostA');
    const result = identityB.verifyTicket(ticket);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('signature');
  });
});

describe('Identity with nonce uniqueness', () => {
  const identity = createSocketIdentity(TEST_SECRET);

  it('should generate different nonces for consecutive tickets', () => {
    const t1 = identity.createTicket('abc12', 'host', 'Host');
    const t2 = identity.createTicket('abc12', 'host', 'Host');
    expect(t1.nonce).not.toBe(t2.nonce);
    expect(t1.ticket).not.toBe(t2.ticket);
  });
});

describe('Default secret fallback', () => {
  it('should use default secret when none provided', () => {
    const identity = createSocketIdentity();
    const { ticket } = identity.createTicket('abc12', 'host', 'Host');
    const result = identity.verifyTicket(ticket);
    expect(result.valid).toBe(true);
  });
});

describe('Ticket identity with special characters', () => {
  const identity = createSocketIdentity(TEST_SECRET);
  const identityWithColon = createSocketIdentity(TEST_SECRET);

  it('should handle identity with special characters', () => {
    const { ticket } = identity.createTicket('abc12', 'host', 'Test-Host_123');
    const result = identity.verifyTicket(ticket);
    expect(result.valid).toBe(true);
    expect(result.identity).toBe('Test-Host_123');
  });
});

describe('isWatcher helper', () => {
  const identity = createSocketIdentity(TEST_SECRET);

  it('should return true for watcher role', () => {
    const socket = { data: { identity: { role: 'watcher', verified: true } } };
    expect(identity.isWatcher(socket)).toBe(true);
  });

  it('should return false for host role', () => {
    const socket = { data: { identity: { role: 'host', verified: true } } };
    expect(identity.isWatcher(socket)).toBe(false);
  });

  it('should return false for anonymous', () => {
    const socket = { data: { identity: { role: 'anonymous', verified: false } } };
    expect(identity.isWatcher(socket)).toBe(false);
  });

  it('should return true for watcher role via socket.data.role', () => {
    const socket = { data: { role: 'watcher' } };
    expect(identity.isWatcher(socket)).toBe(true);
  });
});

describe('checkOwnership', () => {
  const identity = createSocketIdentity(TEST_SECRET);

  it('should authorize host with verified ticket identity', async () => {
    const socket = { data: { identity: { role: 'host', code: 'abc12', verified: true } } };
    const result = await identity.checkOwnership(socket, 'abc12');
    expect(result.authorized).toBe(true);
  });

  it('should reject wrong game code', async () => {
    const socket = { data: { identity: { role: 'host', code: 'abc12', verified: true } } };
    const result = await identity.checkOwnership(socket, 'xyz99');
    expect(result.authorized).toBe(false);
  });

  it('should reject non-host role', async () => {
    const socket = { data: { identity: { role: 'player', code: 'abc12', verified: true } } };
    const result = await identity.checkOwnership(socket, 'abc12');
    expect(result.authorized).toBe(false);
  });

  it('should reject anonymous socket', async () => {
    const socket = { data: { identity: { role: 'anonymous', verified: false } } };
    const result = await identity.checkOwnership(socket, 'abc12');
    expect(result.authorized).toBe(false);
  });
});
