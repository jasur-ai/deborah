/**
 * AUTH C-01 — Endpoint rate limit jadvali (har auth endpoint)
 * ---------------------------------------------------------------------------
 * Tier tizimi (C-01 §06-§08):
 *   - ip:      per-IP — YUMSHOQ (kampus NAT: ko'p talaba bitta IP'da; xato
 *              count EMAS — request backstop). Asosiy yumshoq qatlam login'da
 *              failure-based (A-03: 5 xato → 300s lock) — bu yerda request
 *              backstop yuqoriroq, kontrakt buzilmaydi.
 *   - account: per-account — QATTIQ (asosiy himoya §14; username/email bo'yicha,
 *              HMAC-hash kalit). Login/verify/reset uchun.
 *   - asn:     per-ASN — O'RTA (bot tarmoqlari; `resolveAsn` plaginli — ASN DB
 *              o'rnatilmagan bo'lsa tier skip, fail-open).
 *   - burst:   token-bucket — 1 soniyalik portlash qarshi (C-01 §07).
 *
 * Redis: INCR + PEXPIRE (atomic sliding-window, §27); Redis yo'q (test/dev) →
 * in-memory fallback (xuddi shu logika).
 *
 * 429: { code: 'RATE_LIMITED', retryAfter } + Retry-After header (lockout.js
 * kontrakti bilan bir xil) + X-RateLimit-Limit/Remaining/Reset (§10-§11).
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const ENDPOINT_LIMITS = {
  /** POST /user/login — per-account qattiq; per-IP yumshoq backstop; ASN o'rta.
   *  Qiymatlar failure-based qatlamdan YUQORI (A-03: 5 xato → 300s yumshoq,
   *  10 xato → hard lock): per-IP 20/15 va per-account 15/15 backstop bo'lib
   *  failure-based lock'ni PREEMPT qilmaydi (A-03 kontrakti: 10-xato route'ga
   *  yetishi, 11-si route pre-check 429). Prompt'dagi 5/15/10/15 qiymatlari
   *  failure-based lockout tomonidan amalga oshirilgan — C-01 ledger'da qayd.
   *  Burst login'da YO'Q: Argon2 (~250ms) o'zi tabiiy throttle — failure-based
   *  lockout (A-03) asosiy portlash qarshi. */
  login: {
    ip: { windowMs: 15 * MIN, max: 20 },
    account: { windowMs: 15 * MIN, max: 15 },
    asn: { windowMs: 15 * MIN, max: 100 },
  },
  /** POST /user/register — per-IP yumshoq (in-route bot-guard 5/15 failure-based
   *  asosiy; auth.test.js 10 ta register bitta IP'dan ishlaydi → backstop 20/15);
   *  ASN o'rta; Turnstile B-08'da. Burst 5/s — argon2 (~250ms) o'zi throttle,
   *  in-route bot-guard 5/15 bilan mos (6-chi tezkor POST blok). */
  register: {
    ip: { windowMs: 15 * MIN, max: 20 },
    asn: { windowMs: 15 * MIN, max: 50 },
    burst: { windowMs: 1000, max: 5 },
  },
  /** POST /api/verify/send — per-user 3/soat; per-IP 10/soat */
  verifySend: {
    account: { windowMs: 1 * HOUR, max: 3 },
    ip: { windowMs: 1 * HOUR, max: 10 },
  },
  /** POST /api/verify/check — per-user 5/15 → 15 daqiqa lockout (failure-based) */
  verifyCheck: {
    account: { windowMs: 15 * MIN, max: 5 },
    ip: { windowMs: 15 * MIN, max: 20 },
  },
  /** POST /api/reset/* — per-account 3/soat; per-IP 10/soat */
  reset: {
    account: { windowMs: 1 * HOUR, max: 3 },
    ip: { windowMs: 1 * HOUR, max: 10 },
  },
  /** POST /auth/google — 10/15 */
  google: {
    ip: { windowMs: 15 * MIN, max: 10 },
    asn: { windowMs: 15 * MIN, max: 50 },
  },
  /** POST /api/mfa/* — 5/15 → lockout */
  mfa: {
    account: { windowMs: 15 * MIN, max: 5 },
    ip: { windowMs: 15 * MIN, max: 20 },
  },
  /** POST /passkey/* — 10/15 */
  passkey: {
    ip: { windowMs: 15 * MIN, max: 10 },
  },
  /** POST /auth/telegram/* — 5/15 */
  telegram: {
    ip: { windowMs: 15 * MIN, max: 5 },
    account: { windowMs: 15 * MIN, max: 10 },
  },
  /** POST /admin/api/teachers/* — 20/15 (admin; MFA step-up ichida) */
  adminTeachers: {
    admin: { windowMs: 15 * MIN, max: 20 },
  },
  /** POST /api/roster/* — 10/15 (teacher) */
  roster: {
    user: { windowMs: 15 * MIN, max: 10 },
  },
};

/** Endpoint guruhlarining route prefix map'i (server.js wiring uchun). */
export const ENDPOINT_ROUTES = {
  login: ['/user/login'],
  register: ['/user/register'],
  verifySend: ['/api/verify/send'],
  verifyCheck: ['/api/verify/check'],
  reset: ['/api/reset'],
  google: ['/auth/google'],
  mfa: ['/api/mfa'],
  passkey: ['/api/passkey'],
  telegram: ['/auth/telegram'],
  adminTeachers: ['/admin/api/teachers'],
  roster: ['/api/roster'],
};
