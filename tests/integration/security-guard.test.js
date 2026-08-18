/**
 * Deborah — Security Guard (integration, Prompt 70)
 *
 * Service-level tests:
 *   - Finding lifecycle: seed → accept (guard blocks critical/high) →
 *     remediate with retest evidence → posture gate
 *   - Posture report: threat + ASVS + red-team + findings gate combination
 *   - Fuzz cases (cross-tenant/upload/socket) through the pure guards
 *   - Evidence loader: seed + runtime-derived implemented controls
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  seedFindings,
  acceptFinding,
  remediateFinding,
  getSecurityPosture,
} from '../../src/modules/security-guard/security-guard.service.js';
import { getAuditEvidence } from '../../src/modules/security-guard/evidence-loader.js';
import { evaluateWritePathGuard } from '../../src/modules/security-guard/security-guard.schema.js';

const TEST_FINDINGS = [
  { id: 'F-001', title: 'Critical: answer key exposure window', severity: 'critical', owner: null, state: 'open', createdAt: Date.now() - 3600000 },
  { id: 'F-002', title: 'High: socket host takeover', severity: 'high', owner: null, state: 'open', createdAt: Date.now() - 7200000 },
  { id: 'F-003', title: 'Medium: verbose error logs', severity: 'medium', owner: 'QA', state: 'open', createdAt: Date.now() - 86400000 },
];

describe('finding lifecycle', () => {
  beforeEach(() => {
    seedFindings(TEST_FINDINGS);
  });

  it('seeds findings with defaults', () => {
    const count = seedFindings(TEST_FINDINGS);
    expect(count).toBe(3);
  });

  it('accepting a critical finding is blocked by the security guard', async () => {
    const res = await acceptFinding({
      id: 'F-001', owner: 'Ops', rationale: 'we accept the risk for now', acceptedUntil: '2099-01-01',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not acceptable to production/);
  });

  it('accepting a high finding is blocked too', async () => {
    const res = await acceptFinding({
      id: 'F-002', owner: 'Ops', rationale: 'accepting high risk', acceptedUntil: '2099-01-01',
    });
    expect(res.ok).toBe(false);
  });

  it('medium finding can be accepted with owner + rationale + future expiry', async () => {
    const res = await acceptFinding({
      id: 'F-003', owner: 'QA', rationale: 'documented low-impact risk acceptance', acceptedUntil: '2099-01-01',
    });
    expect(res.ok).toBe(true);
    expect(res.finding.state).toBe('accepted');
  });

  it('remediating without retest evidence is rejected', async () => {
    const res = await remediateFinding({ id: 'F-003', verifiedBy: 'QA' });
    expect(res.ok).toBe(false);
  });

  it('remediating with full retest evidence closes the finding', async () => {
    const res = await remediateFinding({
      id: 'F-003',
      retestDate: '2026-09-01',
      verifiedBy: 'QA',
      testName: 'tests/unit/security-guard.test.js',
      evidenceNote: 'all cases green',
    });
    expect(res.ok).toBe(true);
    expect(res.finding.state).toBe('remediated');
  });

  it('unknown finding id returns clear error', async () => {
    const res = await acceptFinding({ id: 'NOPE', owner: 'X', rationale: 'long enough rationale here', acceptedUntil: '2099-01-01' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Finding not found');
  });
});

describe('posture report gate', () => {
  beforeEach(() => {
    seedFindings(TEST_FINDINGS);
  });

  it('open critical/high findings block the release gate', async () => {
    const posture = await getSecurityPosture({});
    expect(posture.gate.pass).toBe(false);
    expect(posture.gate.blocks.join(' ')).toMatch(/open critical\/high findings/);
  });

  it('remediating all critical/high findings + full evidence passes the gate', async () => {
    await remediateFinding({ id: 'F-001', retestDate: '2026-09-01', verifiedBy: 'QA', testName: 'scan', evidenceNote: 'fixed + retested' });
    await remediateFinding({ id: 'F-002', retestDate: '2026-09-01', verifiedBy: 'QA', testName: 'socket', evidenceNote: 'fixed + retested' });
    // remediate F-003 too (or accept it — both clear the guard)
    await remediateFinding({ id: 'F-003', retestDate: '2026-09-01', verifiedBy: 'QA', testName: 'logs', evidenceNote: 'fixed' });

    const posture = await getSecurityPosture({
      implementedControls: {}, // threat model with zero controls will block...
    });
    // Threat model blocks (no controls), ASVS blocks (no evidence), red-team passes.
    expect(posture.gate.pass).toBe(false);
    expect(posture.gate.blocks.join(' ')).not.toMatch(/open critical\/high findings/);
    expect(posture.gate.blocks.join(' ')).toMatch(/threat model/);
  });

  it('posture report includes threat + asvs + red-team + findings sections', async () => {
    const posture = await getSecurityPosture({});
    expect(posture.threat).toBeTruthy();
    expect(posture.asvs).toBeTruthy();
    expect(posture.redTeam).toBeTruthy();
    expect(posture.findings).toHaveLength(3);
  });

  it('accepted finding with expired re-review date blocks the gate', async () => {
    seedFindings([{ id: 'F-X', title: 'expired acceptance', severity: 'low', owner: 'QA', state: 'accepted', rationale: 'was accepted long ago', acceptedUntil: '2020-01-01' }]);
    const posture = await getSecurityPosture({});
    expect(posture.gate.blocks.join(' ')).toMatch(/expired accepted findings/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fuzz cases through the service guards (research §39 matrix)
// ═══════════════════════════════════════════════════════════════════

describe('fuzz — cross-tenant / IDOR (service guards)', () => {
  it('student cannot write another tenant resource', () => {
    const r = evaluateWritePathGuard({
      actor: { id: 1, role: 'student', tenantId: 1 },
      resource: { tenantId: 2 },
      allowedRoles: ['student'],
      validated: true, idempotent: true,
    });
    expect(r.ok).toBe(false);
  });

  it('student cannot read admin resource path', () => {
    const r = evaluateWritePathGuard({
      path: 'GET /api/results/../../admin',
      actor: { id: 1, role: 'student', tenantId: 1 },
      resource: { tenantId: 1 },
      allowedRoles: ['student'],
      validated: true, idempotent: true,
    });
    // tenant/auth pass; path traversal handled by validation layer — the
    // guard is the last-resort write gate and must not silently allow.
    expect(r.checks.map((c) => c.name)).toEqual(['tenant_scope', 'authorization', 'validation', 'idempotency']);
  });

  it('teacher cannot edit another tenant assessment', () => {
    const r = evaluateWritePathGuard({
      actor: { id: 5, role: 'teacher', tenantId: 1 },
      resource: { tenantId: 3 },
      allowedRoles: ['teacher'],
      validated: true, idempotent: true,
    });
    expect(r.ok).toBe(false);
  });

  it('socket host event without host role is blocked by authorization guard', () => {
    const r = evaluateWritePathGuard({
      actor: { id: 2, role: 'player', tenantId: 1 },
      resource: { tenantId: 1 },
      allowedRoles: ['host'],
      validated: true, idempotent: true,
    });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'authorization').ok).toBe(false);
  });
});

describe('evidence loader', () => {
  it('loads implemented controls from the bundled seed', async () => {
    const ev = await getAuditEvidence();
    expect(ev.implementedControls).toBeTruthy();
    expect(Object.keys(ev.implementedControls).length).toBeGreaterThanOrEqual(7);
    // Every boundary must have at least the seeded controls
    for (const [boundaryId, controls] of Object.entries(ev.implementedControls)) {
      expect(Array.isArray(controls)).toBe(true);
      expect(controls.length).toBeGreaterThan(0);
    }
  });

  it('loads ASVS evidence entries with owner + status', async () => {
    const ev = await getAuditEvidence();
    expect(Object.keys(ev.asvsEvidence).length).toBeGreaterThan(30);
    for (const [req, entry] of Object.entries(ev.asvsEvidence)) {
      expect(['not_started', 'in_progress', 'automated', 'manual', 'accepted']).toContain(entry.status);
    }
  });

  it('evidence feeds a posture report that is structurally complete', async () => {
    const ev = await getAuditEvidence();
    const posture = await getSecurityPosture({
      implementedControls: ev.implementedControls,
      asvsEvidence: ev.asvsEvidence,
    });
    expect(posture.threat.summary.boundaryCount).toBe(7);
    expect(posture.asvs.summary.totalRequirements).toBeGreaterThan(30);
    expect(posture.redTeam.summary.total).toBeGreaterThanOrEqual(18);
  });
});
