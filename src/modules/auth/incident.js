/**
 * Deborah — Auth Incident Response (AUTH D-26)
 * ---------------------------------------------------------------------------
 * Append-only incident log + response helper'lar (D-26 §06-§11).
 *
 * Incident turlari: credential_leak, session_hijack, ato_burst, mfa_bypass,
 * email_compromise, provider_outage.
 * Severity: S1 (critical — <1 soat), S2 (high), S3 (medium).
 *
 * Yozuv: `incidents/{id}` = { id, type, severity, owner, status,
 * created_at, closed_at, timeline: [{at, action, actorId}], postmortem }.
 * Timeline APPEND-ONLY — faqat push, hech qachon overwrite emas (§15).
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { audit, AUDIT_ACTIONS } from './audit.js';
import { revokeByUser } from './session-manager.js';

export const INCIDENT_TYPES = ['credential_leak', 'session_hijack', 'ato_burst', 'mfa_bypass', 'email_compromise', 'provider_outage'];
export const INCIDENT_SEVERITIES = ['S1', 'S2', 'S3'];

/** Append-only incident yaratadi (D-26 §15). */
export async function createIncident({ type, severity = 'S3', owner = null, ipHash = null, reason = '' } = {}) {
  if (!INCIDENT_TYPES.includes(type)) return { ok: false, error: 'invalid_type' };
  if (!INCIDENT_SEVERITIES.includes(severity)) return { ok: false, error: 'invalid_severity' };

  const id = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const record = {
    id,
    type,
    severity,
    owner: owner ? String(owner).slice(0, 100) : null,
    status: 'open',
    created_at: now,
    closed_at: null,
    reason: String(reason || '').slice(0, 500),
    timeline: [{ at: now, action: 'incident:created', actorId: owner || 'system' }],
    postmortem: null,
  };
  await fb.set(`incidents/${id}`, record);

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_CREATED,
    resourceType: 'incident',
    resourceId: id,
    details: { type, severity, owner },
    ipAddress: null,
  }).catch(() => {});

  return { ok: true, id, record };
}

/** Timeline append (append-only — §15). */
export async function appendIncidentAction(incidentId, { action, actorId = 'system', ipHash = null } = {}) {
  const snap = await fb.get(`incidents/${safeKey(incidentId)}`);
  if (!snap.exists()) return { ok: false, error: 'incident_not_found' };
  const rec = snap.val();
  const entry = { at: Date.now(), action: String(action || '').slice(0, 200), actorId: String(actorId || 'system').slice(0, 100) };
  const timeline = Array.isArray(rec.timeline) ? [...rec.timeline, entry] : [entry];
  await fb.set(`incidents/${safeKey(incidentId)}`, { ...rec, timeline });

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_ACTION,
    resourceType: 'incident',
    resourceId: safeKey(incidentId),
    details: { action: entry.action, actorId: entry.actorId },
  }).catch(() => {});

  return { ok: true, entry };
}

/** Incident'ni yopadi — postmortem bilan (D-26 §07). */
export async function closeIncident(incidentId, { postmortem = '', reviewer = null } = {}) {
  const snap = await fb.get(`incidents/${safeKey(incidentId)}`);
  if (!snap.exists()) return { ok: false, error: 'incident_not_found' };
  const rec = snap.val();
  const updated = {
    ...rec,
    status: 'closed',
    closed_at: Date.now(),
    postmortem: String(postmortem || '').slice(0, 2000),
    reviewer: reviewer ? String(reviewer).slice(0, 100) : null,
    timeline: [...(Array.isArray(rec.timeline) ? rec.timeline : []), { at: Date.now(), action: 'incident:closed', actorId: reviewer || 'system' }],
  };
  await fb.set(`incidents/${safeKey(incidentId)}`, updated);

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_CLOSED,
    resourceType: 'incident',
    resourceId: safeKey(incidentId),
    details: { severity: rec.severity, type: rec.type },
  }).catch(() => {});

  return { ok: true, record: updated };
}

/** Incident'lar ro'yxati (filter bilan). */
export async function listIncidents({ status = null, type = null, limit = 50 } = {}) {
  const snap = await fb.get('incidents');
  if (!snap.exists()) return [];
  const all = Object.values(snap.val() || {});
  return all
    .filter((i) => (status ? i.status === status : true))
    .filter((i) => (type ? i.type === type : true))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit);
}

/**
 * Credential leak response (D-26 §08): HIBP alert → barcha affected user'lar
 * sessiyalari revoke + forced password reset + audit. Notify — alohida kanal
 * (email/push) orqali chaqiruvchi amalga oshiradi (fire-and-forget).
 */
export async function credentialLeakResponse({ userIds = [], reason = '', ipHash = null, actorId = 'system' } = {}) {
  if (!Array.isArray(userIds) || userIds.length === 0) return { ok: false, error: 'no_users' };
  const results = [];
  for (const raw of userIds) {
    const key = safeKey(raw);
    try {
      // 1) Sessiyalarni revoke (hamma qurilmalar)
      await revokeByUser(key, { reason: 'credential_leak', exceptSessionId: null });
      // 2) Forced reset — keyingi login'da majburiy parol yangilash
      await fb.set(`users/${key}/force_password_reset`, { at: Date.now(), reason: String(reason || 'credential_leak').slice(0, 200) });
      results.push({ userKey: key, ok: true });
    } catch (_) {
      results.push({ userKey: key, ok: false });
    }
  }

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_LEAK_RESPONSE,
    resourceType: 'incident',
    details: { affected: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, reason },
  }).catch(() => {});

  return { ok: true, results };
}

/**
 * ATO burst response (D-26 §09): risk_block alert → affected user'lar blok
 * (status='blocked' — C-02 lockout bilan bir xil) + sessiya revoke + audit.
 * Super-admin bildirishnomasi chaqiruvchi tomonidan (notifySuperAdmin).
 */
export async function atoBurstResponse({ userIds = [], ipHash = null, actorId = 'system' } = {}) {
  if (!Array.isArray(userIds) || userIds.length === 0) return { ok: false, error: 'no_users' };
  const results = [];
  for (const raw of userIds) {
    const key = safeKey(raw);
    try {
      await revokeByUser(key, { reason: 'ato_burst', exceptSessionId: null });
      await fb.set(`users/${key}/status`, 'blocked'); // C-02 §10 permanent blok
      await fb.set(`users/${key}/blocked_reason`, 'ato_burst');
      results.push({ userKey: key, ok: true });
    } catch (_) {
      results.push({ userKey: key, ok: false });
    }
  }

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_ATO_BLOCK,
    resourceType: 'incident',
    details: { affected: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length },
  }).catch(() => {});

  return { ok: true, results };
}

/**
 * MFA emergency off/on (D-26 §11) — S1 bypass report'da vaqtincha.
 * Feature flag `authMfaEmergencyOff` (D-21 pattern) — audit bilan.
 */
export async function mfaEmergencyOff({ reason = '', actorId = 'system' } = {}) {
  try {
    const { default: featureFlags } = await import('../../config/features.js');
    featureFlags.setOverride('authMfaEmergencyOff', true);
    await audit({
      action: AUDIT_ACTIONS.INCIDENT_MFA_EMERGENCY_OFF,
      resourceType: 'incident',
      details: { reason: String(reason || '').slice(0, 300) },
    }).catch(() => {});
    return { ok: true, enabled: true };
  } catch (_) {
    return { ok: false, error: 'flag_unavailable' };
  }
}

export async function mfaEmergencyOn({ actorId = 'system' } = {}) {
  try {
    const { default: featureFlags } = await import('../../config/features.js');
    featureFlags.setOverride('authMfaEmergencyOff', false);
    await audit({
      action: AUDIT_ACTIONS.INCIDENT_MFA_EMERGENCY_ON,
      resourceType: 'incident',
      details: {},
    }).catch(() => {});
    return { ok: true, enabled: false };
  } catch (_) {
    return { ok: false, error: 'flag_unavailable' };
  }
}
