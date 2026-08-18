/**
 * Deborah — External Integration Boundary (unit tests, Prompt 66)
 *
 * PURE schema testlari: adapter interface contract (research §19),
 * source-of-truth field mapping, HEMIS pull job FSM (idempotency/retry/
 * dead-letter), ratified-only grade push (§15), pull-back reconciliation,
 * OneID account-link takeover guard (§30.3), token vault envelope
 * encryption (§12.3), endpoint allowlist (no scraping), token reuse guard.
 */

import { describe, it, expect } from 'vitest';
import {
  assertAdapterContract,
  assertAdapterMode,
  assertValidFieldMap,
  mapExternalToCanonical,
  mapCanonicalToExternal,
  assertHemispullTransition,
  buildIdempotencyKey,
  computePayloadHash,
  assertRetryAllowed,
  computeBackoff,
  buildDeadLetterEntry,
  assertRatifiedOnlyPush,
  computeReconciliationDiff,
  assertOneidAccountLink,
  classifyOneidMismatch,
  assertIdentityStatusTransition,
  buildTokenEnvelope,
  decryptTokenEnvelope,
  assertTokenVaultState,
  assertNoTokenReuse,
  assertDocumentedEndpoint,
  constantTimeEqual,
  assertValidEnum,
  HEMIS_FIELD_MAP,
  ONEID_FIELD_MAP,
  SYNC_JOB_STATUS,
} from '../../src/modules/external-integration/external-integration.schema.js';

describe('external-integration — adapter interface contract (§19)', () => {
  it('valid adapter with createJob/getStatus/getArtifact passes', () => {
    const adapter = { createJob: async () => {}, getStatus: async () => {}, getArtifact: async () => {} };
    expect(assertAdapterContract({ provider: 'hemis', adapter }).ok).toBe(true);
    expect(assertAdapterContract({ provider: 'oneid', adapter }).ok).toBe(true);
  });

  it('missing createJob → contract violated', () => {
    const adapter = { getStatus: async () => {}, getArtifact: async () => {} };
    const r = assertAdapterContract({ provider: 'hemis', adapter });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/createJob/);
  });

  it('unknown provider → rejected', () => {
    expect(assertAdapterContract({ provider: 'bogus', adapter: {} }).ok).toBe(false);
  });

  it('sandbox mode default; live requires official contract', () => {
    expect(assertAdapterMode({ mode: 'sandbox' }).ok).toBe(true);
    expect(assertAdapterMode({ mode: 'live', allowLive: false }).ok).toBe(false);
    expect(assertAdapterMode({ mode: 'live', allowLive: true }).ok).toBe(true);
  });
});

describe('external-integration — source-of-truth field mapping', () => {
  it('HEMIS field map requires canonical fields', () => {
    expect(assertValidFieldMap({ kind: 'hemis', map: { studentId: { canonical: 'externalId' } } }).ok).toBe(true);
    const bad = assertValidFieldMap({ kind: 'hemis', map: { studentId: { canonical: 'notAField' } } });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/unknown canonical/);
  });

  it('maps external → canonical, tracks missing required', () => {
    const r = mapExternalToCanonical({
      kind: 'hemis',
      source: { studentId: 'HEM-1', firstName: 'Aziz', lastName: 'Karimov', pinfl: '31001990012345' },
    });
    expect(r.mapped.externalId).toBe('HEM-1');
    expect(r.mapped.pinfl).toBe('31001990012345');
    expect(r.missingRequired).toEqual([]);
  });

  it('flags missing required fields (no silent fill)', () => {
    const r = mapExternalToCanonical({ kind: 'hemis', source: { studentId: 'HEM-1' } });
    expect(r.missingRequired).toContain('firstName');
    expect(r.missingRequired).toContain('pinfl');
    expect(r.mapped.pinfl).toBeUndefined();
  });

  it('maps canonical → external (push format)', () => {
    const out = mapCanonicalToExternal({ kind: 'hemis', canonical: { externalId: 'HEM-1', finalGrade: 88 } });
    expect(out.studentId).toBe('HEM-1');
  });
});

describe('external-integration — HEMIS pull job FSM / idempotency / retry / DLQ', () => {
  it('valid transitions', () => {
    expect(assertHemispullTransition({ from: 'pending', to: 'running' }).ok).toBe(true);
    expect(assertHemispullTransition({ from: 'running', to: 'success' }).ok).toBe(true);
    expect(assertHemispullTransition({ from: 'running', to: 'failed' }).ok).toBe(true);
    expect(assertHemispullTransition({ from: 'failed', to: 'dead_letter' }).ok).toBe(true);
    expect(assertHemispullTransition({ from: 'success', to: 'running' }).ok).toBe(false);
  });

  it('idempotency key is deterministic and payload-sensitive', () => {
    const k1 = buildIdempotencyKey({ tenantId: 1, direction: 'pull', entity: 'roster', payloadHash: 'abc' });
    const k2 = buildIdempotencyKey({ tenantId: 1, direction: 'pull', entity: 'roster', payloadHash: 'abc' });
    const k3 = buildIdempotencyKey({ tenantId: 1, direction: 'pull', entity: 'roster', payloadHash: 'def' });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('payload hash is deterministic', () => {
    expect(computePayloadHash({ a: 1 })).toBe(computePayloadHash({ a: 1 }));
    expect(computePayloadHash({ a: 1 })).not.toBe(computePayloadHash({ a: 2 }));
  });

  it('retry guard — backoff not elapsed / max attempts → DLQ', () => {
    const now = 1_000_000;
    expect(assertRetryAllowed({ attempts: 0, maxAttempts: 5, nextRetryAt: null, now }).ok).toBe(true);
    expect(assertRetryAllowed({ attempts: 0, maxAttempts: 5, nextRetryAt: now + 5000, now }).ok).toBe(false);
    const exhausted = assertRetryAllowed({ attempts: 5, maxAttempts: 5, now });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.deadLetter).toBe(true);
  });

  it('exponential backoff doubles', () => {
    expect(computeBackoff({ attempt: 0, baseMs: 1000 })).toBe(1000);
    expect(computeBackoff({ attempt: 1, baseMs: 1000 })).toBe(2000);
    expect(computeBackoff({ attempt: 3, baseMs: 1000 })).toBe(8000);
    expect(computeBackoff({ attempt: 20, baseMs: 1000 })).toBe(5 * 60 * 1000); // capped
  });

  it('dead-letter entry includes error + attempts', () => {
    const dl = buildDeadLetterEntry({ jobId: 7, error: 'boom', attempts: 5 });
    expect(dl.status).toBe(SYNC_JOB_STATUS.DEAD_LETTER);
    expect(dl.error).toBe('boom');
    expect(dl.attempts).toBe(5);
  });
});

describe('external-integration — ratified-only grade push (§15)', () => {
  it('only ratified decisions can be pushed', () => {
    expect(assertRatifiedOnlyPush({ decision: 'ratified' }).ok).toBe(true);
    expect(assertRatifiedOnlyPush({ decision: 'provisional' }).ok).toBe(false);
    expect(assertRatifiedOnlyPush({ decision: 'rejected' }).ok).toBe(false);
    expect(assertRatifiedOnlyPush({ decision: '' }).ok).toBe(false);
  });
});

describe('external-integration — pull-back reconciliation', () => {
  it('computes added/removed/changed by key', () => {
    const diff = computeReconciliationDiff({
      external: [
        { externalId: 'A', name: 'x' },
        { externalId: 'B', name: 'y' },
        { externalId: 'C', name: 'z' },
      ],
      local: [
        { externalId: 'A', name: 'x' },
        { externalId: 'B', name: 'CHANGED' },
        { externalId: 'D', name: 'w' },
      ],
      keyField: 'externalId',
    });
    expect(diff.added.map((r) => r.externalId)).toEqual(['C']);
    expect(diff.removed.map((r) => r.externalId)).toEqual(['D']);
    expect(diff.changed.map((r) => r.key)).toEqual(['B']);
    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
    expect(diff.changedCount).toBe(1);
  });
});

describe('external-integration — OneID account-link takeover guard (§30.3)', () => {
  it('subject match + I2+ assurance → allowed', () => {
    expect(assertOneidAccountLink({ providerSubject: 'P1', localSubject: 'P1', assuranceLevel: 'I2' }).ok).toBe(true);
    expect(assertOneidAccountLink({ providerSubject: 'P1', localSubject: 'P1', assuranceLevel: 'I3' }).ok).toBe(true);
  });

  it('subject mismatch → takeover rejected (fail-closed)', () => {
    const r = assertOneidAccountLink({ providerSubject: 'EVIL', localSubject: 'P1', assuranceLevel: 'I2' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/takeover/);
  });

  it('assurance below I2 → rejected', () => {
    expect(assertOneidAccountLink({ providerSubject: 'P1', localSubject: 'P1', assuranceLevel: 'I1' }).ok).toBe(false);
    expect(assertOneidAccountLink({ providerSubject: 'P1', localSubject: 'P1', assuranceLevel: 'I0' }).ok).toBe(false);
  });

  it('mismatch is queued as pending, not auto-rejected (§30.3)', () => {
    expect(classifyOneidMismatch({ providerSubject: 'P1', localSubject: 'P1' }).verdict).toBe('match');
    const pending = classifyOneidMismatch({ providerSubject: 'P1', localSubject: 'P2' });
    expect(pending.verdict).toBe('pending');
  });

  it('identity status FSM — pending→linked→revoked only', () => {
    expect(assertIdentityStatusTransition({ from: 'pending', to: 'linked' }).ok).toBe(true);
    expect(assertIdentityStatusTransition({ from: 'linked', to: 'revoked' }).ok).toBe(true);
    expect(assertIdentityStatusTransition({ from: 'revoked', to: 'linked' }).ok).toBe(false);
  });
});

describe('external-integration — token vault envelope encryption (§12.3)', () => {
  it('envelope round-trip with master key', () => {
    const env = buildTokenEnvelope({ plaintext: 'secret-token-123', masterKey: 'a-very-long-master-key-123456' });
    expect(env.ok).toBe(true);
    expect(env.ciphertext).toBeTruthy();
    expect(env.iv).toBeTruthy();
    expect(env.keyRef).toBeTruthy();
    expect(env.ciphertext).not.toContain('secret-token-123'); // no plaintext in ciphertext

    const dec = decryptTokenEnvelope({ ciphertext: env.ciphertext, iv: env.iv, keyRef: env.keyRef, masterKey: 'a-very-long-master-key-123456' });
    expect(dec.ok).toBe(true);
    expect(dec.plaintext).toBe('secret-token-123');
  });

  it('wrong master key → fail-closed', () => {
    const env = buildTokenEnvelope({ plaintext: 'secret', masterKey: 'a-very-long-master-key-123456' });
    const dec = decryptTokenEnvelope({ ciphertext: env.ciphertext, iv: env.iv, keyRef: env.keyRef, masterKey: 'wrong-master-key-0000000000' });
    expect(dec.ok).toBe(false);
  });

  it('short master key → rejected (fail-closed)', () => {
    expect(buildTokenEnvelope({ plaintext: 'x', masterKey: 'short' }).ok).toBe(false);
  });

  it('vault state — ciphertext required, plaintext never stored, revoked/expired rejected', () => {
    expect(assertTokenVaultState({ row: { ciphertext: 'c', iv: 'i', keyRef: 'k' } }).ok).toBe(true);
    expect(assertTokenVaultState({ row: { ciphertext: 'c', iv: 'i', keyRef: 'k', plaintext: 'leak' } }).ok).toBe(false);
    expect(assertTokenVaultState({ row: { ciphertext: 'c', iv: 'i' } }).ok).toBe(false);
    expect(assertTokenVaultState({ row: { ciphertext: 'c', iv: 'i', keyRef: 'k', revokedAt: '2025-01-01' } }).ok).toBe(false);
  });

  it('token reuse guard — required scopes must be granted', () => {
    expect(assertNoTokenReuse({ tokenScopes: ['roster.read', 'grades.write'], requiredScopes: ['grades.write'] }).ok).toBe(true);
    expect(assertNoTokenReuse({ tokenScopes: ['roster.read'], requiredScopes: ['grades.write'] }).ok).toBe(false);
    expect(assertNoTokenReuse({ tokenScopes: [], requiredScopes: [] }).ok).toBe(false);
  });
});

describe('external-integration — endpoint allowlist (no scraping)', () => {
  it('documented endpoints allowed', () => {
    expect(assertDocumentedEndpoint({ provider: 'hemis', endpoint: '/api/v1/students' }).ok).toBe(true);
    expect(assertDocumentedEndpoint({ provider: 'oneid', endpoint: '/api/v1/identity/verify' }).ok).toBe(true);
  });

  it('undocumented endpoint → rejected (fail-closed, no scraping)', () => {
    const r = assertDocumentedEndpoint({ provider: 'hemis', endpoint: '/api/v1/admin/users/export-all' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/undocumented/);
  });

  it('empty endpoint → rejected', () => {
    expect(assertDocumentedEndpoint({ provider: 'hemis', endpoint: '' }).ok).toBe(false);
  });
});

describe('external-integration — utilities', () => {
  it('constant-time compare', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('enum validator fail-closed', () => {
    expect(assertValidEnum({ value: 'hemis', allowed: ['hemis', 'oneid'] }).ok).toBe(true);
    expect(assertValidEnum({ value: 'bogus', allowed: ['hemis', 'oneid'] }).ok).toBe(false);
    expect(assertValidEnum({ value: undefined, allowed: ['hemis'] }).ok).toBe(false);
  });
});
