/**
 * Edikit — Alert Rules & Runbook Annotations (Prompt 69 §13-14)
 *
 * research.md §38.5 incident runbooks + §38.4 SLO:
 *   - SLO burn-rate alerts (fast/critical burn)
 *   - Provider circuit: error rate / latency threshold
 *   - Cost / quota: AI provider cost spike, quota near limit
 *   - Har alert runbook link bilan annotatsiyalanadi.
 *
 * PURE: snapshot + slo natijalaridan alertlar hisoblanadi.
 */

import { evaluateSlo } from './slo.js';

// ── Runbook annotatsiyalari (research §38.5) ──
export const RUNBOOKS = {
  db_unavailable: { label: 'DB unavailable', path: '/docs/runbooks/db-unavailable.md' },
  socket_outage: { label: 'Socket outage', path: '/docs/runbooks/socket-outage.md' },
  provider_outage: { label: 'Provider outage', path: '/docs/runbooks/provider-outage.md' },
  answer_leak: { label: 'Answer leak', path: '/docs/runbooks/answer-leak.md' },
  wrong_answer_key: { label: 'Wrong answer key', path: '/docs/runbooks/wrong-answer-key.md' },
  mass_false_flags: { label: 'Mass false proctor flags', path: '/docs/runbooks/mass-false-flags.md' },
  camera_breach: { label: 'Camera storage breach', path: '/docs/runbooks/camera-breach.md' },
  oauth_revoked: { label: 'Google OAuth revoked', path: '/docs/runbooks/oauth-revoked.md' },
  roster_bad_import: { label: 'Roster bad import', path: '/docs/runbooks/roster-bad-import.md' },
  ai_score_drift: { label: 'AI score drift', path: '/docs/runbooks/ai-score-drift.md' },
  incorrect_grade_release: { label: 'Incorrect grade release', path: '/docs/runbooks/incorrect-grade-release.md' },
  // AUTH D-06 §08/§09 — auth runbooks
  auth_fail_spike: { label: 'Auth fail spike', path: '/docs/runbooks/auth-fail-spike.md' },
  auth_lockout_spike: { label: 'Auth lockout spike', path: '/docs/runbooks/auth-lockout-spike.md' },
  auth_email_bounce: { label: 'Email bounce high', path: '/docs/runbooks/email-delivery.md' },
  auth_risk_block: { label: 'Risk block spike', path: '/docs/runbooks/auth-risk-block.md' },
  auth_rate_limit_abuse: { label: 'Rate-limit abuse', path: '/docs/runbooks/auth-rate-limit-abuse.md' },
};

/**
 * Evaluate all alert rules.
 * @param {{ histograms: object[], counters: object[], gauges: object[] }} snapshot
 * @param {{ now?: number, sinceMs?: number, costBudgetCents?: number, quotaWarningFraction?: number }} opts
 * @returns {object[]} fired alerts
 */
export function evaluateAlerts(snapshot, opts = {}) {
  const alerts = [];
  const sinceMs = opts.sinceMs || (30 * 24 * 60 * 60 * 1000);

  // ── 1. SLO burn-rate alerts ──
  const sloResults = evaluateSlo(snapshot, { sinceMs });
  for (const slo of sloResults) {
    if (slo.level === 'critical') {
      alerts.push({
        id: `slo_critical_${slo.id}`,
        severity: 'critical',
        title: `SLO kritik: ${slo.name}`,
        message: `Burn-rate ${slo.burnRate !== null ? slo.burnRate.toFixed(2) + 'x' : '—'}, error rate ${(slo.errorRate || 0).toFixed(4)}`,
        runbook: slo.runbook,
        sloId: slo.id,
      });
    } else if (slo.level === 'warning') {
      alerts.push({
        id: `slo_warning_${slo.id}`,
        severity: 'warning',
        title: `SLO ogohlantirish: ${slo.name}`,
        message: `Burn-rate ${slo.burnRate !== null ? slo.burnRate.toFixed(2) + 'x' : '—'}`,
        runbook: slo.runbook,
        sloId: slo.id,
      });
    }
  }

  // ── 2. Provider circuit alerts ──
  const providerReq = sumCounter(snapshot, (n) => n.startsWith('edikit_provider_requests_total'));
  const providerErr = sumCounter(snapshot, (n) => n.startsWith('edikit_provider_errors_total'));
  if (providerReq > 20) {
    const errRate = providerErr / providerReq;
    if (errRate >= 0.25) {
      alerts.push({
        id: 'provider_circuit_open',
        severity: 'critical',
        title: 'Provider circuit OPEN',
        message: `Error rate ${(errRate * 100).toFixed(1)}% (≥25%)`,
        runbook: RUNBOOKS.provider_outage.path,
      });
    } else if (errRate >= 0.1) {
      alerts.push({
        id: 'provider_circuit_half_open',
        severity: 'warning',
        title: 'Provider error rate yuqori',
        message: `Error rate ${(errRate * 100).toFixed(1)}% (≥10%)`,
        runbook: RUNBOOKS.provider_outage.path,
      });
    }
  }

  // ── 3. Cost / quota alerts ──
  const costCents = sumCounter(snapshot, (n) => n.startsWith('edikit_provider_cost_cents_total'));
  const costBudget = opts.costBudgetCents || 50000; // $500 default
  if (costCents >= costBudget) {
    alerts.push({
      id: 'ai_cost_over_budget',
      severity: 'warning',
      title: 'AI provider cost budget oshdi',
      message: `Jami $${(costCents / 100).toFixed(2)} ≥ budget $${(costBudget / 100).toFixed(2)}`,
      runbook: RUNBOOKS.provider_outage.path,
    });
  }

  // ── 4. AUTH D-06 §08: auth abuse/spike alert'lari (burn-rate qoidalari) ──
  const sumL = (name, pred) => (snapshot.counters || [])
    .filter((c) => c.name === name && (!pred || pred(c.labels || {})))
    .reduce((a, c) => a + c.value, 0);

  // 4.1 Fail spike: auth_login_total{outcome:'failed'} ulushi ≥ 50% (≥20 login)
  const authLoginTotal = sumL('auth_login_total', () => true);
  const authLoginFailed = sumL('auth_login_total', (l) => l.outcome === 'failed');
  if (authLoginTotal >= 20) {
    const failRate = authLoginFailed / authLoginTotal;
    if (failRate >= 0.5) {
      alerts.push({
        id: 'auth_fail_spike',
        severity: 'critical',
        title: 'Login fail spike',
        message: `Fail rate ${(failRate * 100).toFixed(1)}% (≥50%)`,
        runbook: RUNBOOKS.auth_fail_spike.path,
      });
    } else if (failRate >= 0.3) {
      alerts.push({
        id: 'auth_fail_spike_warn',
        severity: 'warning',
        title: 'Login fail rate yuqori',
        message: `Fail rate ${(failRate * 100).toFixed(1)}% (≥30%)`,
        runbook: RUNBOOKS.auth_fail_spike.path,
      });
    }
  }

  // 4.2 Lockout spike: auth_lockout_total ≥ 20
  const lockouts = sumL('auth_lockout_total', () => true);
  if (lockouts >= 20) {
    alerts.push({
      id: 'auth_lockout_spike',
      severity: 'warning',
      title: 'Lockout spike',
      message: `${lockouts} ta lockout (≥20)`,
      runbook: RUNBOOKS.auth_lockout_spike.path,
    });
  }

  // 4.3 Email bounce >5%: auth_email_delivery_total{status:'bounce|deadletter'} / total
  const emailSentN = sumL('auth_email_delivery_total', (l) => l.status === 'sent');
  const emailBad = sumL('auth_email_delivery_total', (l) => l.status === 'bounce' || l.status === 'deadletter');
  const emailTot = emailSentN + emailBad;
  if (emailTot >= 20) {
    const bounceRate = emailBad / emailTot;
    if (bounceRate > 0.05) {
      alerts.push({
        id: 'auth_email_bounce',
        severity: bounceRate > 0.1 ? 'critical' : 'warning',
        title: 'Email bounce >5%',
        message: `Bounce rate ${(bounceRate * 100).toFixed(1)}% (chegara 5%)`,
        runbook: RUNBOOKS.auth_email_bounce.path,
      });
    }
  }

  // 4.4 Risk block spike: auth_risk_block_total ≥ 10
  const riskBlocks = sumL('auth_risk_block_total', () => true);
  if (riskBlocks >= 10) {
    alerts.push({
      id: 'auth_risk_block_spike',
      severity: 'warning',
      title: 'Risk block spike',
      message: `${riskBlocks} ta risk blok (≥10)`,
      runbook: RUNBOOKS.auth_risk_block.path,
    });
  }

  // 4.5 Rate-limit abuse: auth_rate_limit_hit_total ≥ 100
  const rateHits = sumL('auth_rate_limit_hit_total', () => true);
  if (rateHits >= 100) {
    alerts.push({
      id: 'auth_rate_limit_abuse',
      severity: 'warning',
      title: 'Rate-limit abuse',
      message: `${rateHits} ta rate-limit (≥100)`,
      runbook: RUNBOOKS.auth_rate_limit_abuse.path,
    });
  }

  // Quota — gauge edikit_provider_quota_fraction (0..1)
  const quotaGauges = (snapshot.gauges || []).filter((g) => g.name === 'edikit_provider_quota_fraction');
  for (const g of quotaGauges) {
    const quotaUsed = g.value;
    const quotaWarn = opts.quotaWarningFraction || 0.8;
    if (quotaUsed >= quotaWarn) {
      alerts.push({
        id: `provider_quota_${g.labels?.provider || 'unknown'}`,
        severity: quotaUsed >= 0.95 ? 'critical' : 'warning',
        title: `Provider quota ${(quotaUsed * 100).toFixed(0)}%`,
        message: `Quota iste'moli ${(quotaUsed * 100).toFixed(1)}% (${g.labels?.provider || 'unknown'})`,
        runbook: RUNBOOKS.provider_outage.path,
      });
    }
  }

  return alerts;
}

function sumCounter(snapshot, matchFn) {
  return (snapshot.counters || [])
    .filter((c) => matchFn(c.name))
    .reduce((a, c) => a + c.value, 0);
}

// ── AUTH D-06 §11: fired alert dedupe (idempotent audit — takroriy log yo'q) ──
// Alert id bo'yicha oxirgi fire vaqti; ALERT_AUDIT_COOLDOWN_MS ichida qayta
// audit YOZILMAYDI. In-memory (worker restart → qayta log mumkin, ops ok).
const firedAt = new Map();
const ALERT_AUDIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 daqiqa

export const ALERT_AUDIT_COOLDOWN = ALERT_AUDIT_COOLDOWN_MS;

/**
 * Fired alert'lar uchun audit log'ga tayyor ro'yxat — cooldown'da bo'lganlar
 * o'tkazib yuboriladi (idempotent). PURE: hech qanday I/O bajarilmaydi.
 * @param {object[]} alerts - evaluateAlerts() natijasi
 * @param {{ now?: number }} [opts]
 * @returns {object[]} audit qilinishi kerak bo'lgan alert'lar
 */
export function dueAlertAudits(alerts, opts = {}) {
  const now = opts.now || Date.now();
  const due = [];
  for (const alert of alerts || []) {
    const last = firedAt.get(alert.id) || 0;
    if (now - last < ALERT_AUDIT_COOLDOWN_MS) continue;
    firedAt.set(alert.id, now);
    due.push(alert);
  }
  return due;
}

/** Testlar uchun dedupe holatini tozalash. */
export function _resetAlertAuditState() {
  firedAt.clear();
}

export default { RUNBOOKS, evaluateAlerts, dueAlertAudits, ALERT_AUDIT_COOLDOWN, _resetAlertAuditState };
