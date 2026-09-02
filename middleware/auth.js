/**
 * Deborah — Authentication Middleware
 * Uses express-session for session management
 */

import crypto from 'crypto';
import ICONS, { icon } from '../utils/icons.js';
import { fb } from '../firebase/admin.js';
import CONFIG from '../src/config/env.js';
import { audit, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';
import {
  isSessionExpired,
  shouldTouch,
  loginReturnUrl,
  sessionTimeoutCopy,
  WARN_BEFORE_MS,
  // AUTH A-25: absolute timeout + rotation + re-auth
  isAbsoluteExpired,
  shouldRotateSession,
  isReauthFresh,
} from '../src/modules/auth/session-timeout.js';
import {
  deviceHash,
  parseRememberCookie,
  parseCookies,
  serializeRememberCookie,
  restoreRememberToken,
  revokeRememberToken,
} from '../src/modules/auth/remember-me.js';
// AUTH A-26: MFA step-up (sensitive amallar uchun mfaAt 30 daqiqa)
import { isMfaStepUpFresh } from '../src/modules/auth/mfa-totp.js';
// AUTH A-30: admin/teacher privilege hardening
import {
  adminMfaMandatory,
  ADMIN_MFA_STEPUP_TTL_MS,
} from '../src/modules/auth/admin-security.js';
import {
  rememberCookieName,
  REMEMBER_TTL_MS,
} from '../src/modules/auth/session-store.js';

// ── AUTH A-25: remember-me cookie helper'lar (PII minimal, httpOnly) ──
function setRememberCookie(res, pair) {
  res.cookie(rememberCookieName(), serializeRememberCookie(pair), {
    httpOnly: true,
    secure: CONFIG.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REMEMBER_TTL_MS,
  });
}

function clearRememberCookie(res) {
  res.clearCookie(rememberCookieName(), { path: '/' });
}

/**
 * AUTH A-25: sessiya ID'ni o'rtada rotate qiladi (hijack window kamayadi).
 * regenerate() yangi bo'sh sessiya beradi — hamma maydonlarni ko'chiramiz,
 * csrf token saqlanadi (yangisi yaratilmaydi — session'dagi eskisi ishlaydi).
 * @returns {Promise<boolean>} muvaffaqiyat
 */
async function rotateSession(req) {
  const data = { ...req.session };
  return new Promise((resolve) => {
    req.session.regenerate((err) => {
      if (err) return resolve(false);
      Object.assign(req.session, data);
      req.session.lastRotatedAt = Date.now();
      return resolve(true);
    });
  });
}

/**
 * AUTH A-25: remember-me cookie'idan sessiyani tiklaydi (selector/verifier).
 * Faqat session.user bo'lmaganda ishlaydi. Tiklangan sessiya `viaRemember: true`
 * bilan belgilanadi — sensitive amallar (requireRecentAuth) uni bloklaydi.
 */
export async function rememberMeAuth(req, res, next) {
  try {
    if (req.session?.user) return next();
    // cookie-parser dep yo'q — remember cookie'ni header'dan o'qiymiz
    const cookieVal = parseCookies(req.headers.cookie)[rememberCookieName()];
    if (!cookieVal) return next();
    const pair = parseRememberCookie(cookieVal);
    if (!pair) {
      clearRememberCookie(res);
      return next();
    }
    const ua = req.headers['user-agent'];
    const result = await restoreRememberToken({
      selector: pair.selector,
      verifier: pair.verifier,
      deviceHash: deviceHash(ua, req.ip),
    });
    if (!result) {
      clearRememberCookie(res); // revoke qilingan/noto'g'ri token — cookie tozalanadi
      return next();
    }
    // Foydalanuvchi hali mavjudmi?
    const snap = await fb.get(`users/${result.userId}`);
    if (!snap.exists()) {
      await revokeRememberToken(pair.selector);
      clearRememberCookie(res);
      return next();
    }
    const u = snap.val();
    let isVip = false;
    try {
      const vipSnap = await fb.get(`users/${result.userId}/isVip`);
      isVip = vipSnap.exists() && vipSnap.val() === true;
    } catch (_) { /* non-critical */ }

    await new Promise((resolve) => req.session.regenerate(resolve));
    req.session.user = {
      username: u.username || result.userId,
      safeKey: result.userId,
      isVip,
      role: ['student', 'teacher', 'proctor', 'marker', 'board'].includes(u.role) ? u.role : 'student',
      passwordUpdatedAt: u.password_updated_at || 0,
      roleVersion: typeof u.role_version === 'number' ? u.role_version : 0,
      viaRemember: true, // A-25: selector token — to'liq session emas
    };
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.lastActiveAt = Date.now();
    req.session.startedAt = Date.now();
    req.session.lastRotatedAt = Date.now();
    req.session.remember = true;
    setRememberCookie(res, result.newPair); // rotation — yangi verifier
    audit({
      action: AUDIT_ACTIONS.REMEMBER_RESTORED,
      userId: result.userId,
      resourceType: 'session',
      details: { rotated: true },
      ipAddress: req.ip,
      userAgent: ua,
    }).catch(() => {});
    return next();
  } catch (_) {
    // Restore xatosida fail-open emas — sessiya yo'q bo'lib qoladi (xavfsiz)
    return next();
  }
}

/**
 * AUTH A-25 §09: sensitive amallar (parol/email change, teacher approve)
 * uchun yaqinda re-auth talab (OWASP). viaRemember sessiya ham bloklanadi.
 */
export function requireRecentAuth(req, res, next) {
  if (req.session?.user && req.session.user.viaRemember !== true && isReauthFresh(req.session.reauthedAt)) {
    return next();
  }
  return res.status(403).json({ error: 'reauth_required', message: 'Xavfsizlik uchun parolingizni qayta tasdiqlang' });
}

/** Admin varianti — session.adminReauthedAt tekshiradi. */
export function requireRecentAdminAuth(req, res, next) {
  if (req.session?.admin && isReauthFresh(req.session.adminReauthedAt)) {
    return next();
  }
  return res.status(403).json({ ok: false, error: 'reauth_required', message: 'Xavfsizlik uchun admin parolini qayta tasdiqlang' });
}

/**
 * AUTH A-26 §13: MFA step-up — MFA yoqilgan user uchun sensitive amal
 * (parol/email o'zgartirish, data export) MFA orqali yaqinda tasdiqlangan
 * bo'lishi shart (mfaAt ≤ 30 daqiqa). MFA o'chiq/yo'q bo'lsa o'tkazadi
 * (step-up faqat MFA yoqilganda talab qilinadi).
 */
export function requireMfaStepUp(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ ok: false, error: 'unauthorized' });
  // MFA yoqilganligini async tekshirish kerak — bu yerda session'da belgi
  // yo'q bo'lsa, faqat viaMfa/mfaAt tekshiriladi; to'liq tekshiruv route'da.
  if (user.viaMfa === true && isMfaStepUpFresh(user.mfaAt)) {
    return next();
  }
  // MFA login'dan kelgan (viaMfa) bo'lsa, ammo eskirgan bo'lsa → 403
  if (user.viaMfa === true) {
    return res.status(403).json({ ok: false, error: 'mfa_stepup_required', message: 'Xavfsizlik uchun ikki bosqichli tekshiruvdan qayta o\'ting' });
  }
  // MFA'siz sessiya (viaMfa yo'q) — step-up talab qilinmaydi (MFA yoqilmagan
  // bo'lishi mumkin); route o'zi hasActiveMfa tekshiradi.
  return next();
}

/**
 * AUTH C-04 §12: risk-based qaror middleware — sensitive amallar uchun.
 * Session'da login'da hisoblangan `riskTier` ishlatiladi (server-side,
 * client ishonilmaydi).
 *   - trusted  → next() (seamless)
 *   - unknown  → 403 risk_stepup_required (MFA challenge A-26 / trust banner)
 *   - suspicious → 403 risk_blocked (block + alert — login'da record qilingan)
 * `riskTier` yo'q (eski sessiya) → fail-soft next() (regression xavfi yo'q).
 */
export function requireLowRisk(req, res, next) {
  const tier = req.session?.user?.riskTier;
  if (!tier || tier === 'trusted') return next();
  if (tier === 'suspicious') {
    return res.status(403).json({
      ok: false, error: 'risk_blocked',
      message: 'Xavfsizlik xizmati ushbu kirishni blokladi. Qayta urinib ko\'ring yoki support bilan bog\'laning',
    });
  }
  // unknown → step-up (MFA challenge A-26 yoki trust banner)
  return res.status(403).json({
    ok: false, error: 'risk_stepup_required',
    message: 'Xavfsizlikni tasdiqlash uchun qo\'shimcha tekshiruvdan o\'ting (MFA yoki qurilmani tasdiqlash)',
  });
}

/**
 * Eski sessiya revoke (plan_login §5 + AUTH A-02): parol tiklanganda user'dagi
 * `password_updated_at` yangilanadi; rol o'zgarganda `role_version` ko'tariladi.
 * Sessiya'dagi qiymat eski bo'lsa — sessiya ishonchsiz → bekor qilinadi.
 * DB get har request'da og'ir bo'lmasligi uchun faqat qiymati 0 (hali
 * tekshirilmagan) sessiyalarda o'qiladi; tekshirilgan qiymat sessiyaga
 * saqlanadi (keyingi tekshiruv tez).
 */
async function invalidateIfStale(req, res) {
  const s = req.session?.user;
  if (!s || typeof s.safeKey !== 'string') return false;

  // 1) Parol yangilanganmi? (plan_login §5)
  if (typeof s.passwordUpdatedAt === 'number' && s.passwordUpdatedAt === 0) {
    try {
      const snap = await fb.get(`users/${s.safeKey}/password_updated_at`);
      if (snap.exists()) {
        const updatedAt = snap.val();
        if (typeof updatedAt === 'number' && updatedAt > s.passwordUpdatedAt) {
          await new Promise((resolve) => req.session.destroy(resolve));
          return true;
        }
        s.passwordUpdatedAt = updatedAt;
      }
    } catch (_) { /* DB xatosi — fail-open */ }
  }

  // 2) Rol o'zgarganmi? (AUTH A-02 — rol berilgan/olib tashlangan bo'lishi mumkin)
  // A-31 review fix (haqiqiy gap): eski kod faqat roleVersion===0 sessiyalarni
  // tekshirardi — lekin login'da roleVersion=userData.role_version o'rnatiladi
  // (register'da 1), demak yangi sessiyalar HECH QACHON rol o'zgarishini
  // tekshirmasdi → admin rol o'zgartirsa (teacher approve/reject, downgrade)
  // eski sessiyalar yashirincha valid bo'lib qolardi (privilege stale).
  // Endi: rol har request'da tekshirilmaydi (perf), balki har 60 soniyada bir
  // marta (roleCheckedAt throttle) — teacher approve 60s ichida sessiyani
  // o'ldiradi, hot-path DB read yukini oshirmaydi.
  const now2 = Date.now();
  if (!s.roleCheckedAt || now2 - s.roleCheckedAt > 60000) {
    try {
      const snap = await fb.get(`users/${s.safeKey}/role_version`);
      if (snap.exists()) {
        const rv = snap.val();
        if (typeof rv === 'number' && rv !== s.roleVersion) {
          await new Promise((resolve) => req.session.destroy(resolve));
          return true;
        }
      }
      s.roleCheckedAt = now2;
    } catch (_) { /* DB xatosi — fail-open */ }
  }
  return false;
}

/** AUTH A-02: session expired javobi (401 JSON yoki returnUrl'li login redirect). */
function expireSessionResponse(req, res, message) {
  const isApi = req.originalUrl.startsWith('/api/') || req.path.startsWith('/api/');
  const returnUrl = loginReturnUrl(req.originalUrl);
  if (isApi || req.xhr || prefersJson401(req)) { // S28.2: BUG-041 semantik + Accept'siz/*/* klient ham JSON (a30/b22)
    return res.status(401).json({ error: message, redirect: `/user/login?returnUrl=${returnUrl}` });
  }
  return res.redirect(`/user/login?returnUrl=${returnUrl}`);
}


/**
 * S28.2 (a30 §06 / b22 regress): bu klient JSON xatosini kutadimi?
 * BUG-041 semantikasi SAQLANADI: brauzer navigatsiyasi (Accept'da text/html
 * ustuvor) → redirect; qolgan hamma klient — /api/, XHR, fetch (default
 * Accept yulduzcha), Accept yubormagan klient (supertest), application/json
 * — → 401 JSON.
 * Eski `req.accepts(['html','json']) === 'json'` sharti Accept'siz yoki
 * "hamma qabul" Accept'li klientni html'ga negotiate qilib 302 redirect
 * follow qilib login sahifasidan 200 olar edi (anonim /user/telegram/link 200,
 * /admin/dashboard 302≠401 — a30 §06, b22 testlari qizil).
 */
function prefersJson401(req) {
  // Mock req'lar (unit testlar) req.get'isiz kelishi mumkin — headers fallback.
  let accept = '';
  try {
    accept = typeof req?.get === 'function' ? req.get('accept') : req?.headers?.accept;
  } catch (_) { /* mock — Accept yo'q deb olamiz */ }
  accept = String(accept || '').toLowerCase();
  // Accept yuborilmagan klient (supertest/fetch protokollari, a30 §06 kontrakt)
  // — 401 JSON; brauzer navigatsiyasi (text/html ustuvor) — redirect;
  // application/json / yulduzcha-yulduzcha (fetch) — 401 JSON.
  if (!accept) return true;
  const htmlPreferred = accept.includes('text/html') && !accept.includes('application/json');
  return !htmlPreferred;
}

/**
 * Require authentication — redirects to login if not authenticated
 * For API routes (path starts with /api/), returns 401 JSON instead
 * AUTH A-02: idle timeout + lastActive touch (throttled) shu yerda.
 */
export async function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    if (await invalidateIfStale(req, res)) {
      return expireSessionResponse(req, res, 'Session yakunlandi — qayta kiring');
    }

    // AUTH A-02: idle timeout (30 daqiqa, config'dan) — sessiya bekor qilinadi.
    if (isSessionExpired(req.session.lastActiveAt)) {
      const safeKeyId = req.session.user.safeKey;
      audit({
        action: AUDIT_ACTIONS.SESSION_IDLE_TIMEOUT,
        userId: safeKeyId,
        resourceType: 'session',
        details: { idleMs: CONFIG.SESSION_IDLE_TIMEOUT_MS },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      await new Promise((resolve) => req.session.destroy(resolve));
      return expireSessionResponse(req, res, 'Sessiya muddati tugadi — qayta kiring');
    }

    // AUTH A-25 §08: absolute timeout (12 soat) — login'dan boshlab qat'iy.
    if (isAbsoluteExpired(req.session.startedAt || req.session.lastActiveAt)) {
      audit({
        action: AUDIT_ACTIONS.SESSION_ABSOLUTE_TIMEOUT,
        userId: req.session.user.safeKey,
        resourceType: 'session',
        details: { absoluteMs: CONFIG.SESSION_ABSOLUTE_TIMEOUT_MS },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      await new Promise((resolve) => req.session.destroy(resolve));
      return expireSessionResponse(req, res, 'Sessiya muddati tugadi — qayta kiring');
    }

    // AUTH A-25 §08: mid-session ID rotation (har 30 daqiqada) — hijack window.
    if (shouldRotateSession(req.session.lastRotatedAt)) {
      try {
        if (typeof req.session.regenerate === 'function') {
          await rotateSession(req);
        } else {
          // regenerate yo'q (test/legacy session) — marker qo'yib o'tamiz
          req.session.lastRotatedAt = Date.now();
        }
      } catch (_) { /* rotation xatosi — session o'zgarmaydi, bloklanmaydi */ }
    }

    // AUTH A-02: lastActive touch — throttled (har 5 daqiqada bir marta yoziladi).
    if (shouldTouch(req.session.lastActiveAt)) {
      req.session.lastActiveAt = Date.now();
    }
    return next();
  }
  // API routes get JSON error, others get redirect.
  // Use originalUrl (not req.path) — scoped router.use('/api', ...) strips the
  // /api prefix from req.path, which would wrongly classify API calls as HTML.
  const isApi = req.originalUrl.startsWith('/api/') || req.path.startsWith('/api/');
  if (isApi || req.xhr || prefersJson401(req)) { // S28.2: BUG-041 semantik + Accept'siz/*/* klient ham JSON (a30/b22)
    return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi', redirect: '/user/login' });
  }
  res.redirect('/user/login');
}

/** AUTH A-30 §07: admin MFA step-up fresh (30 daqiqa). */
export function isAdminMfaStepUpFresh(session) {
  const at = session?.adminMfaAt || 0;
  return typeof at === 'number' && at > 0 && Date.now() - at < ADMIN_MFA_STEPUP_TTL_MS;
}

/**
 * AUTH B-07 §10 — Limited mode (email verify gate).
 * Verify'siz summative (nazorat topshirish) blok; o'qish/practice (formative)
 * ochiq qoladi. Sessiyadagi emailVerified (login/register'da to'ldiriladi) +
 * DB'dagi email_verified faktik holat tekshiriladi (session stale bo'lsa ham).
 *
 * 403 EMAIL_VERIFY_REQUIRED + banner chiqishi uchun marker; API uchun JSON.
 */
export async function requireEmailVerified(req, res, next) {
  const user = req.session?.user;
  if (!user?.safeKey) {
    const isApi = req.originalUrl.startsWith('/api/') || req.path.startsWith('/api/');
    if (isApi || req.xhr || prefersJson401(req)) { // S28.2: BUG-041 semantik + Accept'siz/*/* klient ham JSON (a30/b22)
      return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi', redirect: '/user/login' });
    }
    return res.redirect('/user/login');
  }

  // Session faktik (tezkor yo'l) — login/register'da to'ldiriladi.
  if (user.emailVerified === true) return next();

  // DB faktik holat — session eskirgan bo'lishi mumkin (email_verified boshqa
  // joyda o'zgargan). Faqat DB'ga ishonamiz — session'ni ham yangilaymiz.
  // user.safeKey allaqachon canonical storage key (verifyCode/register/login
  // bir xil kalitni ishlatadi) — qayta safeKey o'rash keraksiz.
  try {
    const { fb } = await import('../firebase/admin.js');
    const snap = await fb.get(`users/${user.safeKey}/email_verified`);
    if (snap.exists() && snap.val() === true) {
      if (req.session.user) req.session.user.emailVerified = true;
      return next();
    }
  } catch (_) { /* DB xatosi — blok (limited mode xavfsiz yo'nalish) */ }

  // B-07 §10: bloklangan amal — audit + metric (limited_mode_used)
  try {
    const { logAuthEvent, AUDIT_ACTIONS } = await import('../src/modules/auth/audit.js');
    logAuthEvent({
      action: AUDIT_ACTIONS.EMAIL_VERIFY_BLOCKED,
      outcome: 'blocked',
      method: 'summative',
      channel: 'email',
      actorId: user.safeKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
  } catch (_) {}
  try {
    const { recordMetric } = await import('../src/telemetry/index.js');
    recordMetric('auth.limited_mode_used', 1, { type: 'counter', labels: { gate: 'summative' } });
  } catch (_) { /* telemetry fail-soft */ }

  const isApi = req.originalUrl.startsWith('/api/') || req.path.startsWith('/api/');
  if (isApi || req.xhr || prefersJson401(req)) { // S28.2: BUG-041 semantik + Accept'siz/*/* klient ham JSON (a30/b22)
    return res.status(403).json({ error: 'EMAIL_VERIFY_REQUIRED', redirect: '/user/panel' });
  }
  res.redirect('/user/panel');
}

/**
 * Require admin authentication
 * For API routes (path starts with /api/), returns 401 JSON instead
 * AUTH A-30 §07: admin session — SameSite=Strict, qisqa Max-Age (8 soat),
 * absolute timeout, remember-me yo'q (high-privilege).
 */
/* S34e: admin sessiya revoke nazorati — 60s memo-cache (fb.get har requestda yo'q) */
const _adminSidCache = new Map(); // sid -> { checkedAt, revoked }
function checkAdminSessionRevoked(req, res) {
  const sid = req.sessionID;
  if (!sid) return;
  const hit = _adminSidCache.get(sid);
  const now = Date.now();
  if (hit && now - hit.checkedAt < 60_000) {
    if (hit.revoked) {
      req.session.destroy(() => {});
      const isApi = req.originalUrl.startsWith('/api/');
      if (isApi) res.status(401).json({ error: 'Sessiya bekor qilingan', redirect: '/admin/login' });
      else res.redirect('/admin/login');
      return;
    }
    return; // cache: revoked emas
  }
  import('../firebase/admin.js').then(({ fb }) => fb.get(`admin_sessions/${sid}/revoked`))
    .then((snap) => {
      const revoked = !!(snap && snap.exists && snap.exists() && snap.val() === true);
      _adminSidCache.set(sid, { checkedAt: now, revoked });
      if (revoked) {
        req.session.destroy(() => {});
      }
    })
    .catch(() => _adminSidCache.set(sid, { checkedAt: now, revoked: false }));
}

export function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    // ── Privileged session hardening (A-30 §07) ──
    // Har request'da qayta assert qilinadi (Set-Cookie yangilanadi).
    if (req.session.cookie) {
      req.session.cookie.sameSite = 'strict';
      const adminTtl = CONFIG.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000;
      const cur = req.session.cookie.maxAge;
      if (typeof cur !== 'number' || cur > adminTtl) {
        req.session.cookie.maxAge = adminTtl;
      }
    }
    // ── S34e: DB'dan revoke tekshiruv (60s memo-cache — har requestda fb.get yo'q) ──
    checkAdminSessionRevoked(req, res);
    // Absolute timeout — login'dan boshlab 8 soat (qisqa, high-privilege)
    const adminTtl = CONFIG.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000;
    if (req.session.adminLoggedInAt && Date.now() - req.session.adminLoggedInAt > adminTtl) {
      audit({
        action: AUDIT_ACTIONS.SESSION_ABSOLUTE_TIMEOUT,
        resourceType: 'admin-session',
        details: { privileged: true },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return req.session.destroy(() => res.redirect('/admin/login'));
    }
    return next();
  }
  // API routes get JSON error, others get redirect.
  // Use originalUrl (not req.path) — scoped router.use('/api', ...) strips the
  // /api prefix from req.path, which would wrongly classify API calls as HTML.
  const isApi = req.originalUrl.startsWith('/api/') || req.path.startsWith('/api/');
  if (isApi || req.xhr || prefersJson401(req)) { // S28.2: BUG-041 semantik + Accept'siz/*/* klient ham JSON (a30/b22)
    return res.status(401).json({ error: 'Admin avtorizatsiyasi talab qilinadi', redirect: '/admin/login' });
  }
  res.redirect('/admin/login');
}

/**
 * AUTH A-30 §09: sensitive admin amallar (teacher approve, user o'chirish,
 * roster commit, security settings) uchun fresh MFA shart (adminMfaAt 30 daq).
 * Admin MFA mandatory bo'lmasa (dev/test flag off) — eski sessiya o'tadi
 * (step-up faqat mandatory rejimda talab; regression yo'q).
 */
export function requireAdminMfaStepUp(req, res, next) {
  if (!req.session?.admin) return requireAdmin(req, res, next);
  // Mandatory bo'lmasa — step-up talab qilinmaydi (dev/test compat)
  if (!adminMfaMandatory()) return next();
  if (isAdminMfaStepUpFresh(req.session)) return next();
  if (req.originalUrl.startsWith('/api/') || req.xhr || req.accepts('json')) {
    return res.status(403).json({ ok: false, error: 'mfa_stepup_required', message: 'Xavfsizlik uchun admin MFA\'ni qayta tasdiqlang', redirect: '/admin/mfa/stepup' });
  }
  return res.redirect('/admin/mfa/stepup');
}

/**
 * Redirect to panel if already authenticated
 */
export function redirectIfAuth(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/user/panel');
  }
  next();
}

/**
 * Redirect to admin dashboard if already authenticated
 */
export function redirectIfAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return res.redirect('/admin/dashboard');
  }
  next();
}

/**
 * Set locals for views (user info, icon helper, etc.)
 */
export function setLocals(req, res, next) {
  res.locals.user = req.session?.user || null;
  res.locals.admin = req.session?.admin || null;
  // ── Role-aware shell (Prompt 68) ──
  // Session rol: admin session → 'admin'; user session → user.role || 'student'.
  res.locals.role = req.session?.admin ? 'admin' : (req.session?.user?.role || 'student');
  res.locals.roleLabel = ({ admin: 'Administrator', teacher: "O'qituvchi", student: 'Talaba', proctor: 'Proktor', marker: 'Baholovchi', board: "Hay'at" })[res.locals.role] || 'Talaba';
  res.locals.path = req.path;
  res.locals.query = req.query || {};
  // Site URL for absolute OG image links (set via .env SITE_URL)
  res.locals.siteUrl = process.env.SITE_URL || '';
  // Icon helper for EJS templates: <%= icon('name', 20) %>
  res.locals.icon = icon;
  // Full icon registry for client-side injection (window.__ICONS)
  res.locals.icons = ICONS;

  // AUTH A-02: session timeout frontend config (faqat tizimga kirgan user'lar)
  res.locals.sessionTimeout = null;
  if (req.session?.user) {
    res.locals.sessionTimeout = {
      idleMs: CONFIG.SESSION_IDLE_TIMEOUT_MS,
      warnMs: WARN_BEFORE_MS,
      keepAliveUrl: '/api/session/ping',
      loginUrl: '/user/login',
      // returnUrl faqat GET sahifalar uchun (API/XHR'da panel'ga qaytamiz)
      returnUrl: req.method === 'GET' && !req.originalUrl.startsWith('/api/')
        ? req.originalUrl
        : '/user/panel',
      copy: sessionTimeoutCopy(req.cookies?.lang),
    };
  }
  next();
}
