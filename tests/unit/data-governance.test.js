/**
 * Edikit — Data Classification, Privacy, Retention & Purge (unit tests, Prompt 65)
 *
 * PURE schema testlari: D0-D6 classification, access matrix (fail-closed),
 * UZ boundary (D4+), KMS requirement (D3+), retention compute, legal hold
 * fail-closed guard (§15), DSAR/purge FSMs, deletion receipt hash,
 * backup-expiry check.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAsset,
  assertDataClassAccess,
  assertUzBoundary,
  assertKmsRequired,
  computeRetention,
  assertLegalHoldFailClosed,
  assertDsarTransition,
  assertDsarDeleteComplete,
  assertPurgeTransition,
  buildDeletionReceipt,
  assertBackupExpired,
  assertValidEnum,
  DATA_CLASSES,
  DSAR_STATUS,
  PURGE_STATUS,
} from '../../src/modules/data-governance/data-governance.schema.js';

describe('data-governance — classification (D0-D6)', () => {
  it('classifies PII/regulatory as D4', () => {
    expect(classifyAsset({ assetType: 'table', containsPii: true }).dataClass).toBe('D4');
    expect(classifyAsset({ assetType: 'object', regulatory: true }).dataClass).toBe('D4');
  });

  it('classifies provider as D3, cache as D1, default table as D1', () => {
    expect(classifyAsset({ assetType: 'provider' }).dataClass).toBe('D3');
    expect(classifyAsset({ assetType: 'cache' }).dataClass).toBe('D1');
    expect(classifyAsset({ assetType: 'table' }).dataClass).toBe('D1');
  });

  it('rejects unsupported asset types', () => {
    expect(classifyAsset({ assetType: 'exe' }).dataClass).toBeNull();
  });

  it('class constants — D4 requires KMS + UZ boundary', () => {
    expect(DATA_CLASSES.D4.kmsRequired).toBe(true);
    expect(DATA_CLASSES.D4.uzBoundary).toBe(true);
    expect(DATA_CLASSES.D0.uzBoundary).toBe(false);
  });
});

describe('data-governance — access matrix (fail-closed)', () => {
  it('D0/D1 allow any/user', () => {
    expect(assertDataClassAccess({ dataClass: 'D0', action: 'read', role: 'any' }).ok).toBe(true);
    expect(assertDataClassAccess({ dataClass: 'D1', action: 'read', role: 'user' }).ok).toBe(true);
  });

  it('D4 restricted to admin/privacy roles', () => {
    expect(assertDataClassAccess({ dataClass: 'D4', action: 'read', role: 'admin' }).ok).toBe(true);
    expect(assertDataClassAccess({ dataClass: 'D4', action: 'read', role: 'user' }).ok).toBe(false);
    expect(assertDataClassAccess({ dataClass: 'D4', action: 'delete', role: 'user' }).ok).toBe(false);
  });

  it('unknown class/action denied (fail-closed)', () => {
    expect(assertDataClassAccess({ dataClass: 'D9', action: 'read' }).ok).toBe(false);
    expect(assertDataClassAccess({ dataClass: 'D1', action: 'hack' }).ok).toBe(false);
  });
});

describe('data-governance — UZ boundary + KMS', () => {
  it('D4+ never leaves UZ', () => {
    expect(assertUzBoundary({ dataClass: 'D4', region: 'UZ' }).ok).toBe(true);
    expect(assertUzBoundary({ dataClass: 'D4', region: 'EU' }).ok).toBe(false);
    expect(assertUzBoundary({ dataClass: 'D1', region: 'EU' }).ok).toBe(true);
  });

  it('D3+ requires KMS', () => {
    expect(assertKmsRequired({ dataClass: 'D3', kmsEnabled: false }).ok).toBe(false);
    expect(assertKmsRequired({ dataClass: 'D3', kmsEnabled: true }).ok).toBe(true);
    expect(assertKmsRequired({ dataClass: 'D1', kmsEnabled: false }).ok).toBe(true);
  });
});

describe('data-governance — retention', () => {
  it('computes purge_after from retention days', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    const r = computeRetention({ retentionDays: 90, legalBasis: 'consent', storedAt: base });
    expect(r.retentionDays).toBe(90);
    expect(r.legalBasis).toBe('consent');
    expect(r.purgeAfter.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(r.scheduledAt.toISOString()).toBe('2026-03-02T00:00:00.000Z'); // 30 kun oldin
  });
});

describe('data-governance — legal hold fail-closed (§15)', () => {
  it('purge blocked unless hold status checked', () => {
    expect(assertLegalHoldFailClosed({ holdActive: false, holdChecked: false }).ok).toBe(false);
  });

  it('purge blocked while hold active', () => {
    expect(assertLegalHoldFailClosed({ holdActive: true, holdChecked: true }).ok).toBe(false);
  });

  it('purge allowed only when hold checked and not active', () => {
    expect(assertLegalHoldFailClosed({ holdActive: false, holdChecked: true }).ok).toBe(true);
  });
});

describe('data-governance — DSAR FSM', () => {
  it('received → in_progress → fulfilled', () => {
    expect(assertDsarTransition({ from: 'received', to: 'in_progress' }).ok).toBe(true);
    expect(assertDsarTransition({ from: 'in_progress', to: 'fulfilled' }).ok).toBe(true);
    expect(assertDsarTransition({ from: 'fulfilled', to: 'in_progress' }).ok).toBe(false); // terminal
    expect(assertDsarTransition({ from: 'received', to: 'fulfilled' }).ok).toBe(false);
  });

  it('delete DSAR requires all derived stores purged', () => {
    const complete = assertDsarDeleteComplete({
      receipts: [{ storeName: 'postgres', status: PURGE_STATUS.PURGED }, { storeName: 's3', status: PURGE_STATUS.PURGED }],
      assetStores: ['postgres', 's3'],
    });
    expect(complete.ok).toBe(true);

    const missing = assertDsarDeleteComplete({
      receipts: [{ storeName: 'postgres', status: PURGE_STATUS.PURGED }],
      assetStores: ['postgres', 'redis'],
    });
    expect(missing.ok).toBe(false);
    expect(missing.missingStores).toContain('redis');
  });

  it('constants', () => {
    expect(DSAR_STATUS.FULFILLED).toBe('fulfilled');
  });
});

describe('data-governance — purge FSM + receipt', () => {
  it('scheduled → purged/failed; purged terminal', () => {
    expect(assertPurgeTransition({ from: 'scheduled', to: 'purged' }).ok).toBe(true);
    expect(assertPurgeTransition({ from: 'scheduled', to: 'failed' }).ok).toBe(true);
    expect(assertPurgeTransition({ from: 'purged', to: 'scheduled' }).ok).toBe(false);
    expect(assertPurgeTransition({ from: 'failed', to: 'scheduled' }).ok).toBe(true);
  });

  it('deletion receipt hash is deterministic', () => {
    const h1 = buildDeletionReceipt({ tenantId: 1, assetId: 5, storeName: 's3', purgedAt: '2026-07-01T00:00:00Z', backupExpiry: '2026-07-31T00:00:00Z' });
    const h2 = buildDeletionReceipt({ tenantId: 1, assetId: 5, storeName: 's3', purgedAt: '2026-07-01T00:00:00Z', backupExpiry: '2026-07-31T00:00:00Z' });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('backup expiry check', () => {
    expect(assertBackupExpired({ backupExpiry: null }).ok).toBe(true);
    expect(assertBackupExpired({ backupExpiry: new Date(Date.now() + 86400000) }).ok).toBe(false);
    expect(assertBackupExpired({ backupExpiry: new Date(Date.now() - 86400000) }).ok).toBe(true);
  });

  it('enum validation', () => {
    expect(assertValidEnum({ assetType: 'vector' }).ok).toBe(true);
    expect(assertValidEnum({ assetType: 'exe' }).ok).toBe(false);
    expect(assertValidEnum({ dsarType: 'export' }).ok).toBe(true);
    expect(assertValidEnum({ dsarType: 'share' }).ok).toBe(false);
    expect(assertValidEnum({ dataClass: 'D4' }).ok).toBe(true);
  });
});
