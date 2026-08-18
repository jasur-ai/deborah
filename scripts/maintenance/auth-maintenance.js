/**
 * Edikit — Auth Maintenance (AUTH D-28)
 * ---------------------------------------------------------------------------
 * Maintenance runbook operator script'larining audit/log qismi.
 *
 * Printsip: barcha maintenance amallari `maintenance_log`'ga yoziladi (audit
 * `maintenance:*` event'lari orqali) — §11. PII MINIMAL (§12): log'da hech
 * qachon email/telegram_id/IP to'liq yozilmaydi — faqat owner key + hash.
 *
 * Scriptlar (runbook bilan birga ishlatiladi):
 *   - logMaintenance(action, detail)      — umumiy maintenance yozuvi
 *   - runDrill(kind)                      — backup / incident drill (append-only)
 *   - checkSecretAge()                    — secret rotation 90 kun (D-02, §09)
 *   - listAuthDeps()                      — auth lib'lar ro'yxati (CVE skan uchun, §08)
 *   - scanCve(deps)                       — CI'da npm audit natijasini log qiladi
 *   - syncHibp() / updateDisposable()     — oylik task stub (operator qo'lda, log yozadi)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { fb } from '../../firebase/admin.js';
import { audit, AUDIT_ACTIONS } from '../../src/modules/auth/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SECRET_ROTATION_DAYS = 90; // D-02 §09

/** Auth-ga bog'liq tashqi kutubxonalar (CVE scan listesi — §08). */
export const AUTH_DEPS = [
  'argon2',
  '@simplewebauthn/server',
  '@simplewebauthn/browser',
  'otplib',
  'postmark',
  'express-session',
  'cookie-parser',
];

/** Append-only maintenance log yozuvi (audit orqali — PII minimal §12). */
export async function logMaintenance({ action, detail = '', operator = 'system', result = 'ok' } = {}) {
  const now = Date.now();
  const entry = {
    at: now,
    action: String(action || 'maintenance:log').slice(0, 80),
    detail: String(detail || '').slice(0, 500),
    operator: String(operator).slice(0, 100),
    result: ['ok', 'warn', 'fail'].includes(result) ? result : 'ok',
    // PII minimal: operator key hash (email/IP yozilmaydi)
    operatorHash: crypto.createHash('sha256').update(String(operator)).digest('hex').slice(0, 16),
  };
  const id = `${now}-${crypto.randomBytes(4).toString('hex')}`;
  await fb.set(`maintenance_log/${id}`, entry);

  await audit({
    action: AUDIT_ACTIONS.MAINTENANCE_LOG,
    resourceType: 'maintenance_log',
    resourceId: id,
    details: { action: entry.action, result: entry.result, detail: entry.detail },
    ipAddress: null,
  }).catch(() => {});

  return { ok: true, id, entry };
}

/** Drill yozuvi (append-only — backup/incident drill, §07 oylik). */
export async function runDrill({ kind = 'backup_restore', operator = 'system', passed = true, notes = '' } = {}) {
  if (!['backup_restore', 'incident'].includes(kind)) return { ok: false, error: 'invalid_kind' };
  const res = await logMaintenance({
    action: `drill:${kind}`,
    detail: `${passed ? 'PASS' : 'FAIL'} ${notes}`,
    operator,
    result: passed ? 'ok' : 'fail',
  });
  if (res.ok) {
    await audit({
      action: AUDIT_ACTIONS.MAINTENANCE_DRILL,
      resourceType: 'drill',
      resourceId: res.id,
      details: { kind, passed },
      ipAddress: null,
    }).catch(() => {});
  }
  return res;
}

/** Secret rotation yoshi — last rotation faylidan 90 kun o'tganini tekshiradi (§09). */
export function checkSecretAge({ dir = path.join(__dirname, '../../../data/security'), days = SECRET_ROTATION_DAYS } = {}) {
  const stampPath = path.join(dir, 'last-secret-rotation');
  if (!fs.existsSync(stampPath)) {
    return { ok: true, due: true, ageDays: null, reason: 'no_stamp_file' };
  }
  const stamp = Number(fs.readFileSync(stampPath, 'utf8').trim());
  if (!Number.isFinite(stamp) || stamp <= 0) {
    return { ok: true, due: true, ageDays: null, reason: 'invalid_stamp' };
  }
  const ageMs = Date.now() - stamp;
  const ageDays = Math.floor(ageMs / 86_400_000);
  return { ok: true, due: ageDays >= days, ageDays, days, reason: ageDays >= days ? 'rotation_due' : 'within_window' };
}

/** Rotation bajarilganda stamp yangilaydi (KMS operatori chaqiradi — §09). */
export async function markSecretRotated({ operator = 'system', dir = path.join(__dirname, '../../../data/security') } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'last-secret-rotation'), String(Date.now()));
  const res = await logMaintenance({ action: 'secret:rotation', operator, result: 'ok' });
  if (res.ok) {
    await audit({
      action: AUDIT_ACTIONS.MAINTENANCE_ROTATED,
      resourceType: 'secret',
      resourceId: 'rotation-stamp',
      details: { operatorHash: res.entry.operatorHash },
      ipAddress: null,
    }).catch(() => {});
  }
  return res;
}

/** Auth dep'lar ro'yxati (CVE scan — CI'da `npm audit` bilan birga, §08/§17). */
export function listAuthDeps() {
  return [...AUTH_DEPS];
}

/** CVE scan natijasini maintenance_log'ga yozadi (CI step — §08). */
export async function scanCve({ ok = true, findings = [], operator = 'system' } = {}) {
  const res = await logMaintenance({
    action: 'cve:scan',
    detail: `vulns=${findings.length} ${findings.slice(0, 5).join(',')}`,
    operator,
    result: ok ? 'ok' : 'fail',
  });
  if (res.ok) {
    await audit({
      action: AUDIT_ACTIONS.MAINTENANCE_CVE_SCAN,
      resourceType: 'cve',
      resourceId: res.id,
      details: { ok, vulnCount: findings.length },
      ipAddress: null,
    }).catch(() => {});
  }
  return res;
}

/** Oylik HIBP sync stub — operator qo'lda ishga tushiradi (log yozadi, §07). */
export async function syncHibp({ operator = 'system', updated = 0 } = {}) {
  return logMaintenance({ action: 'hibp:sync', detail: `updated=${updated}`, operator });
}

/** Oylik disposable-list update stub (log yozadi, §07). */
export async function updateDisposable({ operator = 'system', updated = 0 } = {}) {
  return logMaintenance({ action: 'disposable:update', detail: `updated=${updated}`, operator });
}

/** Yillik provider review log (Google/Postmark/HEMIS terms — §10). */
export async function providerReview({ operator = 'system', providers = [], due = false } = {}) {
  const res = await logMaintenance({
    action: 'provider:review',
    detail: `due=${due} providers=${providers.join(',')}`,
    operator,
  });
  if (res.ok) {
    await audit({
      action: AUDIT_ACTIONS.MAINTENANCE_PROVIDER_REVIEW,
      resourceType: 'provider_review',
      resourceId: res.id,
      details: { providers, due },
      ipAddress: null,
    }).catch(() => {});
  }
  return res;
}
