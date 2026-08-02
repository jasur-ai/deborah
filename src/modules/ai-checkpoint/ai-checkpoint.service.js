/**
 * Edikit — AI/Content Checkpoint (service)
 *
 * Prompt 60 — measured pilot'ni ishga tushirish: barcha pilot'lar
 * (red-team, shadow benchmark, question review, citation, intervention,
 * deck comparison, outage drill) bitta run'da yig'iladi, natija
 * ai_checkpoint_runs'ga yoziladi (idempotent request_hash) va
 * audit qilinadi (privileged action → metric/trace).
 *
 * SECURITY / DATA GUARD (Prompt 60 §15-17):
 *   - Har write path tenant-scoped + idempotent.
 *   - Summative AI authority / unverified source guard'lar pilot
 *     natijasida ko'rinadi (publish bloklangan).
 *   - Checkpoint run — privileged action → audit event.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  buildCheckpointHash,
  assertNoSummativeAuthority,
  assertVerifiedSourceOnly,
  runRedTeamSourceCheck,
  runShadowBenchmark,
  runQuestionReviewSample,
  runCitationUrlCheck,
  runInterventionPilot,
  runDeckComparison,
  runOutageDrill,
  computePhaseGReadiness,
  CHECKPOINT_SCOPE,
  PILOT_VERSION,
} from './ai-checkpoint.schema.js';

export const CHECKPOINT_META = {
  version: PILOT_VERSION,
  scopes: Object.values(CHECKPOINT_SCOPE),
  pilots: ['red_team', 'shadow_benchmark', 'question_review', 'citation_check', 'intervention_pilot', 'deck_comparison', 'outage_drill'],
};

/** jsonb maydonlarni real PG (object) va fake DB (string) ikkalasida ham object qilib qaytaradi. */
function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function mapRunRow(row) {
  if (!row) return null;
  return {
    ...row,
    summary: parseJson(row.summary) || {},
    pilots: parseJson(row.pilots) || [],
    residual_risks: parseJson(row.residual_risks) || [],
  };
}

// ═══════════════════════════════════════════════════════════════════
// RUN — §18/19/20
// ═══════════════════════════════════════════════════════════════════

/**
 * Run a measured AI checkpoint (idempotent).
 * @param {Object} params - { scope, data, actorId }
 *   data: { redTeamScenarios, aiScores, goldScores, confidences, candidates,
 *     citationRecords, intervention, deckNative, deckProvider, outage, guards }
 */
export async function runAiCheckpoint({
  scope = CHECKPOINT_SCOPE.FULL,
  data = {},
  actorId = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const hash = buildCheckpointHash({ tenantId, scope, pilotVersion: PILOT_VERSION, data });

  // Idempotency — existing run qaytariladi
  const existing = await db
    .selectFrom('ai_checkpoint_runs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('request_hash', '=', hash)
    .executeTakeFirst();
  if (existing) {
    const r = mapRunRow(existing);
    return {
      ok: true,
      runId: r.id,
      cached: true,
      ready: r.phase_g_ready,
      summary: r.summary,
      pilots: r.pilots,
      residualRisks: r.residual_risks,
      guards: {
        summativeAuthority: 'teacher approval required for final scores',
        verifiedSource: 'unapproved/unverified sources cannot publish',
      },
    };
  }

  // ── Run pilots (scope-driven) ──
  const pilots = [];

  // Guards first (§15)
  const gSummative = assertNoSummativeAuthority({
    isFinal: data.guards?.isFinal ?? false,
    hasTeacherApproval: data.guards?.hasTeacherApproval ?? false,
    role: data.guards?.role || 'ai',
  });
  const gSource = assertVerifiedSourceOnly({
    sourceStatus: data.guards?.sourceStatus || 'draft',
    citationVerified: data.guards?.citationVerified ?? false,
    publish: data.guards?.publish ?? false,
  });
  pilots.push({
    pilot: 'guards',
    ok: gSummative.ok && gSource.ok,
    checks: [
      { id: 'summative_authority', ok: gSummative.ok, detail: gSummative.ok ? 'teacher approval path' : gSummative.reason },
      { id: 'verified_source', ok: gSource.ok, detail: gSource.ok ? 'source verified' : gSource.reason },
    ],
    summary: { total: 2, passed: (gSummative.ok ? 1 : 0) + (gSource.ok ? 1 : 0), failed: (gSummative.ok ? 0 : 1) + (gSource.ok ? 0 : 1) },
  });

  if ([CHECKPOINT_SCOPE.FULL, CHECKPOINT_SCOPE.SOURCE].includes(scope)) {
    pilots.push(runRedTeamSourceCheck({ scenarios: data.redTeamScenarios || [] }));
  }
  if ([CHECKPOINT_SCOPE.FULL, CHECKPOINT_SCOPE.GRADING].includes(scope)) {
    pilots.push(runShadowBenchmark({ aiScores: data.aiScores || [], goldScores: data.goldScores || [], confidences: data.confidences || [] }));
  }
  if ([CHECKPOINT_SCOPE.FULL, CHECKPOINT_SCOPE.QUESTIONS].includes(scope)) {
    pilots.push(runQuestionReviewSample({ candidates: data.candidates || [], language: data.language || 'uz' }));
  }
  if ([CHECKPOINT_SCOPE.FULL, CHECKPOINT_SCOPE.RESOURCES].includes(scope)) {
    pilots.push(runCitationUrlCheck({ records: data.citationRecords || [] }));
  }
  if ([CHECKPOINT_SCOPE.FULL, CHECKPOINT_SCOPE.PRESENTATIONS].includes(scope)) {
    pilots.push(runInterventionPilot({ ...data.intervention }));
    pilots.push(runDeckComparison({ native: data.deckNative || null, provider: data.deckProvider || null }));
  }
  if ([CHECKPOINT_SCOPE.FULL, CHECKPOINT_SCOPE.PROVIDER].includes(scope)) {
    pilots.push(runOutageDrill({ ...data.outage }));
  }

  // ── Phase G readiness + residual risks (§14) ──
  const readiness = computePhaseGReadiness({ pilots });

  // ── Persist run ──
  const row = await db
    .insertInto('ai_checkpoint_runs')
    .values({
      tenant_id: tenantId,
      request_hash: hash,
      scope,
      status: 'done',
      summary: JSON.stringify(readiness.summary),
      pilots: JSON.stringify(pilots),
      residual_risks: JSON.stringify(readiness.residualRisks),
      phase_g_ready: readiness.ready,
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  // ── Audit (privileged action → trace) ──
  await audit({
    action: AUDIT_ACTIONS.AI_CHECKPOINT_RUN,
    userId: actorId,
    tenantId,
    resourceType: 'ai_checkpoint',
    resourceId: String(row.id),
    details: { runId: row.id, scope, pilots: pilots.length, passed: readiness.summary.passed, failed: readiness.summary.failed, phaseGReady: readiness.ready },
  });

  return {
    ok: true,
    runId: row.id,
    cached: false,
    ready: readiness.ready,
    summary: readiness.summary,
    pilots,
    residualRisks: readiness.residualRisks,
    guards: readiness.guards,
  };
}

// ═══════════════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════════════

/** List checkpoint runs (tenant-scoped). */
export async function listCheckpointRuns({ scope = null, limit = 50 } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db.selectFrom('ai_checkpoint_runs').selectAll().where('tenant_id', '=', tenantId);
  if (scope) q = q.where('scope', '=', scope);
  const rows = await q.orderBy('created_at', 'desc').limit(limit).execute();
  return rows.map(mapRunRow);
}

/** Get a checkpoint run (tenant-scoped). */
export async function getCheckpointRun(id) {
  const db = getDb();
  if (!db) return null;
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return null;
  return db
    .selectFrom('ai_checkpoint_runs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst()
    .then(mapRunRow);
}
