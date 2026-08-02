/**
 * Edikit — WCAG 2.2 AA & Artifact Accessibility (service)
 *
 * Prompt 64 — teacher/student/admin/proctor critical journeys va generated
 * artifactlarni accessible qilish (research.md §26.1, §29 accommodation).
 *
 * SECURITY / DATA GUARD (Prompt 64 §15-17):
 *   - Automated checker YETARLI emas — gap close va artifact approve
 *     inson verification (ACR sign-off) talab qiladi.
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited.
 *   - Privileged actionlar (audit run, gap verified, artifact checked)
 *     audit event va trace bilan.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  runAxeChecks,
  buildAcrEvidence,
  assertAutomatedCheckIsNotFinal,
  assertGapTransition,
  assertValidEnum,
  assertArtifactReadingOrder,
  assertArtifactAltText,
  assertTaggedPdf,
  artifactContrastIssues,
  classifyGap,
  GAP_STATUS,
  GAP_SEVERITY,
  A11Y_SETTING_DEFAULTS,
  WCAG_TARGET,
} from './accessibility.schema.js';

/** jsonb maydonlarni string (fake DB) / object (real PG) ikkalasida ham object qiladi. */
function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function getTenantId() {
  const ctx = getCurrentTenant();
  return ctx?.id ?? ctx?.tenantId ?? null;
}

/** Har service funksiyasida tenant scope fail-closed guard. */
function requireTenant() {
  const tenantId = getTenantId();
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  return { ok: true, tenantId };
}

// ═══════════════════════════════════════════════════════════════════
// A11Y SETTINGS (user preferences)
// ═══════════════════════════════════════════════════════════════════

/** Get a user's accessibility settings (defaults when absent). */
export async function getAccessibilitySettings({ userKey = 'default' } = {}) {
  const db = getDb();
  if (!db) return { ...A11Y_SETTING_DEFAULTS };
  const t = requireTenant();
  if (!t.ok) return { ...A11Y_SETTING_DEFAULTS };
  const tenantId = t.tenantId;
  const row = await db
    .selectFrom('a11y_settings')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_key', '=', userKey)
    .executeTakeFirst();
  if (!row) return { ...A11Y_SETTING_DEFAULTS };
  return {
    userKey: row.user_key,
    reducedMotion: Boolean(row.reduced_motion),
    highContrast: Boolean(row.high_contrast),
    fontScale: Number(row.font_scale) || 1,
    keyboardNav: Boolean(row.keyboard_nav),
    screenReaderMode: Boolean(row.screen_reader_mode),
  };
}

/** Upsert a user's accessibility settings (idempotent by tenant+user). */
export async function saveAccessibilitySettings({
  userKey = 'default', reducedMotion = false, highContrast = false,
  fontScale = 1.0, keyboardNav = false, screenReaderMode = false, updatedBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const scale = Math.max(0.8, Math.min(2.0, Number(fontScale) || 1));
  const existing = await db
    .selectFrom('a11y_settings')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('user_key', '=', userKey)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('a11y_settings')
      .set({
        reduced_motion: reducedMotion === true,
        high_contrast: highContrast === true,
        font_scale: scale,
        keyboard_nav: keyboardNav === true,
        screen_reader_mode: screenReaderMode === true,
        updated_by: updatedBy,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('user_key', '=', userKey)
      .execute();
  } else {
    await db
      .insertInto('a11y_settings')
      .values({
        tenant_id: tenantId, user_key: userKey,
        reduced_motion: reducedMotion === true,
        high_contrast: highContrast === true,
        font_scale: scale,
        keyboard_nav: keyboardNav === true,
        screen_reader_mode: screenReaderMode === true,
        updated_by: updatedBy,
      })
      .execute();
  }

  await audit({
    action: AUDIT_ACTIONS.A11Y_SETTINGS_SAVE,
    userId: updatedBy,
    tenantId,
    resourceType: 'a11y_settings',
    resourceId: `${tenantId}/${userKey}`,
    details: { reducedMotion, highContrast, fontScale: scale, keyboardNav, screenReaderMode },
  });
  return {
    ok: true, userKey, updated: Boolean(existing),
    reducedMotion: reducedMotion === true, highContrast: highContrast === true,
    fontScale: scale, keyboardNav: keyboardNav === true, screenReaderMode: screenReaderMode === true,
  };
}

// ═══════════════════════════════════════════════════════════════════
// AUDITS (ACR evidence)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run an automated axe-style audit and persist ACR evidence.
 * Automated result ALWAYS flagged needs_review=true (§15) — a separate
 * human sign-off is required before gaps can close.
 */
export async function runAudit({ journey = 'student', pageUrl = '', snapshot = null, runBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const enumCheck = assertValidEnum({ journey });
  if (!enumCheck.ok) return { ok: false, error: enumCheck.reason };

  const evidence = buildAcrEvidence({ journey, pageUrl, checks: runAxeChecks(snapshot) });

  const row = await db
    .insertInto('a11y_audits')
    .values({
      tenant_id: tenantId, journey, page_url: pageUrl || null,
      wcag_target: WCAG_TARGET, score: evidence.score, violations: JSON.stringify(evidence.violations),
      passes: evidence.passes, incomplete: evidence.incomplete,
      needs_review: evidence.needsReview, blocker_count: evidence.blockerCount,
      run_by: runBy,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.A11Y_AUDIT_RUN,
    userId: runBy,
    tenantId,
    resourceType: 'a11y_audit',
    resourceId: String(row.id),
    details: { journey, pageUrl, score: evidence.score, blockers: evidence.blockerCount },
  });
  return { ok: true, auditId: row.id, ...evidence };
}

/** List audits (tenant-scoped, optional journey filter). */
export async function listAudits({ journey = null, limit = 50 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('a11y_audits').selectAll().where('tenant_id', '=', tenantId);
  if (journey) q = q.where('journey', '=', journey);
  return q.orderBy('run_at', 'desc').limit(Math.min(Number(limit) || 50, 200)).execute().then((rows) =>
    rows.map((r) => ({ ...r, violations: parseJson(r.violations) || [] }))
  );
}

// ═══════════════════════════════════════════════════════════════════
// GAP BACKLOG (known gaps)
// ═══════════════════════════════════════════════════════════════════

/** Create a known accessibility gap. */
export async function createGap({
  ruleId = '', description = '', journey = 'student', impact = '',
  severity = GAP_SEVERITY.MAJOR, isTimed = false, assignee = null, targetDate = null, createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  if (!ruleId || !description) return { ok: false, error: 'ruleId and description are required' };
  const enumCheck = assertValidEnum({ journey, severity });
  if (!enumCheck.ok) return { ok: false, error: enumCheck.reason };

  const cls = classifyGap({ severity, journey, isTimed });
  const row = await db
    .insertInto('a11y_gaps')
    .values({
      tenant_id: tenantId, rule_id: ruleId, description,
      journey: journey || null, impact: impact || null,
      severity, is_blocker: cls.isBlocked, status: GAP_STATUS.OPEN,
      assignee: assignee || null, target_date: targetDate || null,
      created_by: createdBy,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.A11Y_GAP_CREATE,
    userId: createdBy,
    tenantId,
    resourceType: 'a11y_gap',
    resourceId: String(row.id),
    details: { ruleId, severity, blocker: cls.isBlocked },
  });
  return { ok: true, gapId: row.id, isBlocker: cls.isBlocked };
}

/** Transition gap status (FSM + human verification for verified). */
export async function transitionGapStatus({ gapId = 0, to = '', verifiedBy = '', actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const gap = await db
    .selectFrom('a11y_gaps')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', gapId)
    .executeTakeFirst();
  if (!gap) return { ok: false, error: 'gap not found' };

  const transition = assertGapTransition({ from: gap.status, to, verifiedBy });
  if (!transition.ok) return { ok: false, error: transition.reason };

  // §15: automated-only close reject — verified requires human sign-off
  if (to === GAP_STATUS.VERIFIED) {
    const guard = assertAutomatedCheckIsNotFinal({ verifiedBy, automatedOnly: false });
    if (!guard.ok) return { ok: false, error: guard.reason };
  }

  await db
    .updateTable('a11y_gaps')
    .set({
      status: to,
      verified_by: to === GAP_STATUS.VERIFIED ? verifiedBy : null,
      verified_at: to === GAP_STATUS.VERIFIED ? new Date() : null,
      updated_at: new Date(),
    })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', gapId)
    .execute();

  await audit({
    action: AUDIT_ACTIONS.A11Y_GAP_STATUS,
    userId: actorId || verifiedBy,
    tenantId,
    resourceType: 'a11y_gap',
    resourceId: String(gapId),
    details: { from: gap.status, to, verifiedBy: to === GAP_STATUS.VERIFIED ? verifiedBy : null },
  });
  return { ok: true, gapId, from: gap.status, to, verifiedBy: to === GAP_STATUS.VERIFIED ? verifiedBy : null };
}

/** List gaps (tenant-scoped, optional status filter). */
export async function listGaps({ status = null, blockerOnly = false, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('a11y_gaps').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  if (blockerOnly) q = q.where('is_blocker', '=', true);
  return q.orderBy('created_at', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// ARTIFACT CHECKS (PDF/DOCX/PPTX)
// ═══════════════════════════════════════════════════════════════════

/** Run QA on a generated artifact (reading order, alt text, contrast, tagged PDF) — idempotent upsert. */
export async function checkArtifact({
  artifactType = 'pdf', artifactId = 0, readingOrderOk = false, images = [],
  contrastPairs = [], tagged = false, checkedBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const enumCheck = assertValidEnum({ artifactType });
  if (!enumCheck.ok) return { ok: false, error: enumCheck.reason };
  if (!artifactId) return { ok: false, error: 'artifactId is required' };

  const ro = assertArtifactReadingOrder({ artifactType, readingOrderOk });
  const alt = assertArtifactAltText({ images });
  const contrast = artifactContrastIssues({ pairs: contrastPairs });
  const pdfTag = artifactType === 'pdf' ? assertTaggedPdf({ tagged }) : { ok: true };

  const ok = ro.ok && alt.ok && contrast.length === 0 && pdfTag.ok;

  const existing = await db
    .selectFrom('a11y_artifact_checks')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('artifact_type', '=', artifactType)
    .where('artifact_id', '=', artifactId)
    .executeTakeFirst();

  const values = {
    tenant_id: tenantId, artifact_type: artifactType, artifact_id: artifactId,
    reading_order_ok: readingOrderOk === true,
    alt_text_issues: JSON.stringify(alt.missingAlt),
    contrast_issues: JSON.stringify(contrast),
    tagged_pdf: tagged === true,
    status: ok ? 'checked' : 'failed',
    checked_by: checkedBy,
  };

  if (existing) {
    await db.updateTable('a11y_artifact_checks').set(values).where('tenant_id', '=', tenantId).where('id', '=', existing.id).execute();
  } else {
    await db.insertInto('a11y_artifact_checks').values(values).execute();
  }

  await audit({
    action: AUDIT_ACTIONS.A11Y_ARTIFACT_CHECK,
    userId: checkedBy,
    tenantId,
    resourceType: 'a11y_artifact_check',
    resourceId: `${artifactType}/${artifactId}`,
    details: { ok, readingOrderOk, missingAlt: alt.missingAlt.length, contrastIssues: contrast.length, tagged },
  });
  return { ok, artifactType, artifactId, readingOrderOk: ro.ok, altTextOk: alt.ok, missingAlt: alt.missingAlt, contrastIssues: contrast, taggedPdf: pdfTag.ok, status: ok ? 'checked' : 'failed' };
}

/** List artifact checks (tenant-scoped). */
export async function listArtifactChecks({ artifactType = null, limit = 50 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('a11y_artifact_checks').selectAll().where('tenant_id', '=', tenantId);
  if (artifactType) q = q.where('artifact_type', '=', artifactType);
  return q.orderBy('checked_at', 'desc').limit(Math.min(Number(limit) || 50, 200)).execute().then((rows) =>
    rows.map((r) => ({ ...r, alt_text_issues: parseJson(r.alt_text_issues) || [], contrast_issues: parseJson(r.contrast_issues) || [] }))
  );
}

const JOURNEY_COVERAGE = ['teacher', 'student', 'admin', 'proctor'];

/** Dashboard summary — counts per journey/status for the admin view. */
export async function getAccessibilitySummary() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const audits = await db.selectFrom('a11y_audits').selectAll().where('tenant_id', '=', tenantId).limit(500).execute();
  const gaps = await db.selectFrom('a11y_gaps').selectAll().where('tenant_id', '=', tenantId).limit(500).execute();
  const artifacts = await db.selectFrom('a11y_artifact_checks').selectAll().where('tenant_id', '=', tenantId).limit(500).execute();

  const openGaps = gaps.filter((g) => g.status !== GAP_STATUS.VERIFIED);
  const blockers = openGaps.filter((g) => g.is_blocker);
  const failedArtifacts = artifacts.filter((a) => a.status === 'failed');

  return {
    ok: true,
    journeyCoverage: JOURNEY_COVERAGE.map((j) => ({ journey: j, auditCount: audits.filter((a) => a.journey === j).length })),
    audits: audits.length,
    gaps: gaps.length,
    openGaps: openGaps.length,
    blockers: blockers.length,
    artifacts: artifacts.length,
    failedArtifacts: failedArtifacts.length,
    needsReview: audits.filter((a) => a.needs_review).length,
  };
}
