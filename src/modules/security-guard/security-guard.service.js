/**
 * Edikit — Security Guard Service (Prompt 70)
 *
 * Service half of the security-guard module:
 *   - Finding registry (in-memory, seeded from evidence) with owner / SLA /
 *     retest lifecycle and the security/data guard gate.
 *   - Threat model + ASVS + red-team evaluations wrapped with audit events
 *     and telemetry metrics (privileged actions, item 17).
 *   - Write-path guard helper for route integration.
 *
 * Graceful degradation: works fully without PostgreSQL (in-memory registry).
 * When the DB is available, findings are NOT persisted yet (registry seeded
 * programmatically) — the gate logic is what matters for CI.
 */import { getDb } from '../../infrastructure/postgres.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';
import {
  buildThreatModel,
  evaluateAsvsMatrix,
  validateFindingAcceptance,
  computeFindingSla,
  validateRetestEvidence,
  runRedTeamCorpus,
  FINDING_STATES,
} from './security-guard.schema.js';

// ── In-memory finding registry (module state; seedable for CI) ──
const findings = new Map();

function normalizeSeverity(s) {
  return ['info', 'low', 'medium', 'high', 'critical'].includes(s) ? s : 'medium';
}

/**
 * Seed the finding registry (idempotent — replaces the map wholesale).
 *
 * @param {Array<Object>} seed - [{ id, title, severity, threatId?, owner?,
 *   state?, createdAt?, rationale?, acceptedUntil?, retestDate?, verifiedBy?,
 *   testName?, evidenceNote? }]
 */
export function seedFindings(seed = []) {
  findings.clear();
  for (const f of seed) {
    if (!f || !f.id) continue;
    findings.set(f.id, {
      id: f.id,
      title: f.title || f.id,
      severity: normalizeSeverity(f.severity),
      threatId: f.threatId || null,
      owner: f.owner || null,
      state: FINDING_STATES.includes(f.state) ? f.state : 'open',
      createdAt: f.createdAt || Date.now(),
      rationale: f.rationale || null,
      acceptedUntil: f.acceptedUntil || null,
      retestDate: f.retestDate || null,
      verifiedBy: f.verifiedBy || null,
      testName: f.testName || null,
      evidenceNote: f.evidenceNote || null,
    });
  }
  return findings.size;
}

/** List all findings with computed SLA + acceptance validity. */
export function listFindings() {
  return [...findings.values()].map((f) => {
    const sla = computeFindingSla({ severity: f.severity, createdAt: f.createdAt, resolvedAt: f.state === 'remediated' ? f.retestDate : null });
    const acceptance = f.state === 'accepted'
      ? validateFindingAcceptance({ severity: f.severity, owner: f.owner, rationale: f.rationale, acceptedUntil: f.acceptedUntil })
      : null;
    const retest = f.state === 'remediated'
      ? validateRetestEvidence(f)
      : null;
    return { ...f, sla, acceptance, retest };
  });
}

/**
 * Accept a finding (security/data guard: critical/high CANNOT be accepted).
 *
 * @param {Object} params - { id, owner, rationale, acceptedUntil, actorId }
 * @returns {Promise<{ ok: boolean, reason?: string, finding?: Object }>}
 */
export async function acceptFinding({ id, owner = null, rationale = null, acceptedUntil = null, actorId = null } = {}) {
  const finding = findings.get(id);
  if (!finding) return { ok: false, reason: 'Finding not found' };

  const validation = validateFindingAcceptance({ severity: finding.severity, owner, rationale, acceptedUntil });
  if (!validation.ok) return { ok: false, reason: validation.reason };

  finding.state = 'accepted';
  finding.owner = owner;
  finding.rationale = rationale;
  finding.acceptedUntil = acceptedUntil;

  await audit({
    action: AUDIT_ACTIONS.SECURITY_FINDING_ACCEPT,
    userId: actorId || null,
    resourceType: 'security_finding',
    resourceId: id,
    details: { severity: finding.severity, owner, acceptedUntil },
  }).catch(() => null);

  recordMetric('edikit_security_findings_accepted_total', 1, { labels: { severity: finding.severity } });

  return { ok: true, finding };
}

/**
 * Mark a finding remediated with retest evidence.
 *
 * @param {Object} params - { id, retestDate, verifiedBy, testName, evidenceNote, actorId }
 * @returns {Promise<{ ok: boolean, reason?: string, finding?: Object }>}
 */
export async function remediateFinding({ id, retestDate = null, verifiedBy = null, testName = null, evidenceNote = null, actorId = null } = {}) {
  const finding = findings.get(id);
  if (!finding) return { ok: false, reason: 'Finding not found' };

  const validation = validateRetestEvidence({
    state: 'remediated', retestDate, verifiedBy, testName, evidenceNote,
  });
  if (!validation.ok) return { ok: false, reason: `Retest evidence incomplete: ${validation.missing.join(', ')}` };

  finding.state = 'remediated';
  finding.retestDate = retestDate;
  finding.verifiedBy = verifiedBy;
  finding.testName = testName;
  finding.evidenceNote = evidenceNote;

  await audit({
    action: AUDIT_ACTIONS.SECURITY_FINDING_REMEDIATE,
    userId: actorId || null,
    resourceType: 'security_finding',
    resourceId: id,
    details: { testName, verifiedBy },
  }).catch(() => null);

  recordMetric('edikit_security_findings_remediated_total', 1, { labels: { severity: finding.severity } });

  return { ok: true, finding };
}

/**
 * Full security posture report — threat model + ASVS + findings + red-team,
 * with the production gate decision.
 *
 * @param {Object} params
 * @param {Object<string, string[]>} [params.implementedControls] - boundary → controls
 * @param {Object<string, Object>} [params.asvsEvidence] - req → { status, owner, retestDate, note }
 * @param {Object<string, string[]>} [params.additionalDetections] - red-team external detections
 * @returns {Promise<Object>} posture report
 */
export async function getSecurityPosture({
  implementedControls = {},
  asvsEvidence = {},
  additionalDetections = {},
} = {}) {
  const threat = buildThreatModel({ implementedControls });
  const asvs = evaluateAsvsMatrix({ evidence: asvsEvidence });
  const redTeam = runRedTeamCorpus({ additionalDetections });
  const findingList = listFindings();

  const unresolvedHigh = findingList.filter(
    (f) => ['critical', 'high'].includes(f.severity) && f.state !== 'remediated',
  );
  const acceptedExpired = findingList.filter(
    (f) => f.state === 'accepted' && f.acceptance && !f.acceptance.ok,
  );

  const gate = {
    pass: threat.summary.acceptable && asvs.gate.pass && redTeam.gate.pass
      && unresolvedHigh.length === 0 && acceptedExpired.length === 0,
    blocks: [
      ...(threat.summary.acceptable ? [] : ['unresolved critical/high threat model entries']),
      ...(asvs.gate.pass ? [] : [`blocking ASVS L1 rows: ${asvs.gate.blocking.join(', ')}`]),
      ...(redTeam.gate.pass ? [] : ['red-team corpus has misses or false positives']),
      ...(unresolvedHigh.length ? ['open critical/high findings'] : []),
      ...(acceptedExpired.length ? ['expired accepted findings'] : []),
    ],
  };

  // Telemetry — release gate status (item 17: privileged metric)
  recordMetric('edikit_security_release_gate', gate.pass ? 1 : 0, {});

  return {
    threat,
    asvs,
    redTeam,
    findings: findingList,
    gate,
    meta: { dbAvailable: !!(await getDb()) },
  };
}
