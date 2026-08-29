/**
 * Deborah — Admin/Teacher Privilege Hardening (AUTH A-30)
 * -------------------------------------------------------------------
 * OWASP privileged-account hardening:
 *   - MFA mandatory (admin/teacher) — production'da DOIM (bypass yo'q),
 *     dev/test'da ADMIN_MFA_MANDATORY=true bilan yoqiladi (feature flag).
 *   - Admin session: SameSite=Strict, qisqa Max-Age (8 soat), absolute
 *     timeout, remember-me yo'q (high-privilege — A-30 §07).
 *   - Admin login lockout: 3 xato → 15 daqiqa (A-30 §08).
 *   - Admin IP allowlist (ixtiyoriy — OTM konteksti, A-30 §12).
 *   - Suspicious admin login (risk high) → block + super-admin alert (§14).
 *   - Admin breach → forced block (§13).
 *
 * Admin MFA record `mfa_totp/admin` (mfa-totp.js userId='admin') — top-level
 * path, mavjud MFA moduli (setup/enable/challenge/verify/reset) to'liq qayta
 * ishlatiladi. Admin security state `settings/admin_security` (PII minimal:
 * ip_hash + city agregatlari — raw IP hech qachon emas).
 *
 * @module admin-security
 */

import { fb } from '../../../firebase/admin.js';
import CONFIG from '../../config/env.js';
import { safeKey } from '../../../utils/helpers.js';
import { ipHash } from './new-device.js';
import { cityFromIp } from './geo-lite.js';
import { computeRiskScore, riskAction, travelFeasible } from './risk.js';

// ── Constants ──
export const ADMIN_MFA_ACCOUNT = 'admin'; // mfa_totp/admin — mfa-totp moduli userId
const ADMIN_SECURITY_PATH = 'settings/admin_security';
export const ADMIN_MFA_STEPUP_TTL_MS =
  (process.env.ADMIN_MFA_STEPUP_TTL_MS && Number(process.env.ADMIN_MFA_STEPUP_TTL_MS)) ||
  CONFIG.ADMIN_MFA_STEPUP_TTL_MS ||
  30 * 60 * 1000; // 30 daqiqa (guide §09)

/**
 * Admin/teacher MFA mandatory flag.
 * - production → DOIM true (bypass yo'q — guide stop condition).
 * - dev/test → ADMIN_MFA_MANDATORY=true bo'lsa (feature flag; test'lar buni
 *   beforeAll/afterAll'da toggle qiladi — env import vaqtida o'qilmaydi).
 * Live process.env o'qiladi — CONFIG singleton'ga bog'liq emas.
 */
export function adminMfaMandatory() {
  if (process.env.NODE_ENV === 'production') return true;
  const v = process.env.ADMIN_MFA_MANDATORY;
  return v === 'true' || v === '1';
}

/** Teacher (privileged user) uchun ham xuddi shu flag (guide §06). */
export function privilegedMfaMandatory() {
  return adminMfaMandatory();
}

/** Admin IP allowlist — ADMIN_IP_ALLOWLIST env (vergul bilan). */
export function adminIpAllowlist() {
  const raw = process.env.ADMIN_IP_ALLOWLIST || CONFIG.ADMIN_IP_ALLOWLIST || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** IPv4 CIDR tekshiruvi (masalan 203.0.113.0/24). */
function ipv4InCidr(ip, cidr) {
  const [net, bitsRaw] = cidr.split('/');
  const bits = parseInt(bitsRaw, 10);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipParts = ip.split('.').map(Number);
  const netParts = net.split('.').map(Number);
  if (ipParts.length !== 4 || netParts.length !== 4) return false;
  if (ipParts.some((n) => Number.isNaN(n)) || netParts.some((n) => Number.isNaN(n))) return false;
  const ipInt = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
  const netInt = ((netParts[0] << 24) | (netParts[1] << 16) | (netParts[2] << 8) | netParts[3]) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/** IP allowlist'da bormi? (exact yoki CIDR; bo'sh ro'yxat → hammaga ochiq). */
export function adminIpAllowed(ip, allowlist = adminIpAllowlist()) {
  if (!allowlist.length) return true;
  if (!ip) return false;
  return allowlist.some((entry) => {
    if (entry.includes('/')) return ipv4InCidr(ip, entry);
    return ip === entry;
  });
}

/** Admin security state'ni o'qiydi. */
export async function getAdminSecurity() {
  const snap = await fb.get(ADMIN_SECURITY_PATH);
  return snap.exists() ? snap.val() : {};
}

/** Admin security state'ni yangilaydi (patch merge). */
export async function updateAdminSecurity(patch) {
  const cur = await getAdminSecurity();
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  await fb.set(ADMIN_SECURITY_PATH, next);
  return next;
}

/**
 * Admin login lockout — 3 xato → 15 daqiqa (guide §08).
 * IKKI qatlam (A-30 review fix — DoS vektori yopildi):
 *   1) global `lockoutUntil` — guide'dagi account-level lockout. DoS qarshi:
 *      global counter faqat HAR XIL IP'dan kelgan birinchi xatolarni hisoblaydi
 *      — bitta IP cheksiz xato qilsa ham account bloklanmaydi (o'zi bloklanadi);
 *      3 xil IP'dan xato kelganda account blok (ko'p IP hujumi signal).
 *   2) per-IP `ip_failures.{ipHash}` — zararli IP o'zini bloklaydi, boshqa
 *      admin'lar kiraveradi.
 * @param {string|null} [ip] — per-IP bucket uchun (ipHash orqali, PII yo'q)
 * @returns {Promise<{locked: boolean, retryAfterSeconds: number, perIp?: boolean}>}
 */
export async function adminLoginLockoutCheck(ip = null) {
  const s = await getAdminSecurity();
  const now = Date.now();
  // 1) Global lockout (account-level)
  if (s.lockoutUntil && now < s.lockoutUntil) {
    return { locked: true, retryAfterSeconds: Math.ceil((s.lockoutUntil - now) / 1000) };
  }
  // 2) Per-IP lockout
  const nowIpH = ipHash(ip);
  const ipFail = nowIpH && s.ip_failures?.[nowIpH];
  if (ipFail && ipFail.until && now < ipFail.until) {
    return { locked: true, retryAfterSeconds: Math.ceil((ipFail.until - now) / 1000), perIp: true };
  }
  // Muddati o'tgan lockout — hisoblagichlar tozalanadi
  if (s.lockoutUntil && now >= s.lockoutUntil) {
    await updateAdminSecurity({ loginFailures: 0, lockoutUntil: 0 }).catch(() => {});
  }
  return { locked: false, retryAfterSeconds: 0 };
}

/**
 * Muvaffaqiyatsiz urinishni qayd qiladi → 3-chi xatoda 15 daqiqa lockout.
 * Global counter (har xil IP'lar) + per-IP bucket birga yuritiladi.
 */
export async function recordAdminLoginFailure(ip = null) {
  const maxFails = CONFIG.ADMIN_LOGIN_MAX_FAILURES ?? 3;
  const lockMs = CONFIG.ADMIN_LOGIN_LOCK_MS ?? 15 * 60 * 1000;
  const s = await getAdminSecurity();

  // Per-IP bucket yangilash (har doim)
  const nowIpH = ipHash(ip);
  const ipFailures = s.ip_failures || {};
  const prevIp = nowIpH ? ipFailures[nowIpH] : null;
  const ipCount = (prevIp?.count || 0) + 1;
  const ipLocked = nowIpH ? ipCount >= maxFails : false;
  if (nowIpH) {
    ipFailures[nowIpH] = ipLocked
      ? { count: 0, until: Date.now() + lockMs }
      : { count: ipCount, until: 0 };
  }

  // Global counter: faqat bu IP'dan BIRINCHI xato hisoblanadi (DoS qarshi —
  // bitta IP ko'p urinsa ham account bloklanmaydi; 3 xil IP hujum qilsa blok).
  const isNewIpH = Boolean(nowIpH) && !prevIp;
  const fails = (s.loginFailures || 0) + (isNewIpH ? 1 : 0);
  const globalLocked = fails >= maxFails;

  const patch = globalLocked
    ? { loginFailures: 0, lockoutUntil: Date.now() + lockMs, ip_failures: ipFailures }
    : { loginFailures: fails, ip_failures: ipFailures };
  await updateAdminSecurity(patch).catch(() => {});
  return {
    locked: globalLocked || ipLocked,
    retryAfterSeconds: (globalLocked || ipLocked) ? Math.ceil(lockMs / 1000) : 0,
    perIp: ipLocked && !globalLocked,
  };
}

/** Muvaffaqiyatli login → hisoblagichlar (global + per-IP) tozalanadi. */
export async function resetAdminLoginFailures() {
  await updateAdminSecurity({ loginFailures: 0, lockoutUntil: 0, ip_failures: {} }).catch(() => {});
}

/**
 * Suspicious admin login risk bahosi (guide §14) — A-28 risk moduli qayta
 * ishlatiladi. Signal'lar:
 *   - new_device: device_fp avvalgisidan farq qilsa (yoki birinchi marta)
 *   - impossible_travel: avvalgi shahar ↔ hozirgi shahar (server-side)
 *   - trusted_device: bir xil device_fp qaytsa
 * Fail-soft: signal yo'q → trusted (login buzilmaydi).
 *
 * @param {{ ip?: string, deviceFp?: string|null }} ctx
 * @param {Object} [prev] — admin security state (test uchun override)
 * @returns {Promise<{ score: number, tier: string, action: string, signals: string[] }>}
 */
export async function evaluateAdminRisk(ctx = {}, prev = null) {
  const state = prev || (await getAdminSecurity());
  const signals = {};
  const now = Date.now();
  const fp = typeof ctx.deviceFp === 'string' && /^[a-f0-9]{16,64}$/i.test(ctx.deviceFp)
    ? ctx.deviceFp.toLowerCase()
    : null;
  const city = ctx.ip ? cityFromIp(ctx.ip) : null;

  // Yangi qurilma: avvalgi device_fp bor va farq qiladi (yoki yangi login'da
  // avvalgi yo'q edi — birinchi login emas, chunki prev bo'sh bo'lsa signal yo'q)
  if (fp && state.lastDeviceFp && state.lastDeviceFp !== fp) {
    signals.new_device = true;
  }
  // Trusted qurilma: avvalgi bilan bir xil
  if (fp && state.lastDeviceFp && state.lastDeviceFp === fp) {
    signals.trusted_device = true;
  }
  // Impossible travel (server-side)
  if (state.lastCity && state.lastLoginAt && city && city !== state.lastCity) {
    if (!travelFeasible({ fromCity: state.lastCity, fromAt: state.lastLoginAt, toCity: city, toAt: now })) {
      signals.impossible_travel = true;
    }
  }

  const { score, tier, signals: active } = computeRiskScore(signals);
  return { score, tier, action: riskAction(tier), signals: active };
}

/** Super-admin alert yozuvi (guide §14) — settings/admin_alert (audit + payload). */
export async function notifySuperAdmin({ type, ip, details = {} }) {
  const entry = {
    type,
    at: Date.now(),
    ipHash: ipHash(ip),
    details,
  };
  await fb.set('settings/admin_alert', entry).catch(() => {});
  return entry;
}

export default {
  ADMIN_MFA_ACCOUNT,
  adminMfaMandatory,
  privilegedMfaMandatory,
  adminIpAllowlist,
  adminIpAllowed,
  getAdminSecurity,
  updateAdminSecurity,
  adminLoginLockoutCheck,
  recordAdminLoginFailure,
  resetAdminLoginFailures,
  evaluateAdminRisk,
  notifySuperAdmin,
};
