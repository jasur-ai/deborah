/**
 * Edikit — Privileged Action Audit Trail
 *
 * Logs all security-sensitive operations to the audit_log table.
 * Gracefully degrades when PostgreSQL is not configured (logs to console instead).
 *
 * Audited actions typically include:
 *   - Authentication events (login, logout, failed login)
 *   - Authorization changes (role grants, revocations)
 *   - Data mutations (create/update/delete on critical entities)
 *   - Security-sensitive operations (password changes, VIP grants)
 *   - Configuration changes (system settings)
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from './tenant-context.js';

/**
 * Log an audit event.
 *
 * @param {Object} params
 * @param {number} [params.tenantId] - Tenant ID (defaults from context)
 * @param {number} [params.userId] - User performing the action
 * @param {string} params.action - Action identifier (e.g., 'user:login', 'vip:grant')
 * @param {string} [params.resourceType] - Resource type (e.g., 'test', 'course', 'user')
 * @param {number|string} [params.resourceId] - Resource identifier
 * @param {Object} [params.details] - Additional context (not sensitive!)
 * @param {string} [params.ipAddress] - Client IP
 * @param {string} [params.userAgent] - User agent string
 * @returns {Promise<boolean>}
 */
export async function audit({
  tenantId,
  userId,
  action,
  resourceType,
  resourceId,
  details = {},
  ipAddress,
  userAgent,
}) {
  const tenant = getCurrentTenant();
  const tid = tenantId || tenant?.tenantId || null;

  // Try to write to PostgreSQL
  const db = await getDb();
  if (db) {
    try {
      await db.insertInto('audit_log').values({
        tenant_id: tid,
        user_id: userId || null,
        action,
        resource_type: resourceType || null,
        resource_id: resourceId ? (typeof resourceId === 'number' ? resourceId : null) : null,
        details: details, // Kysely serializes objects for JSONB columns automatically
        ip_address: ipAddress || null,
        user_agent: userAgent ? userAgent.substring(0, 500) : null,
      }).execute();
      return true;
    } catch (err) {
      // Fallback to console logging
      console.warn(`[Audit] DB write failed for ${action}: ${err.message}`);
    }
  }

  // Fallback: log to console
  console.log(JSON.stringify({
    event: 'audit',
    tenant_id: tid,
    user_id: userId,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    details,
    timestamp: new Date().toISOString(),
  }));

  return true; // Don't fail the request if audit log fails
}

/**
 * Query audit log entries (with tenant scope).
 *
 * @param {Object} params
 * @param {number} params.tenantId
 * @param {Object} [params.filters]
 * @param {string} [params.filters.action]
 * @param {string} [params.filters.resourceType]
 * @param {number} [params.filters.resourceId]
 * @param {number} [params.filters.userId]
 * @param {number} [params.limit] - Max results (default 50)
 * @param {number} [params.offset] - Pagination offset
 * @returns {Promise<Array>}
 */
export async function queryAuditLog({ tenantId, filters = {}, limit = 50, offset = 0 }) {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = db
      .selectFrom('audit_log')
      .where('tenant_id', '=', tenantId);

    if (filters.action) {
      query = query.where('action', '=', filters.action);
    }
    if (filters.resourceType) {
      query = query.where('resource_type', '=', filters.resourceType);
    }
    if (filters.resourceId) {
      query = query.where('resource_id', '=', filters.resourceId);
    }
    if (filters.userId) {
      query = query.where('user_id', '=', filters.userId);
    }

    const rows = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .selectAll()
      .execute();

    return rows;
  } catch (_) {
    return [];
  }
}

/**
 * Express middleware: audit successful requests.
 * Wrap route handlers with this to automatically log audited actions.
 *
 * Usage:
 *   import { auditMiddleware } from './audit.js';
 *   app.post('/admin/api/vip/grant', auditMiddleware('vip:grant'), handler);
 *
 * @param {string} action
 * @param {Object} [options]
 * @returns {Function}
 */
export function auditMiddleware(action, options = {}) {
  return (req, res, next) => {
    // Store original send to intercept response
    const originalSend = res.send;
    res.send = function (...args) {
      // Only audit successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        audit({
          action,
          userId: req.session?.user?.id || req.session?.admin?.id,
          tenantId: req.session?.user?.tenant_id || req.session?.admin?.tenant_id,
          resourceType: options.resourceType,
          resourceId: req.params?.id || req.body?.id,
          details: { path: req.path, method: req.method },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});
      }
      return originalSend.apply(this, args);
    };
    next();
  };
}

// ── Standard audit action constants ──
export const AUDIT_ACTIONS = {
  // Authentication
  USER_LOGIN: 'user:login',
  USER_LOGIN_FAILED: 'user:login:failed',
  USER_REGISTER: 'user:register',
  USER_LOGOUT: 'user:logout',
  ADMIN_LOGIN: 'admin:login',
  ADMIN_LOGIN_FAILED: 'admin:login:failed',

  // VIP
  VIP_GRANT: 'vip:grant',
  VIP_REVOKE: 'vip:revoke',

  // Tests
  TEST_CREATE: 'test:create',
  TEST_UPDATE: 'test:update',
  TEST_DELETE: 'test:delete',
  TEST_PUBLISH: 'test:publish',

  // Users
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',

  // Courses
  COURSE_CREATE: 'course:create',
  COURSE_UPDATE: 'course:update',
  COURSE_DELETE: 'course:delete',

  // System
  SETTINGS_CHANGE: 'system:settings:change',
  ROLE_GRANT: 'role:grant',
  ROLE_REVOKE: 'role:revoke',

  // Academic
  ACADEMIC_ARCHIVE: 'academic:archive',

  // Passkey / WebAuthn
  PASSKEY_REGISTER: 'passkey:register',
  PASSKEY_REMOVE: 'passkey:remove',
  PASSKEY_AUTH: 'passkey:authenticate',

  // Sessions
  SESSION_REVOKE: 'session:revoke',
  SESSION_REVOKE_OTHER: 'session:revoke:other',

  // Recovery codes
  RECOVERY_CODE_GENERATED: 'recovery:code:generated',
  RECOVERY_CODE_USED: 'recovery:code:used',
  RECOVERY_CODE_REVOKE: 'recovery:code:revoke',

  // Roster uploads
  ROSTER_COMMIT: 'roster:commit',
  ROSTER_DELETE: 'roster:delete',

  // Accommodations
  ACCOMMODATION_CREATE: 'accommodation:create',
  ACCOMMODATION_UPDATE: 'accommodation:update',
  ACCOMMODATION_REVOKE: 'accommodation:revoke',
  ACCOMMODATION_SNAPSHOT: 'accommodation:snapshot',

  // Account linking
  ACCOUNT_LINKED: 'account:linked',
  ACCOUNT_UNLINKED: 'account:unlinked',
  ACCOUNT_LINK_REQUEST: 'account:link:request',
  ACCOUNT_LINK_REJECTED: 'account:link:rejected',
  IDENTITY_MISMATCH: 'identity:mismatch',
  IDENTITY_RESOLVED: 'identity:resolved',

  // Assessment builder
  ASSESSMENT_CREATE: 'assessment:create',
  ASSESSMENT_UPDATE: 'assessment:update',
  ASSESSMENT_DELETE: 'assessment:delete',
  ASSESSMENT_PUBLISH: 'assessment:publish',
  ASSESSMENT_ARCHIVE: 'assessment:archive',
  ASSESSMENT_VERSION_CREATE: 'assessment:version:create',
  ASSESSMENT_ITEM_ADD: 'assessment:item:add',
  ASSESSMENT_ITEM_REMOVE: 'assessment:item:remove',
  ASSESSMENT_TEMPLATE_CREATE: 'assessment:template:create',
  ASSESSMENT_TEMPLATE_UPDATE: 'assessment:template:update',
  ASSESSMENT_TEMPLATE_DELETE: 'assessment:template:delete',

  // Briefs & policies
  BRIEF_CREATE: 'brief:create',
  BRIEF_UPDATE: 'brief:update',
  BRIEF_DELETE: 'brief:delete',
  BRIEF_APPROVE: 'brief:approve',
  POLICY_CREATE: 'policy:create',
  POLICY_UPDATE: 'policy:update',
  POLICY_DELETE: 'policy:delete',
  POLICY_APPROVE: 'policy:approve',
  POLICY_RECIPE_APPLY: 'policy:recipe:apply',
  SIMULATOR_RUN: 'simulator:run',

  // Program calendar & workload
  CALENDAR_EVENT_CREATE: 'calendar:event:create',
  CALENDAR_EVENT_UPDATE: 'calendar:event:update',
  CALENDAR_EVENT_ARCHIVE: 'calendar:event:archive',
  CALENDAR_EVENT_TRANSITION: 'calendar:event:transition',
  CALENDAR_EVENT_PUBLISH: 'calendar:event:publish',
  CALENDAR_NOTIFICATION: 'calendar:notification',

  // Immutable publish transaction & assignment snapshot
  ASSIGNMENT_PUBLISH: 'assignment:publish',
  ASSIGNMENT_VERIFY: 'assignment:verify',

  // Student assignment list, brief & preflight
  PREFLIGHT_RUN: 'preflight:run',

  // Attempt lease, identity step & server timer (Phase D)
  ATTEMPT_START: 'attempt:start',
  ATTEMPT_TRANSITION: 'attempt:transition',

  // Response API, ACK sequence & autosave (Phase D)
  RESPONSE_SAVE: 'response:save',
  RESPONSE_REJECTED: 'response:rejected',

  // IndexedDB offline journal, reconnect & recovery (Phase D)
  OFFLINE_SYNC: 'offline:sync',
  RECOVERY_EXPORT: 'recovery:export',
  RECOVERY_IMPORT: 'recovery:import',

  // Submit sealing & signed receipt (Phase D)
  ATTEMPT_SUBMIT: 'attempt:submit',
  SCORING_ENQUEUE: 'scoring:enqueue',

  // Uch-strike client collector & server classifier (Phase D)
  PROCTOR_EVENT: 'proctor:event',
  PROCTOR_TERMINATE: 'proctor:terminate',
  PROCTOR_REOPEN: 'proctor:reopen',

  // Security profile & Safe Exam Browser boundary (Phase D)
  SECURITY_POLICY_UPDATE: 'security:policy:update',
  SECURITY_SEB_VERIFY: 'security:seb:verify',

  // Security guard: threat model, ASVS matrix, findings & red-team (Prompt 70)
  SECURITY_FINDING_ACCEPT: 'security:finding:accept',
  SECURITY_FINDING_REMEDIATE: 'security:finding:remediate',
  // Reserved for explicit 'run security report' actions (read-only posture
  // views do NOT audit to avoid log noise — only privileged mutations do).
  SECURITY_POSTURE_REPORT: 'security:posture:report',

  // Reliability guard: peak load, chaos, backup/DR & release safety (Prompt 71)
  RELIABILITY_LOAD_RUN: 'reliability:load:run',
  RELIABILITY_CHAOS_DRILL: 'reliability:chaos:drill',
  RELIABILITY_BACKUP_RESTORE: 'reliability:backup:restore',
  RELIABILITY_DRAIN: 'reliability:drain',
  RELIABILITY_FREEZE: 'reliability:freeze',

  // Privacy-first camera evidence pilot (Phase D)
  CAMERA_PILOT_UPDATE: 'camera:pilot:update',
  CAMERA_CONSENT_GRANT: 'camera:consent:grant',
  CAMERA_CONSENT_REVOKE: 'camera:consent:revoke',
  CAMERA_EVIDENCE_RECORD: 'camera:evidence:record',
  CAMERA_EVIDENCE_DISPOSITION: 'camera:evidence:disposition',
  CAMERA_EVIDENCE_RETENTION_DELETE: 'camera:evidence:retention:delete',

  // Exam scheduling solver (Prompt 39)
  SCHEDULER_RUN: 'scheduler:run',
  SCHEDULER_APPROVE: 'scheduler:approve',
  SCHEDULER_PUBLISH: 'scheduler:publish',
  SCHEDULER_WEIGHTS: 'scheduler:weights',
  EXAM_ROOM_CREATE: 'scheduler:room:create',
  EXAM_ROOM_UPDATE: 'scheduler:room:update',
  EXAM_PERIOD_CREATE: 'scheduler:period:create',

  // Seat, proctor, hall ticket & check-in (Prompt 40)
  SEAT_MAP_UPDATE: 'seating:seatmap:update',
  SEAT_ALLOCATE: 'seating:allocate',
  PROCTOR_ALLOCATE: 'seating:proctor:allocate',
  PROCTOR_ACK: 'seating:proctor:ack',
  HALL_TICKET_ACK: 'seating:hallticket:ack',
  CHECKIN_APPLY: 'seating:checkin:apply',
  SEAT_RESEAT: 'seating:reseat',

  // Exam command center, incident & notifications (Prompt 41)
  INCIDENT_CREATE: 'incident:create',
  INCIDENT_TRANSITION: 'incident:transition',
  INCIDENT_OWNER_ASSIGN: 'incident:owner:assign',
  INCIDENT_ACTION: 'incident:action',
  NOTIFICATION_QUEUE: 'notification:queue',
  NOTIFICATION_DELIVERY: 'notification:delivery',
  POSTMORTEM_CREATE: 'postmortem:create',
  POSTMORTEM_TRANSITION: 'postmortem:transition',
  ACTION_ITEM_ADD: 'action-item:add',
  ACTION_ITEM_UPDATE: 'action-item:update',

  // Paper packet, QR & chain of custody (Prompt 42)
  PAPER_BATCH_GENERATE: 'paper:batch:generate',
  PAPER_BATCH_TRANSITION: 'paper:batch:transition',
  PAPER_CUSTODY_EVENT: 'paper:custody:event',
  PAPER_DOWNLOAD_TOKEN: 'paper:download:token',
  PAPER_QR_VERIFY: 'paper:qr:verify',

  // Scan, reconciliation, OMR & OCR (Prompt 43)
  SCAN_BATCH_CREATE: 'scan:batch:create',
  SCAN_BATCH_TRANSITION: 'scan:batch:transition',
  SCAN_PAGE_INGEST: 'scan:page:ingest',
  SCAN_RECONCILE_QUEUE: 'scan:reconcile:queue',
  SCAN_RECONCILE_RESOLVE: 'scan:reconcile:resolve',
  SCAN_OMR_INGEST: 'scan:omr:ingest',
  SCAN_OCR_INGEST: 'scan:ocr:ingest',
  SCAN_OCR_APPROVE: 'scan:ocr:approve',
  SCAN_DERIVATIVE_CREATE: 'scan:derivative:create',

  // Safe file, code & oral submission (Prompt 44)
  UPLOAD_SESSION_CREATE: 'upload:session:create',
  UPLOAD_CHUNK: 'upload:chunk',
  UPLOAD_FINALIZE: 'upload:finalize',
  UPLOAD_QUARANTINE_REVIEW: 'upload:quarantine:review',
  SUBMISSION_VERSION: 'submission:version',
  MEDIA_TRANSCRIPT_CREATE: 'media:transcript:create',
  MEDIA_TRANSCRIPT_REVIEW: 'media:transcript:review',

  // Academic grade rules & deterministic calculation (Prompt 45)
  GRADE_RULE_CREATE: 'grade:rule:create',
  GRADE_RULE_VERSION: 'grade:rule:version',
  GRADE_RULE_APPROVE: 'grade:rule:approve',
  GRADE_CALCULATE: 'grade:calculate',
  GRADE_REPRODUCE: 'grade:reproduce',

  // Marker allocation, calibration & moderation (Prompt 46)
  MARKING_ASSIGN: 'marking:assign',
  MARKING_ALLOCATE: 'marking:allocate',
  MARKING_CALIBRATION: 'marking:calibration',
  MARKING_SCORE: 'marking:score',
  MARKING_ADJUDICATE: 'marking:adjudicate',

  // Board ratification, result release & grade ledger (Prompt 47)
  BOARD_ROLE_ASSIGN: 'board:role:assign',
  BOARD_MEETING_CREATE: 'board:meeting:create',
  BOARD_RATIFY: 'board:ratify',
  RESULT_RELEASE: 'result:release',
  GRADE_AMEND: 'grade:amend',

  // Special consideration, deferral, resit, appeal & scoring incident
  // (Prompt 48)
  CASE_CREATE: 'case:create',
  CASE_TRANSITION: 'case:transition',
  CASE_DECIDE: 'case:decide',
  EVIDENCE_ADD: 'evidence:add',
  REMEDY_SCHEDULE: 'remedy:schedule',
  INCIDENT_CREATE: 'incident:create',
  INCIDENT_FREEZE: 'incident:freeze',
  INCIDENT_RESCORE: 'incident:rescore',

  // Source pack & secure RAG ingestion (Prompt 50)
  SOURCE_PACK_CREATE: 'source:pack:create',
  SOURCE_PACK_TRANSITION: 'source:pack:transition',
  SOURCE_CREATE: 'source:create',
  SOURCE_UPLOAD: 'source:upload',
  SOURCE_EXTRACT: 'source:extract',
  SOURCE_APPROVE: 'source:approve',
  SOURCE_REJECT: 'source:reject',

  // Written AI grading shadow mode (Prompt 51)
  AI_JOB_CREATE: 'ai:job:create',
  AI_RUN_COMPLETE: 'ai:run:complete',
  AI_OVERRIDE: 'ai:override',

  // AI evaluation, MLOps & rollback (Prompt 52)
  AI_MODEL_REGISTER: 'ai:model:register',
  AI_MODEL_PIN: 'ai:model:pin',
  AI_MODEL_ALLOWLIST: 'ai:model:allowlist',
  AI_MODEL_STATUS: 'ai:model:status',
  AI_DATASET_CREATE: 'ai:dataset:create',
  AI_EVAL_RUN: 'ai:eval:run',
  AI_ROLLBACK: 'ai:rollback',

  // AI question generator 50/30/20 (Prompt 53)
  AI_GEN_BLUEPRINT: 'ai:gen:blueprint',
  AI_GEN_CANDIDATE: 'ai:gen:candidate',
  AI_GEN_REVIEW: 'ai:gen:review',

  // Resource recommendation connectors (Prompt 54)
  RESOURCE_SEARCH: 'resource:search',
  RESOURCE_FEEDBACK: 'resource:feedback',
  RESOURCE_PROVIDER_UPDATE: 'resource:provider:update',
  RESOURCE_LLM_SUMMARY: 'resource:llm:summary',

  // Intervention loop, adaptive practice & support (Prompt 55)
  MISCONCEPTION_SUGGEST: 'intervention:misconception:suggest',
  CLUSTER_REVIEW: 'intervention:cluster:review',
  INTERVENTION_CREATE: 'intervention:create',
  INTERVENTION_PUBLISH: 'intervention:publish',
  ACTION_CARD_GENERATE: 'intervention:card:generate',
  ACTION_CARD_DECISION: 'intervention:card:decision',
  REASSESSMENT_ASSIGN: 'intervention:reassessment:assign',
  INTERVENTION_METRICS: 'intervention:metrics',
  MASTERY_UPDATE: 'intervention:mastery:update',
  PRACTICE_SCHEDULE: 'intervention:practice:schedule',
  SUPPORT_CASE_OPEN: 'intervention:support:open',
  SUPPORT_CASE_CLOSE: 'intervention:support:close',
  CONTEST_REQUEST: 'intervention:contest:request',

  // Canonical presentation & native editor (Prompt 56)
  PRESENTATION_CREATE: 'presentation:create',
  PRESENTATION_SAVE: 'presentation:save',
  PRESENTATION_ROLLBACK: 'presentation:rollback',
  PRESENTATION_COMMENT: 'presentation:comment',
  PRESENTATION_QA: 'presentation:qa',
  PRESENTATION_EXPORT: 'presentation:export',
  PRESENTATION_PUBLISH: 'presentation:publish',

  // Claude native adapter (Prompt 57)
  CLAUDE_SYNTHESIZE: 'claude:synthesize',
  CLAUDE_JOB_FAILED: 'claude:job:failed',
  CLAUDE_PROVIDER_UPDATE: 'claude:provider:update',

  // Unified provider async adapter (Prompt 58 — Gamma + Manus)
  PROVIDER_JOB_CREATE: 'provider:job:create',
  PROVIDER_JOB_FAILED: 'provider:job:failed',
  PROVIDER_JOB_CANCEL: 'provider:job:cancel',
  PROVIDER_WEBHOOK_RECEIVED: 'provider:webhook:received',
  PROVIDER_WEBHOOK_REJECTED: 'provider:webhook:rejected',
  PROVIDER_ARTIFACT_COPY: 'provider:artifact:copy',
  PROVIDER_FOLLOW_UP: 'provider:follow-up',
  PROVIDER_CONFIG_UPDATE: 'provider:config:update',

  // Canva Button/Connect adapter (Prompt 59)
  CANVA_LINK: 'canva:link',
  CANVA_CALLBACK: 'canva:callback',
  CANVA_CREATE: 'canva:create',
  CANVA_IMPORT: 'canva:import',
  CANVA_EXPORT: 'canva:export',

  // Google Slides adapter (Prompt 59)
  GOOGLE_LINK: 'google:link',
  GOOGLE_CREATE: 'google:slides:create',
  GOOGLE_EXPORT: 'google:slides:export',

  // Deck export + quiz-from-deck (Prompt 59)
  DECK_EXPORT: 'deck:export',
  QUIZ_GENERATE: 'quiz:generate',
  QUIZ_APPROVE: 'quiz:approve',
  QUIZ_PUBLISH: 'quiz:publish',

  // AI/Content checkpoint (Prompt 60)
  AI_CHECKPOINT_RUN: 'ai:checkpoint:run',

  // Portfolio & verifiable credentials (Prompt 61)
  CREDENTIAL_DEFINITION_PUBLISH: 'credential:definition:publish',
  CREDENTIAL_ISSUE: 'credential:issue',
  CREDENTIAL_REVOKE: 'credential:revoke',
  CREDENTIAL_RENEW: 'credential:renew',

  // Program quality & accreditation workspace (Prompt 62)
  PROGRAM_QUALITY_MAP_PUBLISH: 'program-quality:map:publish',
  PROGRAM_QUALITY_FINDING_CREATE: 'program-quality:finding:create',
  PROGRAM_QUALITY_FINDING_RESOLVE: 'program-quality:finding:resolve',
  PROGRAM_QUALITY_ACTION_CREATE: 'program-quality:action:create',
  PROGRAM_QUALITY_ACTION_CLOSE: 'program-quality:action:close',
  PROGRAM_QUALITY_EXPORT: 'program-quality:export',

  // Uzbek Latin/Cyrillic & terminology layer (Prompt 63)
  MULTILINGUAL_TERMINOLOGY_PUBLISH: 'multilingual:terminology:publish',
  MULTILINGUAL_TRANSLATION_REVIEW: 'multilingual:translation:review',

  // Accessibility (WCAG 2.2 AA — Prompt 64)
  A11Y_SETTINGS_SAVE: 'a11y:settings:save',
  A11Y_AUDIT_RUN: 'a11y:audit:run',
  A11Y_GAP_CREATE: 'a11y:gap:create',
  A11Y_GAP_STATUS: 'a11y:gap:status',
  A11Y_ARTIFACT_CHECK: 'a11y:artifact:check',

  // Data governance (Prompt 65)
  DATA_GOV_ASSET_REGISTER: 'data-gov:asset:register',
  DATA_GOV_HOLD_PLACE: 'data-gov:hold:place',
  DATA_GOV_HOLD_RELEASE: 'data-gov:hold:release',
  DATA_GOV_DSAR_CREATE: 'data-gov:dsar:create',
  DATA_GOV_DSAR_STATUS: 'data-gov:dsar:status',
  DATA_GOV_PURGE_RUN: 'data-gov:purge:run',

  // External integration boundary — HEMIS & OneID (Prompt 66)
  EXT_CONNECTION_REGISTER: 'ext:connection:register',
  EXT_HEMIS_PULL: 'ext:hemis:pull',
  EXT_GRADE_PUSH: 'ext:grade:push',
  EXT_JOB_RETRY: 'ext:job:retry',
  EXT_JOB_DLQ: 'ext:job:dlq',
  EXT_RECONCILE: 'ext:reconcile:run',
  EXT_ONEID_LINK: 'ext:oneid:link',
  EXT_ONEID_REVOKE: 'ext:oneid:revoke',
  EXT_TOKEN_STORE: 'ext:token:store',
  EXT_TOKEN_REVOKE: 'ext:token:revoke',

  // API/Socket/job/webhook/outbox contract audit (Prompt 67)
  CONTRACT_ROUTE_REGISTER: 'contract:route:register',
  CONTRACT_SAVE: 'contract:save',
  CONTRACT_STATUS: 'contract:status',
  CONTRACT_SOCKET_EVENT: 'contract:socket:event',
  WEBHOOK_RECORD: 'webhook:record',
  OUTBOX_ENQUEUE: 'outbox:enqueue',
  OUTBOX_DELIVERED: 'outbox:delivered',
  OUTBOX_FAILED: 'outbox:failed',
  OUTBOX_DEAD_LETTER: 'outbox:dead-letter',

  // Institutional handoff — final migration, pilot va procurement (Prompt 72)
  INSTITUTIONAL_BACKUP_HASH: 'institutional:backup:hash',
  INSTITUTIONAL_DRY_RUN: 'institutional:dry-run',
  INSTITUTIONAL_RECONCILE: 'institutional:reconcile',
  INSTITUTIONAL_CUTOVER: 'institutional:cutover',
  INSTITUTIONAL_CUTOVER_COMPLETE: 'institutional:cutover:complete',
  INSTITUTIONAL_TRAINING: 'institutional:training',
  INSTITUTIONAL_PRACTICE: 'institutional:practice',
  INSTITUTIONAL_PILOT: 'institutional:pilot',
  INSTITUTIONAL_PROCUREMENT: 'institutional:procurement',
  INSTITUTIONAL_EXIT_TEST: 'institutional:exit-test',

  // Final system acceptance & handover (Prompt 73 — checkpoint)
  ACCEPTANCE_EVIDENCE: 'acceptance:evidence',
  ACCEPTANCE_REVIEW: 'acceptance:review',
  ACCEPTANCE_SIGN_OFF: 'acceptance:sign-off',
  ACCEPTANCE_BACKLOG: 'acceptance:backlog',
};

