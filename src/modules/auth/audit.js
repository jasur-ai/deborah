/**
 * Deborah — Privileged Action Audit Trail
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

import crypto from 'crypto';
import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from './tenant-context.js';
import { fb } from '../../../firebase/admin.js';

// ════════════════════════════════════════════════════════════════════
// AUTH A-03 — auth_audit: auth hodisalarining PII-minimal jurnali
// ════════════════════════════════════════════════════════════════════

const AUDIT_PREFIX = 'auth_audit';
const AUDIT_RETENTION_DAYS = 30; // retention: 30 kun (scheduled purge)

/**
 * Secret so'zlar — kalit nomidagi har qanday segment mos kelsa redact.
 * Tradeoff: `code`/`hash` segmentlari keng — `httpStatusCode`, `country_code`,
 * `file_hash` kabi xizmatga oid maydonlar ham redact bo'ladi. Auth audit uchun
 * fail-safe yo'nalish tanlandi (secret oqib chiqmasin) — diagnostik detail
 * yo'qotilishi qabul qilinadi; kerak bo'lsa whitelist kengaytiriladi.
 */
const SENSITIVE_WORD_RE = /^(pass|password|hash|token|otp|code|pin|secret|authorization|cookie)$/i;

/** `resetToken`/`passwordHash`/`client_secret` kabi camelCase|snake_case nomlarni ham ushlaydi. */
function isSensitiveKey(key) {
  const snake = String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return snake.split(/[^a-z0-9]/).some((part) => SENSITIVE_WORD_RE.test(part));
}

export function redactDetails(details) {
  if (details === null || typeof details !== 'object') return details;
  const out = Array.isArray(details) ? [] : {};
  for (const [k, v] of Object.entries(details)) {
    if (isSensitiveKey(k)) continue; // parol/token/OTP hech qachon log'ga
    if (v && typeof v === 'object') out[k] = redactDetails(v);
    else out[k] = v;
  }
  return out;
}

/** IP → sha256 hash (PII minimal — to'liq IP saqlanmaydi). */
export function ipHash(ipAddress) {
  if (!ipAddress) return null;
  return crypto.createHash('sha256').update(String(ipAddress)).digest('hex');
}

/** auth_audit jurnalini to'plash uchun day-key (retention purge uchun). */
export function auditDayKey(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Auth hodisasini jurnalga yozadi (async, non-blocking).
 * PII minimal: to'liq IP emas — ip_hash; parol/token/OTP redact qilinadi.
 *
 * @param {Object} params
 * @param {string} params.action  — auth.login | auth.login.failed | auth.lockout | ...
 * @param {string} params.outcome — success | failed | locked | blocked
 * @param {string} [params.method] — password | google | passkey | telegram | reset
 * @param {string} [params.actorId] — user safeKey
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {Object} [params.details] — redacted
 * @returns {Promise<boolean>}
 */
export async function logAuthEvent({ action, outcome, method, actorId, ipAddress, userAgent, details = {}, channel }) {
  // AUTH D-05 §13: trace_id auth_audit'da — incident'da trace'ni topish.
  // Span context faol bo'lmasa null (audit tashqi kodda ishlasa ham buzilmaydi).
  let traceId = null;
  try {
    const { getTraceContext } = await import('../../telemetry/context.js');
    traceId = getTraceContext()?.traceId || null;
  } catch (_) { /* telemetry yuklanmasa audit ishlashda davom etadi */ }
  const entry = {
    ts: Date.now(),
    trace_id: traceId,
    actor_id: actorId || null,
    action: String(action || ''),
    outcome: String(outcome || 'unknown'),
    method: method || null,
    // AUTH B-06 §14: verify_sent (channel) — email kabi channel'lar aniqlanadi
    channel: channel || null,
    ip_hash: ipHash(ipAddress),
    ua: userAgent ? String(userAgent).substring(0, 500) : null,
    detail: redactDetails(details),
  };

  // 1) Local DB (dev/test — assertion uchun ham)
  try {
    const key = `${AUDIT_PREFIX}/${auditDayKey()}/${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await fb.set(key, entry);
  } catch (err) {
    console.warn(`[auth_audit] local write failed: ${err.message}`);
  }

  // 2) PostgreSQL auth_audit (production) — fail-soft
  const db = await getDb();
  if (db) {
    try {
      await db.insertInto('auth_audit').values({
        ts: new Date(entry.ts).toISOString(),
        actor_id: entry.actor_id,
        action: entry.action,
        outcome: entry.outcome,
        method: entry.method,
        ip_hash: entry.ip_hash,
        // D-05: trace_id kolonkasi (050 migration) — incident korrelyatsiyasi.
        // Kolonka yo'q eski PG'da bo'lsa insert fail-soft (audit buzilmaydi).
        trace_id: entry.trace_id,
        ua: entry.ua,
        // B-06 §14: channel PG'da alohida kolonka bo'lmasa ham detail ichida
        // saqlanadi — PG schema'ga bog'lanmaydi (fail-soft insert buzilmaydi)
        detail: entry.channel ? { ...(entry.detail || {}), channel: entry.channel } : entry.detail,
      }).execute();
    } catch (err) {
      console.warn(`[auth_audit] PG write failed: ${err.message}`);
    }
  }
  return true;
}

/**
 * C-09: auth_audit ro'yxati — filter (action/method/outcome), qidiruv
 * (actor_id), vaqt oralig'i, pagination. PII minimal: yozuvlar allaqachon
 * redacted (logAuthEvent) — raw parol/token/OTP hech qachon.
 * @param {{ action?: string, method?: string, outcome?: string, q?: string,
 *   from?: number, to?: number, page?: number, pageSize?: number }} params
 * @returns {Promise<{ items: Array, total: number, page: number, pageSize: number }>}
 */
export async function listAuthAudit({
  action = '', method = '', outcome = '', q = '',
  from = 0, to = 0, page = 1, pageSize = 25,
} = {}) {
  try {
    const snap = await fb.get(AUDIT_PREFIX);
    if (!snap.exists()) return { items: [], total: 0, page, pageSize };
    const days = snap.val();
    const all = [];
    for (const dayKey of Object.keys(days)) {
      const dayEntries = days[dayKey];
      if (!dayEntries || typeof dayEntries !== 'object') continue;
      for (const key of Object.keys(dayEntries)) {
        const e = dayEntries[key];
        if (!e || typeof e !== 'object') continue;
        const ts = typeof e.ts === 'number' ? e.ts : 0;
        if (from && ts < from) continue;
        if (to && ts > to) continue;
        if (action && e.action !== action) continue;
        if (method && e.method !== method) continue;
        if (outcome && e.outcome !== outcome) continue;
        if (q) {
          const hay = String(e.actor_id || '') + ' ' + String(e.action || '');
          if (!hay.toLowerCase().includes(q.toLowerCase())) continue;
        }
        all.push({ ts, key, action: e.action || null, outcome: e.outcome || null, method: e.method || null, actor_id: e.actor_id || null, ip_hash: e.ip_hash || null, detail: e.detail || {} });
      }
    }
    all.sort((a, b) => b.ts - a.ts);
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), total, page, pageSize };
  } catch (_) {
    return { items: [], total: 0, page, pageSize };
  }
}

/**
 * C-09 §07: aggregate'lar — login success/fail, lockout, teacher, risk,
 * HIBP, abuse. Vaqt oralig'i bo'yicha (default 24h).
 * @returns {Promise<Object>}
 */
export async function auditAggregates({ from = 0, to = 0 } = {}) {
  const agg = {
    login_success: 0, login_fail: 0, lockout: 0, teacher_applications: 0,
    risk_blocked: 0, hibp_hit: 0, abuse_events: 0, total: 0,
  };
  try {
    const snap = await fb.get(AUDIT_PREFIX);
    if (!snap.exists()) return agg;
    const days = snap.val();
    for (const dayKey of Object.keys(days)) {
      const dayEntries = days[dayKey];
      if (!dayEntries || typeof dayEntries !== 'object') continue;
      for (const key of Object.keys(dayEntries)) {
        const e = dayEntries[key];
        if (!e || typeof e !== 'object') continue;
        const ts = typeof e.ts === 'number' ? e.ts : 0;
        if (from && ts < from) continue;
        if (to && ts > to) continue;
        agg.total += 1;
        const a = String(e.action || '');
        if (a === 'auth.login' || a === 'auth.login.success' || a === 'auth:login:success') agg.login_success += 1;
        else if (a.includes('login.failed') || a.includes('login:failed') || a === 'auth:login:failed') agg.login_fail += 1;
        else if (a.includes('lockout')) agg.lockout += 1;
        else if (a.includes('teacher')) agg.teacher_applications += 1;
        else if (a.includes('risk.blocked') || a.includes('risk:blocked')) agg.risk_blocked += 1;
        else if (a.includes('hibp') || a.includes('breach')) agg.hibp_hit += 1;
        else if (a.includes('abuse')) agg.abuse_events += 1;
      }
    }
    return agg;
  } catch (_) {
    return agg;
  }
}

/**
 * Retention: 30 kundan eski auth_audit yozuvlarini tozalaydi (scheduled purge).
 * @param {number} [retentionDays]
 * @returns {Promise<{ removed: number }>}
 */
export async function purgeAuthAudit(retentionDays = AUDIT_RETENTION_DAYS) {
  let removed = 0;
  try {
    const snap = await fb.get(AUDIT_PREFIX);
    if (!snap.exists()) return { removed };
    const days = snap.val();
    const cutoff = auditDayKey(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    for (const dayKey of Object.keys(days)) {
      if (dayKey < cutoff) {
        await fb.remove(`${AUDIT_PREFIX}/${dayKey}`).catch(() => {});
        removed += 1;
      }
    }
  } catch (_) { /* non-critical */ }
  return { removed };
}

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
  // AUTH A-30 — admin/teacher privilege hardening
  ADMIN_MFA_REQUIRED: 'admin:mfa:required',
  ADMIN_MFA_ENROLLED: 'admin:mfa:enrolled',
  ADMIN_LOGIN_BLOCKED: 'admin:login:blocked',
  ADMIN_IP_BLOCKED: 'admin:ip:blocked',
  ADMIN_RISK_BLOCKED: 'admin:risk:blocked',
  ADMIN_BREACH_BLOCKED: 'admin:breach:blocked',
  ADMIN_ACTION: 'admin:action',
  ADMIN_MFA_STEPUP: 'admin:mfa:stepup',
  ADMIN_MFA_RESET: 'admin:mfa:reset',
  // Password reset (plan_login §5)
  RESET_REQUEST: 'user:reset:request',
  RESET_COMPLETE: 'user:reset:complete',

  // AUTH A-22 — Password policy / HIBP
  PASSWORD_CHANGE: 'user:password:change',
  PASSWORD_POLICY_REJECT: 'user:password:policy:reject',
  BREACH_PASSWORD_BLOCKED: 'user:password:breach:blocked',
  // AUTH A-23 — email infratuzilmasi
  EMAIL_SENT: 'email:sent',
  EMAIL_BOUNCED: 'email:bounced',
  EMAIL_COMPLAINT: 'email:complaint',
  EMAIL_SUPPRESSED: 'email:suppressed',
  // AUTH B-31 — email queue
  EMAIL_QUEUED: 'email:queued',
  EMAIL_RETRIED: 'email:retried',
  EMAIL_DEADLETTER: 'email:deadletter',
  EMAIL_DELIVERED: 'email:delivered',
  EMAIL_VALIDATION_REJECT: 'email:validation:reject',
  // AUTH B-05: background SMTP probe natijasi (fail-open, faqat flag)
  EMAIL_SMTP_PROBE: 'email:smtp:probe',
  // AUTH D-32: provider failover + cost (email detail)
  EMAIL_PROVIDER_FAILOVER: 'email:provider:failover',
  EMAIL_PROVIDER_RECOVERED: 'email:provider:recovered',
  EMAIL_BUDGET_ALERT: 'email:budget:alert',
  EMAIL_COST_RECORDED: 'email:cost:recorded',
  // AUTH A-29 — account security events
  EMAIL_CHANGE_REQUESTED: 'email:change:requested',
  EMAIL_CHANGE_CANCELLED: 'email:change:cancelled',
  EMAIL_CHANGED: 'email:changed',
  BREACH_DETECTED: 'account:breach:detected',

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
  // AUTH D-09 — user settings frontend
  SETTINGS_SAVED: 'settings:saved',
  SETTINGS_EXPORTED: 'settings:exported',
  ROLE_GRANT: 'role:grant',
  ROLE_REVOKE: 'role:revoke',

  // Academic
  ACADEMIC_ARCHIVE: 'academic:archive',

  // Passkey / WebAuthn
  PASSKEY_REGISTER: 'passkey:register',
  PASSKEY_REMOVE: 'passkey:remove',
  PASSKEY_AUTH: 'passkey:authenticate',
  PASSKEY_FAIL: 'passkey:fail', // AUTH A-27: counter anomalies / invalid assertions
  PASSKEY_RENAME: 'passkey:rename', // E-05: multi-device credential boshqaruv

  // Sessions
  SESSION_REVOKE: 'session:revoke',
  SESSION_REVOKE_OTHER: 'session:revoke:other',
  SESSIONS_REVOKED: 'session:revoked:bulk', // AUTH B-25 — trigger bo'yicha ommaviy revoke
  // AUTH A-02
  SESSION_IDLE_TIMEOUT: 'session:idle-timeout',
  SESSION_LIMIT_REACHED: 'session:limit-reached',
  // AUTH A-25 — session hardening + remember-me + re-auth
  SESSION_ABSOLUTE_TIMEOUT: 'session:absolute-timeout',
  SESSION_ROTATED: 'session:rotated',
  REMEMBER_CREATED: 'remember:created',
  REMEMBER_RESTORED: 'remember:restored',
  REMEMBER_REVOKED: 'remember:revoked',
  REAUTH_SUCCESS: 'auth:reauth-success',
  REAUTH_FAILED: 'auth:reauth-failed',
  // AUTH A-26 — MFA/TOTP
  MFA_SETUP: 'mfa:setup',
  MFA_ENABLE: 'mfa:enable',
  MFA_DISABLE: 'mfa:disable',
  MFA_VERIFY: 'mfa:verify',
  MFA_CHALLENGE_RESENT: 'mfa:challenge:resent',
  // AUTH A-28 — risk-based auth
  RISK_SCORED: 'auth:risk:scored',
  RISK_STEPUP: 'auth:risk:stepup',
  RISK_BLOCKED: 'auth:risk:blocked',
  RISK_DEVICE_TRUST: 'auth:risk:device:trust',
  // AUTH C-05 — impossible travel + velocity
  IMPOSSIBLE_TRAVEL_DETECTED: 'auth:risk:impossible_travel',
  VELOCITY_DETECTED: 'auth:risk:velocity',
  // AUTH C-06 — credential stuffing + OTP bombing
  STUFFING_DETECTED: 'auth:abuse:stuffing',
  OTP_BOMB_DETECTED: 'auth:abuse:otp_bomb',
  ABUSE_BLOCKED: 'auth:abuse:blocked',
  // AUTH C-03 — device fingerprint
  DEVICE_REGISTERED: 'auth:device:registered',
  MFA_BACKUP_ROTATE: 'mfa:backup-rotate',
  MFA_RESET_REQUEST: 'mfa:reset-request',
  MFA_RESET_EXECUTED: 'mfa:reset-executed',
  MFA_REQUIRED: 'mfa:required',
  TEACHER_ESCALATED: 'teacher:escalated',
  TEACHER_SLA_REMINDED: 'teacher:sla-reminded',
  TEACHER_APPEAL: 'teacher:appeal',
  TEACHER_COOLDOWN_BLOCK: 'teacher:cooldown-block',

  // AUTH A-03 — auth_audit actions
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAIL: 'auth.login.failed',
  AUTH_LOCKOUT: 'auth.lockout',
  // AUTH C-02 — lockout state machine
  LOCKOUT_TRIGGERED: 'auth.lockout.triggered',
  LOCKOUT_RELEASED: 'auth.lockout.released',
  ACCOUNT_BLOCKED: 'auth.account.blocked',
  ACCOUNT_UNBLOCKED: 'auth.account.unblocked',
  AUTH_RESET_REQUEST: 'auth.reset.request',
  AUTH_RESET_COMPLETE: 'auth.reset.complete',
  AUTH_REGISTER: 'auth.register',
  // AUTH A-18: email verify
  EMAIL_VERIFY_SENT: 'email.verify.sent',
  EMAIL_VERIFY_COMPLETE: 'email.verify.complete',
  // B-28: verify detail
  EMAIL_VERIFY_EXPIRED: 'email.verify.expired',
  EMAIL_VERIFY_TYPO_SHOWN: 'email.verify.typo.shown',
  // AUTH B-07 §10: limited mode — summative verify'siz bloklandi
  EMAIL_VERIFY_BLOCKED: 'email.verify.blocked',
  // AUTH B-08: bot himoya — honeypot/Turnstile/rate limit bloklari
  BOT_DETECTED: 'bot.detected',
  SIGNUP_BLOCKED: 'signup.blocked',
  // AUTH B-09: duplicate account handling
  DUPLICATE_ATTEMPT: 'account.duplicate.attempt',
  ACCOUNT_LINKED: 'account.linked',
  AUTH_PASSKEY_AUTH: 'auth.passkey',

  // Recovery codes
  RECOVERY_CODE_GENERATED: 'recovery:code:generated',
  RECOVERY_CODE_USED: 'recovery:code:used',
  RECOVERY_CODE_REVOKE: 'recovery:code:revoke',

  // Roster uploads
  ROSTER_UPLOADED: 'roster:uploaded',
  ROSTER_PARSE: 'roster:parse',
  ROSTER_COMMIT: 'roster:commit',
  ROSTER_DELETE: 'roster:delete',

  // AUTH A-19: teacher approval flow
  TEACHER_APPLICATION: 'teacher:application',
  TEACHER_APPROVED: 'teacher:approved',
  TEACHER_REJECTED: 'teacher:rejected',

  // Roster invites (AUTH A-11 §16)
  INVITE_CREATED: 'invite:created',
  INVITE_USED: 'invite:used',
  INVITE_REVOKED: 'invite:revoked',
  // AUTH B-11: email yetkazish + expiry job
  INVITE_SENT: 'invite:sent',
  INVITE_EXPIRED: 'invite:expired',
  // AUTH B-12: invite sahifa ko'rildi (valid/invalid)
  INVITE_VIEW: 'invite:view',

  // AUTH D-26: incident response (append-only incident_log)
  INCIDENT_CREATED: 'incident:created',
  INCIDENT_ACTION: 'incident:action',
  INCIDENT_CLOSED: 'incident:closed',
  INCIDENT_LEAK_RESPONSE: 'incident:leak_response',
  INCIDENT_ATO_BLOCK: 'incident:ato_block',
  INCIDENT_MFA_EMERGENCY_OFF: 'incident:mfa_emergency_off',
  INCIDENT_MFA_EMERGENCY_ON: 'incident:mfa_emergency_on',

  // AUTH D-28: maintenance runbook (maintenance_log)
  MAINTENANCE_LOG: 'maintenance:log',
  MAINTENANCE_DRILL: 'maintenance:drill',
  MAINTENANCE_ROTATION_CHECK: 'maintenance:rotation:check',
  MAINTENANCE_ROTATED: 'maintenance:secret:rotated',
  MAINTENANCE_CVE_SCAN: 'maintenance:cve:scan',
  MAINTENANCE_DEP_UPDATE: 'maintenance:dep:update',
  MAINTENANCE_HIBP_SYNC: 'maintenance:hibp:sync',
  MAINTENANCE_PROVIDER_REVIEW: 'maintenance:provider:review',
  PORTFOLIO_IMPORT: 'portfolio:import',
  PORTFOLIO_SHARE: 'portfolio:share',
  PORTFOLIO_REVOKE: 'portfolio:revoke',
  PORTFOLIO_DELETE: 'portfolio:delete',
  OPENDATA_REFRESH: 'opendata:refresh',
  // AUTH C-13: diplom.edu.uz tekshiruv (P3 — client-side, OneID shartnomasi bilan to'liq flow)
  DIPLOMA_CHECK: 'diploma:check',
  // AUTH C-14: retention purge
  PURGE_RUN: 'purge:run',
  // AUTH C-15: auth data backup + DR
  BACKUP_RUN: 'auth:backup:run',
  BACKUP_FAILED: 'auth:backup:failed',
  RESTORE_DRILL: 'auth:restore:drill',
  RESTORE_VERIFY: 'auth:restore:verify',
  // AUTH D-02: secrets management (KMS) — secret qiymat log'da hech qachon
  SECRET_ACCESSED: 'secret:accessed',
  SECRET_ROTATED: 'secret:rotated',
  SECRET_DECRYPT_FAILED: 'secret:decrypt:failed',
  // AUTH E-06 — cloud KMS
  KMS_DECRYPT: 'kms:decrypt',
  KMS_DECRYPT_FAILED: 'kms:decrypt:failed',
  // AUTH D-03: Redis — infra xato (alert)
  REDIS_ERROR: 'redis:error',
  // AUTH D-06: observability — metric alert fired (ops)
  METRIC_ALERT: 'metric:alert',
  // AUTH A-15: HEMIS account linking
  HEMIS_LINKED: 'hemis:linked',
  HEMIS_UNLINKED: 'hemis:unlinked',
  HEMIS_LINK_FAIL: 'hemis:link:failed',
  // AUTH A-16: Telegram OTP
  TELEGRAM_START: 'telegram:start',
  TELEGRAM_VERIFY: 'telegram:verify',
  TELEGRAM_LINKED: 'telegram:linked',
  TELEGRAM_UNLINKED: 'telegram:unlinked',
  TELEGRAM_WEBHOOK: 'telegram:webhook',
  // AUTH B-32 — notification detail
  NOTIF_SENT: 'notif:sent',
  NOTIF_DEDUPE: 'notif:dedupe',
  NOTIF_QUIET_DELAYED: 'notif:quiet_delayed',
  // AUTH B-34 — register bot himoya extra
  SIGNUP_VELOCITY_BLOCK: 'signup:velocity:block',
  SIGNUP_REVIEW_CREATED: 'signup:review:created',
  SIGNUP_REVIEW_RESOLVED: 'signup:review:resolved',
  // AUTH B-35 — re-engagement journey
  REENGAGE_SENT: 'onboarding:reengage_sent',
  REENGAGE_OPTED_OUT: 'onboarding:reengage_opted_out',
  // AUTH C-01 — tiered rate limit
  RATE_LIMIT_HIT: 'auth:rate_limit_hit',
  // AUTH B-36 — teacher extra
  BULK_INVITE_CREATED: 'teacher:bulk_invite_created',
  CO_TEACHER_ADDED: 'teacher:co_teacher_added',
  CO_TEACHER_REMOVED: 'teacher:co_teacher_removed',
  APPEAL_CREATED: 'teacher:appeal_created',
  APPEAL_RESOLVED: 'teacher:appeal_resolved',

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
  ONEID_SYNC_FAILED: 'oneid:sync:failed',
  HEMIS_WEBHOOK: 'hemis:webhook',

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
  // AUTH B-21 — notification preferences
  NOTIF_PREFS_UPDATED: 'notification:prefs:updated',
  // AUTH B-22 — Telegram bot
  TELEGRAM_LINKED: 'telegram:linked',
  TELEGRAM_SENT: 'telegram:sent',
  TELEGRAM_FAILED: 'telegram:failed',
  // AUTH B-23 — Web Push (PWA)
  PUSH_SUBSCRIBED: 'push:subscribed',
  PUSH_UNSUBSCRIBED: 'push:unsubscribed',
  PUSH_SENT: 'push:sent',
  PUSH_FAILED: 'push:failed',
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
  // AUTH A-24 — OIDC hardening (OAuth 2.1 / RFC 9700)
  OIDC_TOKEN_INVALID: 'oidc:token:invalid',
  OIDC_REFRESH_ROTATED: 'oidc:refresh:rotated',
  OIDC_REFRESH_REPLAY: 'oidc:refresh:replay',
  OIDC_REDIRECT_MISMATCH: 'oidc:redirect:mismatch',
  // E-04: JWKS key rotation monitoring (kid o'zgarishi — provider key aylanishi)
  OIDC_JWKS_ROTATED: 'oidc:jwks:rotated',

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

  // AUTH B-17: onboarding (Orient)
  ONBOARDING_VIEW: 'onboarding:view',
  ONBOARDING_ORIENT: 'onboarding:orient',
  ONBOARDING_SKIP: 'onboarding:skip',
  // AUTH B-18: onboarding (Activate / first-win)
  ONBOARDING_FIRST_WIN_START: 'onboarding:first_win_start',
  ONBOARDING_FIRST_WIN_COMPLETE: 'onboarding:first_win_complete',
  // AUTH B-19: onboarding (Reinforce / checklist + welcome)
  ONBOARDING_CHECKLIST: 'onboarding:checklist',
  ONBOARDING_WELCOME_SENT: 'onboarding:welcome_sent',
};

