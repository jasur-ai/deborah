/**
 * Deborah — Roster / Accommodation Simulator
 *
 * Pure simulation of how a roster of students would experience a summative
 * assessment under a given brief + policy pack + per-student accommodations.
 *
 * Simulates:
 *   - Base duration from brief (duration_minutes)
 *   - Extra time (+25/50/100%) from accommodation operational_config
 *   - Scheduled breaks (break_timer)
 *   - Camera exemption (camera_off) vs security profile allow_camera
 *   - Strike policy override (strike_policy_override)
 *   - Effective per-student start/end windows
 *   - Summary stats + blockers/warnings
 *
 * Purity: simulateStudent / simulateRoster / generateHumanReadableReport are
 * pure — no I/O, fully unit-testable. The persistence section at the bottom
 * (createSimulatorRun / listSimulatorRuns / getSimulatorRun) touches the DB
 * and degrades gracefully when PostgreSQL is not configured.
 */

import { validatePolicySchema, AI_USE_LEVEL_INFO } from './brief.schema.js';
import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ── Accommodation types the simulator understands ──
export const SIM_ACCOMMODATION_TYPES = [
  'extra_time', 'break_timer', 'camera_off', 'strike_policy_override',
  'separate_room', 'reader', 'scribe', 'font_contrast',
];

function applyExtraTime(baseMinutes, extraTimeConfig) {
  if (!extraTimeConfig) return baseMinutes;
  if (extraTimeConfig.extraPercent !== undefined) {
    return Math.round(baseMinutes * (1 + Number(extraTimeConfig.extraPercent) / 100));
  }
  if (extraTimeConfig.extraMinutes !== undefined) {
    return baseMinutes + Number(extraTimeConfig.extraMinutes);
  }
  return baseMinutes;
}

function applyBreaks(baseMinutes, breakConfig) {
  if (!breakConfig) return { duration: baseMinutes, breakCount: 0, breakMinutes: 0 };
  const breakDuration = Number(breakConfig.breakDuration ?? 0) || 0;
  const breakFrequency = Number(breakConfig.breakFrequency ?? 0) || 0;
  if (breakDuration <= 0 || breakFrequency <= 0 || baseMinutes <= 0) {
    return { duration: baseMinutes, breakCount: 0, breakMinutes: 0 };
  }
  const breakCount = Math.floor(baseMinutes / breakFrequency);
  const breakMinutes = breakCount * breakDuration;
  return { duration: baseMinutes + breakMinutes, breakCount, breakMinutes };
}

/**
 * Simulate one student under the brief + policy + accommodations.
 *
 * @param {Object} student - { external_id, name, group, accommodations: [{ type, operational_config }] }
 * @param {Object} brief - { content: { duration_minutes } }
 * @param {Object} policy - { policy: { security, late, resit } }
 * @returns {Object} Simulated per-student result
 */
export function simulateStudent(student = {}, brief = {}, policy = {}) {
  const baseMinutes = Number(brief?.content?.duration_minutes) || 60;
  const accommodations = Array.isArray(student.accommodations) ? student.accommodations : [];

  const extraTimeAcc = accommodations.find((a) => a?.type === 'extra_time');
  const breakAcc = accommodations.find((a) => a?.type === 'break_timer');
  const cameraOffAcc = accommodations.find((a) => a?.type === 'camera_off');
  const strikeOverrideAcc = accommodations.find((a) => a?.type === 'strike_policy_override');
  const separateRoomAcc = accommodations.find((a) => a?.type === 'separate_room');
  const readerAcc = accommodations.find((a) => a?.type === 'reader');
  const scribeAcc = accommodations.find((a) => a?.type === 'scribe');

  // Time arithmetic
  const timeWithExtra = applyExtraTime(baseMinutes, extraTimeAcc?.operational_config);
  const breaks = applyBreaks(timeWithExtra, breakAcc?.operational_config);

  // Security arithmetic
  const security = policy?.policy?.security || {};
  const baseMaxStrikes = Number(security.max_strikes ?? 3);
  const maxStrikes = Number(strikeOverrideAcc?.operational_config?.maxStrikes ?? baseMaxStrikes);
  const cameraRequired = security.allow_camera === false || security.profile === 'S3' || security.profile === 'S4';
  const cameraExempt = Boolean(cameraOffAcc);

  const warnings = [];
  if (cameraRequired && cameraExempt) {
    warnings.push('Camera is required by security profile but student has camera_off accommodation');
  }

  // Late/resit (informational for scheduling)
  const late = policy?.policy?.late || {};
  const resit = policy?.policy?.resit || {};

  return {
    student: student.external_id || 'unknown',
    name: student.name || null,
    group: student.group || null,
    baseMinutes,
    effectiveMinutes: breaks.duration,
    extraTimeMinutes: timeWithExtra - baseMinutes,
    breakCount: breaks.breakCount,
    breakMinutes: breaks.breakMinutes,
    maxStrikes,
    cameraExempt,
    cameraRequired,
    separateRoom: Boolean(separateRoomAcc),
    reader: Boolean(readerAcc),
    scribe: Boolean(scribeAcc),
    lateAllowed: late.allowed === true,
    resitAllowed: resit.allowed === true,
    warnings,
    accommodationTypes: accommodations.map((a) => a.type),
  };
}

/**
 * Run the full roster simulation.
 *
 * @param {Object} params
 * @param {Array} params.roster - Student list
 * @param {Object} params.brief - Brief row { content }
 * @param {Object} params.policy - Policy pack row { policy }
 * @returns {{ ok, perStudent: Array, summary: Object, blockers: Array, warnings: Array }}
 */
export function simulateRoster({ roster = [], brief = null, policy = null } = {}) {
  const blockers = [];
  const warnings = [];

  // Gate: brief + policy must exist for a meaningful summative simulation
  if (!brief) blockers.push('Brief is required for simulation');
  if (!policy) blockers.push('Policy pack is required for simulation');

  if (policy) {
    const schemaResult = validatePolicySchema(policy.policy || {});
    if (!schemaResult.ok) {
      blockers.push(`Policy schema invalid: ${schemaResult.errors.join('; ')}`);
    }
  }

  if (!Array.isArray(roster) || roster.length === 0) {
    blockers.push('Roster is empty — provide at least one student');
  }

  if (blockers.length > 0) {
    return { ok: false, perStudent: [], summary: null, blockers, warnings };
  }

  const perStudent = roster.map((student) => simulateStudent(student, brief, policy));

  // Summary
  const effectiveMinutesList = perStudent.map((s) => s.effectiveMinutes);
  const maxMinutes = effectiveMinutesList.length > 0
    ? Math.max(...effectiveMinutesList)
    : 0;
  const minMinutes = effectiveMinutesList.length > 0
    ? Math.min(...effectiveMinutesList)
    : 0;
  const totalBreakMinutes = perStudent.reduce((s, p) => s + p.breakMinutes, 0);
  const cameraExemptCount = perStudent.filter((s) => s.cameraExempt).length;
  const separateRoomCount = perStudent.filter((s) => s.separateRoom).length;
  const flaggedCount = perStudent.filter((s) => s.warnings.length > 0).length;

  // Collect warnings
  for (const s of perStudent) {
    for (const w of s.warnings) {
      warnings.push(`${s.student}: ${w}`);
    }
  }

  return {
    ok: true,
    perStudent,
    summary: {
      studentCount: perStudent.length,
      baseMinutes: brief?.content?.duration_minutes || 60,
      minEffectiveMinutes: minMinutes,
      maxEffectiveMinutes: maxMinutes,
      totalBreakMinutes,
      cameraExemptCount,
      separateRoomCount,
      flaggedCount,
      avgEffectiveMinutes: Math.round(
        effectiveMinutesList.reduce((s, v) => s + v, 0) / Math.max(perStudent.length, 1)
      ),
    },
    blockers,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SIMULATOR RUN PERSISTENCE (simulator_runs table)
// ═══════════════════════════════════════════════════════════════════

/**
 * Persist a completed simulation run to simulator_runs.
 */
export async function createSimulatorRun(data = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const result = await db.insertInto('simulator_runs')
    .values({
      tenant_id: getTenantId(),
      assessment_id: data.assessment_id || null,
      brief_version_id: data.brief_version_id || null,
      policy_version_id: data.policy_version_id || null,
      input_roster: data.input_roster || [],
      result: data.result || {},
      status: data.status || 'completed',
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: AUDIT_ACTIONS.SIMULATOR_RUN,
      userId: data.created_by,
      resourceType: 'simulator_run',
      resourceId: result.id,
      details: {
        studentCount: (data.result?.summary?.studentCount) || (data.input_roster?.length) || 0,
      },
    });
  }
  return result ? { id: result.id } : null;
}

/** List persisted simulation runs (most recent first). */
export async function listSimulatorRuns({ assessment_id, limit = 20, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('simulator_runs')
      .where('tenant_id', '=', getTenantId());
    if (assessment_id) query = query.where('assessment_id', '=', assessment_id);
    return await query
      .orderBy('created_at', 'desc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/** Get a single persisted simulator run. */
export async function getSimulatorRun(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('simulator_runs')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// PUBLISH BLOCKER REPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a human-readable publish-blocker report combining brief/policy
 * approval state and simulation blockers.
 *
 * @returns {string} Plain-text human-readable report
 */
export function generateHumanReadableReport({
  brief = null,
  policy = null,
  simulation = null,
} = {}) {
  const lines = [];
  lines.push('═══════════════════════════════════════════════');
  lines.push('  DEBORAH — PUBLISH READINESS REPORT');
  lines.push('═══════════════════════════════════════════════');
  lines.push('');

  // Brief
  lines.push('1. ASSESSMENT BRIEF');
  if (!brief) {
    lines.push('   ✗ MISSING — brief yaratilmagan');
  } else {
    lines.push(`   • Title: ${brief.title || '(no title)'}`);
    lines.push(`   • Status: ${brief.status.toUpperCase()} (v${brief.version || 1})`);
    const level = brief.ai_use_level || 'A0';
    const levelLabel = AI_USE_LEVEL_INFO[level]?.label || '';
    lines.push(`   • AI-use level: ${level}${levelLabel ? ` (${levelLabel})` : ''}`);
    if (brief.status === 'approved') lines.push('   ✓ Approved');
    else lines.push('   ✗ NOT approved — summative publish BLOCKED');
  }
  lines.push('');

  // Policy
  lines.push('2. POLICY PACK');
  if (!policy) {
    lines.push('   ✗ MISSING — policy pack yaratilmagan');
  } else {
    lines.push(`   • Name: ${policy.name || '(no name)'}`);
    lines.push(`   • Status: ${policy.status.toUpperCase()} (v${policy.version || 1})`);
    if (policy.status === 'approved') lines.push('   ✓ Approved');
    else lines.push('   ✗ NOT approved — summative publish BLOCKED');
  }
  lines.push('');

  // Simulation
  lines.push('3. SIMULATION');
  if (simulation) {
    if (simulation.ok && simulation.summary) {
      const s = simulation.summary;
      lines.push(`   • Students: ${s.studentCount}`);
      lines.push(`   • Base duration: ${s.baseMinutes} min`);
      lines.push(`   • Effective window: ${s.minEffectiveMinutes}–${s.maxEffectiveMinutes} min`);
      lines.push(`   • Camera exemptions: ${s.cameraExemptCount}/${s.studentCount}`);
      lines.push(`   • Separate room: ${s.separateRoomCount}`);
      lines.push(`   • Flagged (warnings): ${s.flaggedCount}`);
    } else {
      lines.push('   ✗ Simulation failed:');
      for (const b of simulation.blockers || []) lines.push(`     - ${b}`);
    }
  } else {
    lines.push('   • Not run');
  }
  lines.push('');

  // Verdict
  const briefOk = brief && brief.status === 'approved';
  const policyOk = policy && policy.status === 'approved';
  const simOk = !simulation || simulation.ok;
  lines.push('═══════════════════════════════════════════════');
  if (briefOk && policyOk && simOk) {
    lines.push('  RESULT: ✅ READY TO PUBLISH');
  } else {
    lines.push('  RESULT: ❌ BLOCKED');
    if (!briefOk) lines.push('    - Brief must be approved');
    if (!policyOk) lines.push('    - Policy pack must be approved');
    if (!simOk) lines.push('    - Simulation has blockers');
  }
  lines.push('═══════════════════════════════════════════════');

  return lines.join('\n');
}
