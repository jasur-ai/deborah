/**
 * AUTH E-07 — Email budget (P2 upgrade): dynamic alert + monthly report + config UI
 * ---------------------------------------------------------------------------------
 * D-32 `recordEmailCost` faqat >100% chegarada audit yozardi; budget faqat
 * env'dan (EMAIL_MONTHLY_BUDGET_USD). E-07:
 *   - Dynamic alert: 80% (warn) + 100% (exceeded) — audit + dashboard banner.
 *   - Monthly report: CSV (month/provider/count/cost), admin'da download.
 *   - Budget config: admin panel'da sozlash (DB email_budget_config), env
 *     default saqlanadi (operator override).
 *
 * Saqlash: `email_budget_config` → { amount, updatedBy, updatedAt }.
 * Joriy oy xarajati `email_cost/{YYYY-MM}/*` dan yig'iladi.
 */

import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../auth/audit.js';

const BUDGET_CONFIG_PATH = 'email_budget_config';
const BUDGET_ALERT_PATH = 'email_budget_alerts'; // {month: {warn80, exceeded}} — idempotent audit
const BUDGET_MAX_USD = 100000; // xavfsizlik: absurd qiymatlar qabul qilinmaydi
const CONFIG_CACHE_TTL_MS = 60_000; // recordEmailCost har yuborishda o'qimaydi (1 daqiqa cache)

let configCache = { at: 0, value: null };

/** Testlar uchun cache'ni tozalaydi. */
export function _resetBudgetCache() {
  configCache = { at: 0, value: null };
}

function envBudget() {
  const v = Number(process.env.EMAIL_MONTHLY_BUDGET_USD || 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Joriy oy kaliti (YYYY-MM, local — UTC emas, O'zbekiston hisobi). */
export function currentMonth(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Budget qiymatini aniqlaydi: DB config (admin set qilgan) > env default.
 * 60s TTL cache — hot path (recordEmailCost) DB'ni spam qilmaydi;
 * setBudgetConfig cache'ni invalidate qiladi.
 */
export async function getBudgetConfig({ force = false } = {}) {
  const now = Date.now();
  if (!force && configCache.value && now - configCache.at < CONFIG_CACHE_TTL_MS) {
    return configCache.value;
  }
  let cfg = null;
  try {
    const snap = await fb.get(BUDGET_CONFIG_PATH);
    if (snap.exists()) {
      const raw = snap.val() || {};
      const v = Number(raw.amount || 0);
      if (Number.isFinite(v) && v > 0) cfg = { amount: v, source: 'db', updatedBy: raw.updatedBy || null, updatedAt: raw.updatedAt || 0 };
    }
  } catch (_) { /* fail-soft → env */ }
  const value = cfg || { amount: envBudget(), source: 'env', updatedBy: null, updatedAt: 0 };
  configCache = { at: now, value };
  return value;
}

/**
 * Budget'ni admin sozlaydi (DB). Validatsiya: 1..100000 USD (butun yoki
 * 2 xona). Audit EMAIL_BUDGET_CONFIG.
 * @returns {Promise<{ok:boolean, amount?:number, error?:string}>}
 */
export async function setBudgetConfig(amount, adminName = null) {
  const v = Number(amount);
  if (!Number.isFinite(v) || v < 1 || v > BUDGET_MAX_USD) {
    return { ok: false, error: 'invalid_amount' };
  }
  const rounded = Math.round(v * 100) / 100;
  await fb.set(BUDGET_CONFIG_PATH, {
    amount: rounded,
    updatedBy: adminName ? String(adminName).slice(0, 100) : null,
    updatedAt: Date.now(),
  });
  configCache = { at: Date.now(), value: { amount: rounded, source: 'db', updatedBy: adminName || null, updatedAt: Date.now() } }; // cache invalidate + yangi qiymat
  logAuthEvent({
    action: AUDIT_ACTIONS.EMAIL_BUDGET_CONFIG || 'email:budget:config',
    outcome: 'success',
    method: 'admin',
    actorId: adminName || null,
    details: { amount: rounded },
  }).catch(() => {});
  return { ok: true, amount: rounded };
}

/** Joriy oy xarajati (email_cost/{month}/* yig'indisi). */
export async function monthCost(month = currentMonth()) {
  try {
    const snap = await fb.get(`email_cost/${month}`);
    if (!snap.exists()) return { cost: 0, count: 0, providers: [] };
    const providers = Object.entries(snap.val() || {}).map(([provider, rec]) => ({
      provider,
      cost: Math.round(Number(rec.cost || 0) * 1000) / 1000,
      count: Number(rec.count || 0),
    }));
    return {
      cost: Math.round(providers.reduce((s, p) => s + p.cost, 0) * 1000) / 1000,
      count: providers.reduce((s, p) => s + p.count, 0),
      providers,
    };
  } catch (_) {
    return { cost: 0, count: 0, providers: [] };
  }
}

/**
 * Budget holati: level ok | warn (>=80%) | exceeded (>=100%).
 * PII yo'q — faqat raqamlar (admin dashboard).
 */
export async function budgetStatus(ts = Date.now()) {
  const month = currentMonth(ts);
  const [cfg, mc] = await Promise.all([getBudgetConfig(), monthCost(month)]);
  const pct = cfg.amount > 0 ? (mc.cost / cfg.amount) * 100 : 0;
  const level = cfg.amount <= 0 ? 'ok'
    : pct >= 100 ? 'exceeded'
    : pct >= 80 ? 'warn' : 'ok';
  return {
    month,
    budget: cfg.amount,
    budgetSource: cfg.source,
    monthCost: mc.cost,
    monthCount: mc.count,
    pct: Math.round(pct * 10) / 10,
    level,
    warnThresholdPct: 80,
  };
}

/** Joriy oy alert holati (idempotent): {warn80, exceeded}. */
export async function getBudgetAlerts(month = currentMonth()) {
  try {
    const snap = await fb.get(`${BUDGET_ALERT_PATH}/${month}`);
    if (snap.exists()) return snap.val() || {};
  } catch (_) { /* fail-soft */ }
  return {};
}

/**
 * Alert'ni bir marta yozadi (idempotent). Takroriy chaqiriq → false,
 * audit spam bo'lmaydi (recordEmailCost har yuborishda ishlaydi).
 */
export async function markBudgetAlert(month, key) {
  try {
    const snap = await fb.get(`${BUDGET_ALERT_PATH}/${month}`);
    const cur = snap.exists() ? snap.val() || {} : {};
    if (cur[key]) return false;
    await fb.set(`${BUDGET_ALERT_PATH}/${month}`, { ...cur, [key]: true, updatedAt: Date.now() });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Monthly report CSV (provider bo'yicha). Bosh qator:
 * oy,provider,count,cost_usd,updated_at
 */
export async function monthlyReportCsv(month = null) {
  const m = month || currentMonth();
  try {
    const snap = await fb.get('email_cost');
    const raw = snap.exists() ? snap.val() || {} : {};
    const lines = ['oy,provider,count,cost_usd'];
    const months = m ? [m] : Object.keys(raw).sort().reverse();
    for (const monthKey of months) {
      const providers = raw[monthKey] || {};
      for (const [provider, rec] of Object.entries(providers)) {
        const cost = Math.round(Number(rec.cost || 0) * 1000) / 1000;
        lines.push(`${monthKey},${String(provider).replace(/,/g, '_')},${Number(rec.count || 0)},${cost.toFixed(2)}`);
      }
    }
    return lines.join('\n') + '\n';
  } catch (_) {
    return 'oy,provider,count,cost_usd\n';
  }
}

/** Testlar uchun. */
export function _budgetEnvConfig() {
  return { envBudget: envBudget(), maxUsd: BUDGET_MAX_USD };
}
export { safeKey };
