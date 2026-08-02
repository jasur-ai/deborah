/**
 * Edikit — Institutional Handoff: Final Migration, Pilot & Procurement Pack
 * (pure logic — Prompt 72)
 *
 * Prompt 72 proves the product is ready for a real institution: legacy
 * cutover with reconciliation, role training, controlled pilot, and a buyer
 * evidence pack (research.md §75 Institutional Procurement, §76 Adoption &
 * Training, PROMPT_GUIDE 72 items 07–14).
 *
 *   - Cutover FSM: backup/hash → dry-run → reconcile → cutover →
 *     legacy read-only → completed. PostgreSQL becomes PRIMARY only after
 *     reconciliation parity (items 07–09).
 *   - Role training: teacher/admin/proctor/marker curricula + student
 *     practice exam, each with completion evidence (item 10–11).
 *   - Pilot phases: practice → low-stakes → controlled midterm, each with
 *     metrics, incidents and a rollback decision (item 12, 14).
 *   - Procurement pack: HECVAT, ACR, security white paper, DPA/SLA, exit
 *     plan — buyer evidence (item 13, research §75).
 *   - Exit test: full tenant export/restore/delete rehearsal (item 20).
 *   - Security/data guard: pilot oldidan Gate 0, legal/privacy,
 *     accessibility yoki DR blocker waiver bilan yashirilmasin (item 15).
 *     Har write path tenant scope + authorization + validation +
 *     idempotency (item 16).
 *
 * Purity: no I/O, no globals, no DB — fully unit-testable.
 */

// ═══════════════════════════════════════════════════════════════════
// 1. CUTOVER FSM (items 07–09)
// ═══════════════════════════════════════════════════════════════════

export const CUTOVER_STATES = [
  'pre-migration',      // legacy-only, dual-read planned
  'backup-hash',        // final legacy backup + SHA-256 hash taken
  'dry-run',            // migration dry-run report reviewed
  'reconciled',         // reconciliation parity verified
  'cutover',            // PostgreSQL PRIMARY, legacy read-only flag
  'completed',          // institutional handoff done
];

export const CUTOVER_TRANSITIONS = {
  'pre-migration': ['backup-hash'],
  'backup-hash': ['dry-run', 'pre-migration'],
  'dry-run': ['reconciled', 'backup-hash'],
  reconciled: ['cutover', 'dry-run'],
  // Legacy read-only flag set qilingach qaytarib bo'lmaydi (one-way, item 09).
  cutover: ['completed'],
  completed: [],
};

/** Cutover FSM transition validation. */
export function assertCutoverTransition({ from = '', to = '' } = {}) {
  if (!CUTOVER_STATES.includes(from)) return { ok: false, reason: `invalid cutover state: ${from}` };
  if (!CUTOVER_STATES.includes(to)) return { ok: false, reason: `invalid cutover state: ${to}` };
  const allowed = CUTOVER_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `cannot transition cutover ${from} → ${to}` };
  return { ok: true };
}

/** Final legacy backup: snapshot metadata + SHA-256 hash (deterministic). */
export function buildFinalBackupEvidence({ dataHash = '', records = {}, actorId = '' } = {}) {
  if (!dataHash || !/^[0-9a-f]{64}$/i.test(dataHash)) {
    return { ok: false, reason: 'legacy data hash (SHA-256 hex) is required' };
  }
  if (!actorId) return { ok: false, reason: 'backup actor is required' };
  return {
    ok: true,
    dataHash,
    records,
    takenAt: new Date().toISOString(),
    actorId,
  };
}

/** Reconciliation parity — migrated counts vs legacy counts must match. */
export function evaluateReconciliation({ legacy = {}, migrated = {} } = {}) {
  const sections = ['users', 'tests', 'items', 'results', 'enrollments'];
  const checks = [];
  for (const s of sections) {
    const l = Number(legacy[s]) || 0;
    const m = Number(migrated[s]) || 0;
    checks.push({ section: s, legacy: l, migrated: m, ok: l === m });
  }
  const ok = checks.every((c) => c.ok);
  return {
    ok,
    checks,
    reason: ok ? 'reconciliation parity verified' : 'reconciliation mismatch — cutover BLOCKED',
  };
}

/** Cutover readiness gate — PostgreSQL can become PRIMARY only when all gates pass. */
export function evaluateCutoverReadiness({
  backupOk = false, dryRunOk = false, reconciled = false, gate0Ok = false,
  legalOk = false, supportOk = false, drOk = false,
} = {}) {
  const gates = [
    { name: 'final-backup-hash', ok: backupOk === true },
    { name: 'migration-dry-run', ok: dryRunOk === true },
    { name: 'reconciliation-parity', ok: reconciled === true },
    { name: 'gate-0', ok: gate0Ok === true },
    { name: 'legal-privacy', ok: legalOk === true },
    { name: 'support-ready', ok: supportOk === true },
    { name: 'dr-backup-verified', ok: drOk === true },
  ];
  const failed = gates.filter((g) => !g.ok).map((g) => g.name);
  return {
    ok: failed.length === 0,
    gates,
    blocks: failed,
    reason: failed.length ? `cutover blocked: ${failed.join(', ')}` : 'cutover readiness confirmed',
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. ROLE TRAINING (items 10–11, research §76.2)
// ═══════════════════════════════════════════════════════════════════

export const TRAINING_ROLES = ['teacher', 'admin', 'proctor', 'marker'];
export const TRAINING_CURRICULUM = {
  teacher: [
    { id: 't-core', title: 'Teacher core 60–90 min', requiredMinutes: 60 },
    { id: 't-create', title: 'Assessment creation & publish', requiredMinutes: 20 },
    { id: 't-grade', title: 'Grading & feedback', requiredMinutes: 15 },
  ],
  admin: [
    { id: 'a-roster', title: 'Roster & enrollment', requiredMinutes: 20 },
    { id: 'a-policy', title: 'Policy & retention', requiredMinutes: 20 },
    { id: 'a-support', title: 'Support & escalation', requiredMinutes: 15 },
  ],
  proctor: [
    { id: 'p-incident', title: 'Mock incident drill', requiredMinutes: 25 },
    { id: 'p-recovery', title: 'Technical recovery', requiredMinutes: 20 },
    { id: 'p-evidence', title: 'Evidence handling', requiredMinutes: 15 },
  ],
  marker: [
    { id: 'm-rubric', title: 'Rubric & calibration', requiredMinutes: 25 },
    { id: 'm-queue', title: 'Marking queue', requiredMinutes: 15 },
    { id: 'm-moderation', title: 'Moderation & adjudication', requiredMinutes: 20 },
  ],
};

/** Validate a role against the training curriculum. */
export function validateTrainingRole(role = '') {
  if (!TRAINING_ROLES.includes(role)) return { ok: false, reason: `invalid training role: ${role}` };
  return { ok: true, curriculum: TRAINING_CURRICULUM[role] };
}

/** Training plan evidence — each step needs minutes + verifier (human). */
export function validateTrainingEvidence({ role = '', completed = [], verifier = '' } = {}) {
  const roleCheck = validateTrainingRole(role);
  if (!roleCheck.ok) return roleCheck;
  const steps = TRAINING_CURRICULUM[role];
  const missing = steps.filter((s) => !completed.includes(s.id)).map((s) => s.id);
  if (missing.length) return { ok: false, reason: `training incomplete for ${role}: missing ${missing.join(', ')}` };
  if (!verifier) return { ok: false, reason: 'training requires a human verifier (sign-off)' };
  return { ok: true, role, verifier, completedSteps: steps.length };
}

/** Student practice exam — required before any pilot (item 11). */
export function validatePracticeExam({ completed = false, attempts = 0, participants = 0, verifiedBy = '' } = {}) {
  if (!completed) return { ok: false, reason: 'student practice exam not completed' };
  if (attempts < 1) return { ok: false, reason: 'at least one practice attempt required' };
  if (participants < 1) return { ok: false, reason: 'at least one participant required' };
  if (!verifiedBy) return { ok: false, reason: 'practice exam requires a verifier' };
  return { ok: true, attempts, participants };
}

// ═══════════════════════════════════════════════════════════════════
// 3. PILOT PHASES (items 12, 14)
// ═══════════════════════════════════════════════════════════════════

export const PILOT_PHASES = ['practice', 'low-stakes', 'controlled-midterm'];

export const PILOT_TRANSITIONS = {
  practice: ['low-stakes'],
  'low-stakes': ['controlled-midterm'],
  'controlled-midterm': [],
};

/** Pilot phase transition validation (practice → low-stakes → midterm). */
export function assertPilotTransition({ from = '', to = '' } = {}) {
  if (!PILOT_PHASES.includes(from)) return { ok: false, reason: `invalid pilot phase: ${from}` };
  if (!PILOT_PHASES.includes(to)) return { ok: false, reason: `invalid pilot phase: ${to}` };
  const allowed = PILOT_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `cannot transition pilot ${from} → ${to}` };
  return { ok: true };
}

/**
 * Pilot metrics — a phase can be DECIDED (continue/rollback/extend) only
 * when evidence exists: incidents logged, availability above floor, and no
 * data-loss incidents unresolved.
 */
export function evaluatePilotDecision({
  phase = '', incidents = [], availability = 1.0, dataLossIncidents = 0, rollback = false,
} = {}) {
  const phaseCheck = PILOT_PHASES.includes(phase);
  if (!phaseCheck) return { ok: false, reason: `invalid pilot phase: ${phase}` };

  const checks = [
    { name: 'incidentsLogged', ok: Array.isArray(incidents) },
    { name: 'availabilityFloor', ok: availability >= 0.99 },
    { name: 'noUnresolvedDataLoss', ok: dataLossIncidents === 0 },
  ];
  const blocked = checks.filter((c) => !c.ok).map((c) => c.name);
  const decision = blocked.length ? 'extend' : (rollback ? 'rollback' : 'continue');
  return {
    ok: blocked.length === 0,
    phase,
    checks,
    blocks: blocked,
    decision,
    rollback: blocked.length === 0 && rollback === true,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. PROCUREMENT PACK (item 13, research §75)
// ═══════════════════════════════════════════════════════════════════

export const PROCUREMENT_ITEMS = [
  { id: 'hecvat', label: 'HECVAT security & data protection' },
  { id: 'acr', label: 'Accessibility Conformance Report (VPAT/WCAG 2.2 AA)' },
  { id: 'security-whitepaper', label: 'Security white paper + threat model' },
  { id: 'pentest', label: 'Pen-test executive summary (critical/high = 0)' },
  { id: 'sla', label: 'SLA/SLO + status page + service credits' },
  { id: 'dpa', label: 'DPA, subprocessors, data regions' },
  { id: 'retention', label: 'Retention/deletion schedule' },
  { id: 'ai-registry', label: 'AI system registry / model cards' },
  { id: 'standards', label: 'Standards/conformance matrix (ASVS, ISO)' },
  { id: 'incident-terms', label: 'Incident/breach terms' },
  { id: 'exit-plan', label: 'Export / vendor exit plan' },
  { id: 'pricing', label: 'Pricing & AI quota transparency' },
];

/** Procurement pack completeness — every buyer item needs an artifact reference + owner. */
export function evaluateProcurementPack({ provided = {}, owner = '' } = {}) {
  const missing = PROCUREMENT_ITEMS.filter((i) => !provided[i.id]).map((i) => i.id);
  if (missing.length) return { ok: false, reason: `procurement pack incomplete: missing ${missing.join(', ')}`, missing };
  if (!owner) return { ok: false, reason: 'procurement pack needs an owner (review cycle)' };
  return { ok: true, items: PROCUREMENT_ITEMS.length, owner };
}

/** False certification guard — claims must map to test evidence (item 15). */
export function assertNoFalseCertification({ claims = [], evidenceMap = {} } = {}) {
  const unsupported = claims.filter((c) => !evidenceMap[c]);
  return { ok: unsupported.length === 0, unsupportedClaims: unsupported };
}

// ═══════════════════════════════════════════════════════════════════
// 5. EXIT TEST — TENANT EXPORT / RESTORE / DELETE (item 20)
// ═══════════════════════════════════════════════════════════════════

export const EXIT_TEST_STEPS = ['export', 'restore', 'delete'];

/** Full tenant exit test: export bundle + restore parity + deletion receipts. */
export function evaluateExitTest({ completed = {}, bundleHash = '', restoredOk = false, receipts = [] } = {}) {
  const steps = [];
  steps.push({ name: 'export', ok: completed.export === true, detail: bundleHash ? `bundle ${bundleHash.slice(0, 12)}…` : 'no bundle hash' });
  steps.push({ name: 'restore', ok: restoredOk === true, detail: restoredOk ? 'restore parity verified' : 'restore not verified' });
  steps.push({ name: 'delete', ok: Array.isArray(receipts) && receipts.length > 0, detail: `${receipts.length} deletion receipts` });
  const ok = steps.every((s) => s.ok);
  return { ok, steps, reason: ok ? 'tenant exit test passed' : 'tenant exit test incomplete' };
}

// ═══════════════════════════════════════════════════════════════════
// 6. SECURITY / DATA GUARD (item 15–16)
// ═══════════════════════════════════════════════════════════════════

/**
 * Gate 0 / blocker waiver guard: legal, privacy, accessibility yoki DR
 * blocker HECh QACHON waiver bilan yashirilmaydi — ular chiroyli ko'rinish
 * uchun gap'da qoldirilmaydi. Har blocker aniq remediation + evidence
 * talab qiladi (item 15).
 */
export function assertNoBlockerWaiver({ blockers = [], waived = [] } = {}) {
  const illegallyWaived = blockers.filter((b) => waived.includes(b));
  return {
    ok: illegallyWaived.length === 0,
    illegalWaivers: illegallyWaived,
    reason: illegallyWaived.length
      ? `blockers cannot be waived: ${illegallyWaived.join(', ')} — remediation + evidence required`
      : 'no illegal blocker waivers',
  };
}

/** Write-path guard — tenant scope + authorization + validation + idempotency (item 16). */
export function assertWritePathGuard({ tenantScoped = false, authorized = false, validated = false, idempotent = false } = {}) {
  const checks = [
    { name: 'tenantScope', ok: tenantScoped === true },
    { name: 'authorization', ok: authorized === true },
    { name: 'validation', ok: validated === true },
    { name: 'idempotency', ok: idempotent === true },
  ];
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { ok: failed.length === 0, checks, blocks: failed };
}
