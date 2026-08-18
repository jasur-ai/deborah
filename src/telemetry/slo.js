/**
 * Deborah — SLO Definitions & Burn-Rate (Prompt 69 §12)
 *
 * research.md §38.4 SLO misollari asosida:
 *   - answer save availability 99.95% exam window
 *   - p95 ACK < 500ms
 *   - data-loss 0
 *   - reconnect recovery ≥ 99.9%
 *   - scheduled exam open within ±5s
 *   - grading job 95% agreed SLA
 *
 * Burn-rate: error budget iste'mol tezligi. SLO window bo'yicha
 *   burnRate = errorRate / errorBudgetFraction
 *   - burnRate > 1  → budget sarflanmoqda
 *   - burnRate ≥ 14.4 (2% budget/30d, 6 soatda) → critical fast burn
 *   - burnRate ≥ 6  → warning
 *
 * PURE: hisoblash logikasi, I/O yo'q.
 *
 * STUB SLO'LAR (scaffold): ack_p95_latency, grading_job_sla va
 * reconnect_recovery SLO'lari hozircha production producer'larsiz — ular
 * o'lchanadigan metriclar (deborah_ack_latency_ms, deborah_grading_jobs_total,
 * deborah_socket_reconnect_total) socket/grading flow'lariga ulanganda jonli
 * ma'lumot ko'rsatadi. answer_save_availability esa allqachon real
 * (deborah_answer_save_duration + deborah_answer_save_errors_total).
 */

// ── SLO ta'riflari ──
export const SLOS = [
  {
    id: 'answer_save_availability',
    name: "Javob saqlash mavjudligi",
    type: 'availability', // good / total
    target: 0.9995,       // 99.95%
    windowMs: 30 * 24 * 60 * 60 * 1000, // 30 kun
    burnWindowHours: 6,
    runbook: '/docs/runbooks/answer-save.md',
    description: 'Imtihon oynasida javob saqlash 99.95% mavjud bo\'lishi kerak',
  },
  {
    id: 'ack_p95_latency',
    name: 'ACK p95 < 500ms',
    type: 'latency_p95',  // p95 ms
    targetMs: 500,
    windowMs: 24 * 60 * 60 * 1000,
    burnWindowHours: 6,
    runbook: '/docs/runbooks/socket-outage.md',
    description: 'Javob ACK p95 kechikishi 500ms dan oshmasligi kerak',
  },
  {
    id: 'reconnect_recovery',
    name: 'Reconnect recovery',
    type: 'availability',
    target: 0.999, // ≥ 99.9%
    windowMs: 30 * 24 * 60 * 60 * 1000,
    burnWindowHours: 6,
    runbook: '/docs/runbooks/socket-outage.md',
    description: 'Uzilgan ulanishlarning ≥99.9% muvaffaqiyatli tiklanishi kerak',
  },
  {
    id: 'grading_job_sla',
    name: 'Grading job SLA',
    type: 'availability',
    target: 0.95, // 95%
    windowMs: 7 * 24 * 60 * 60 * 1000,
    burnWindowHours: 24,
    runbook: '/docs/runbooks/ai-score-drift.md',
    description: 'Grading job\'larining 95% kelishilgan muddatda yakunlanishi',
  },
  {
    id: 'data_loss_zero',
    name: 'Data-loss 0',
    type: 'availability',
    target: 1.0,
    windowMs: 30 * 24 * 60 * 60 * 1000,
    burnWindowHours: 6,
    runbook: '/docs/runbooks/answer-leak.md',
    description: 'Javoblar yo\'qolmasligi — 100% saqlanishi',
  },
  // ── AUTH D-06 §07 — auth SLO'lar ──
  {
    id: 'auth_login_success_rate',
    name: 'Login muvaffaqiyat darajasi',
    type: 'availability',
    target: 0.90, // >90% (2 hafta)
    windowMs: 14 * 24 * 60 * 60 * 1000,
    burnWindowHours: 6,
    runbook: '/docs/runbooks/auth-login-spike.md',
    description: 'Login urinishlarining >90% muvaffaqiyatli (2 hafta oyna)',
  },
  {
    id: 'auth_login_latency_p95',
    name: 'Login p95 < 2s',
    type: 'latency_p95',
    targetMs: 2000,
    windowMs: 24 * 60 * 60 * 1000,
    burnWindowHours: 6,
    runbook: '/docs/runbooks/auth-login-latency.md',
    description: 'Login p95 kechikishi 2 soniyadan oshmasligi kerak',
  },
  {
    id: 'auth_email_deliverability',
    name: 'Email yetkazish > 90%',
    type: 'availability',
    target: 0.90,
    windowMs: 14 * 24 * 60 * 60 * 1000,
    burnWindowHours: 6,
    runbook: '/docs/runbooks/email-delivery.md',
    description: 'Yuborilgan email\'larning >90% inbox\'ga yetkazilishi (bounce <10%)',
  },
  {
    id: 'auth_availability',
    name: 'Auth mavjudligi',
    type: 'availability',
    target: 0.999, // 99.9%
    windowMs: 30 * 24 * 60 * 60 * 1000,
    burnWindowHours: 6,
    runbook: '/docs/runbooks/auth-outage.md',
    description: 'Auth endpointlar 99.9% mavjud (5xx = xato)',
  },
];

/** SLO'ni id bo'yicha topish. */
export function getSlo(id) {
  return SLOS.find((s) => s.id === id) || null;
}

/**
 * Availability SLO uchun current status + burn rate.
 * @param {{ good: number, total: number, sinceMs?: number }} data
 * @param {{ target: number, windowMs: number, burnWindowHours?: number }} slo
 * @returns {{ ok: boolean, errorRate: number, burnRate: number|null, errorBudgetRemaining: number, level: 'ok'|'warning'|'critical' }}
 */
export function computeAvailability({ good = 0, total = 0, sinceMs = 0 }, slo) {
  const target = slo?.target || 0.99;
  const windowMs = slo?.windowMs || 30 * 24 * 60 * 60 * 1000;
  const burnHours = slo?.burnWindowHours || 6;

  const errorRate = total > 0 ? (total - good) / total : 0;
  const errorBudget = 1 - target;
  const errorBudgetRemaining = Math.max(0, (errorBudget - errorRate) / errorBudget);

  // Burn-rate faqat window bo'ylab ma'lumot yetarli bo'lsa.
  // sinceMs = ma'lumot qancha vaqtdan beri yig'ilgan.
  let burnRate = null;
  if (errorBudget > 0 && total > 0 && sinceMs > 0) {
    const windowRatio = Math.min(1, sinceMs / windowMs);
    const budgetConsumedRatio = windowRatio > 0 ? errorRate / (errorBudget * windowRatio) : 0;
    burnRate = budgetConsumedRatio;
  } else if (errorBudget > 0 && total > 0) {
    burnRate = errorRate / errorBudget;
  }

  let level = 'ok';
  if (burnRate !== null) {
    if (burnRate >= 14.4) level = 'critical';
    else if (burnRate >= 6) level = 'warning';
  }
  if (level === 'ok' && errorRate > errorBudget) level = 'warning';

  return {
    // Availability SLO: errorRate budget'ni oshirmasligi kerak
    // (target = availability 0.9995 → errorBudget = 0.0005)
    ok: errorRate <= errorBudget + 1e-9,
    errorRate,
    burnRate,
    errorBudgetRemaining,
    level,
    target,
    windowMs,
  };
}

/**
 * Latency p95 SLO: p95 <= targetMs.
 * @param {{ p95: number }} data
 * @param {{ targetMs: number }} slo
 */
export function computeLatencyP95({ p95 = 0 }, slo) {
  const targetMs = slo?.targetMs || 500;
  const ratio = targetMs > 0 ? p95 / targetMs : 0;
  let level = 'ok';
  if (ratio >= 1.5) level = 'critical';
  else if (ratio >= 1.0) level = 'warning';
  return {
    ok: p95 <= targetMs,
    p95,
    targetMs,
    ratio,
    level,
  };
}

/**
 * Evaluate ALL SLOs from a metrics snapshot.
 * @param {{ histograms: object[], counters: object[] }} snapshot - snapshotMetrics() natijasi
 * @param {{ now?: number, sinceMs?: number }} opts
 * @returns {object[]} har bir SLO uchun status
 */
export function evaluateSlo(snapshot, opts = {}) {
  const now = opts.now || Date.now();
  const sinceMs = opts.sinceMs || (30 * 24 * 60 * 60 * 1000);

  // ── Answer save: histogram 'deborah_answer_save_duration' count vs good ──
  // Soddalashtirilgan: answer_save histogram'idagi 500ms dan past bo'lganlar "good".
  const answerHist = (snapshot.histograms || []).find((h) => h.name === 'deborah_answer_save_duration');
  const total = answerHist?.count || 0;
  // good = count - (xatolar) — biz xatolarni alohida counter'da tutamiz.
  const answerErrors = (snapshot.counters || [])
    .filter((c) => c.name === 'deborah_answer_save_errors_total')
    .reduce((a, c) => a + c.value, 0);
  const good = Math.max(0, total - answerErrors);

  const ackHist = (snapshot.histograms || []).find((h) => h.name === 'deborah_ack_latency_ms');
  const reconnect = (snapshot.counters || [])
    .filter((c) => c.name === 'deborah_reconnect_total' || c.name === 'deborah_socket_reconnect_total')
    .reduce((a, c) => a + c.value, 0);
  const reconnectOk = (snapshot.counters || [])
    .filter((c) => c.name === 'deborah_reconnect_ok_total' || c.name === 'deborah_socket_reconnect_ok_total')
    .reduce((a, c) => a + c.value, 0);

  const gradingTotal = (snapshot.counters || [])
    .filter((c) => c.name === 'deborah_grading_jobs_total')
    .reduce((a, c) => a + c.value, 0);
  const gradingOk = (snapshot.counters || [])
    .filter((c) => c.name === 'deborah_grading_jobs_ok_total')
    .reduce((a, c) => a + c.value, 0);

  // ── AUTH D-06 §07: auth SLO ma'lumotlari (Prometheus nomli counter'lar) ──
  // auth_login_total{method,outcome}, auth_register_total, auth_verify_total,
  // auth_email_delivery_total{status}, auth_login_duration_histogram (histogram).
  const sumByNameLabel = (name, labelPred) => (snapshot.counters || [])
    .filter((c) => c.name === name && (!labelPred || labelPred(c.labels || {})))
    .reduce((a, c) => a + c.value, 0);
  const loginTotal = sumByNameLabel('auth_login_total', () => true);
  const loginSuccess = sumByNameLabel('auth_login_total', (l) => l.outcome === 'success');
  const loginFail = loginTotal - loginSuccess;
  const registerTotal = sumByNameLabel('auth_register_total', () => true);
  const verifyTotal = sumByNameLabel('auth_verify_total', () => true);
  const emailSent = sumByNameLabel('auth_email_delivery_total', (l) => l.status === 'sent');
  const emailFailed = sumByNameLabel('auth_email_delivery_total', (l) => l.status === 'bounce' || l.status === 'deadletter');
  const emailTotal = emailSent + emailFailed;
  const loginHist = (snapshot.histograms || []).find((h) => h.name === 'auth_login_duration_histogram');

  return SLOS.map((slo) => {
    const base = { id: slo.id, name: slo.name, runbook: slo.runbook, description: slo.description };
    if (slo.type === 'latency_p95') {
      // auth_login_latency_p95 → auth_login_duration_histogram; boshqa p95 SLO'lar ackHist
      const hist = slo.id === 'auth_login_latency_p95' ? loginHist : ackHist;
      const r = computeLatencyP95({ p95: hist?.p95 || 0 }, slo);
      return { ...base, type: slo.type, ...r };
    }
    // availability-type
    let goodN = 0;
    let totalN = 0;
    if (slo.id === 'answer_save_availability') { goodN = good; totalN = total; }
    else if (slo.id === 'reconnect_recovery') { goodN = reconnectOk; totalN = reconnect; }
    else if (slo.id === 'grading_job_sla') { goodN = gradingOk; totalN = gradingTotal; }
    else if (slo.id === 'data_loss_zero') {
      // Data loss = answer_save_errors; total = answer attempts
      goodN = Math.max(0, total - answerErrors);
      totalN = total;
    }
    else if (slo.id === 'auth_login_success_rate') { goodN = loginSuccess; totalN = loginTotal; }
    else if (slo.id === 'auth_email_deliverability') { goodN = emailSent; totalN = emailTotal; }
    else if (slo.id === 'auth_availability') {
      // Auth endpoint mavjudligi — login/register/verify umumiy xato ulushi.
      // loginSuccess allaqachon fail'lar chiqarilgan — qayta ayirilmaydi.
      goodN = loginSuccess + registerTotal + verifyTotal;
      totalN = loginTotal + registerTotal + verifyTotal;
    }
    const r = computeAvailability({ good: goodN, total: totalN, sinceMs }, slo);
    return { ...base, type: slo.type, ...r };
  });
}

export default { SLOS, getSlo, computeAvailability, computeLatencyP95, evaluateSlo };
