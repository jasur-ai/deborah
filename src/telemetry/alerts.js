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

export default { RUNBOOKS, evaluateAlerts };
