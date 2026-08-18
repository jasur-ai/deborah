/**
 * Deborah — Google OIDC Auth Routes (AUTH A-07)
 *
 * Routes:
 *   GET  /auth/google          → Redirect to Google consent screen
 *   GET  /auth/google/callback → Handle Google redirect, exchange code, set session
 *   GET  /auth/status          → Return OIDC status (enabled/disabled)
 *
 * AUTH A-07:
 *   §17 — GET /auth/google rate limit (10/15 daqiqa per IP)
 *   §19 — Mobile in-app browser (Telegram/webview) → "real browser" xabari
 *   §22 — login_google_start / login_google_callback metrics
 *   §15 — Session regenerate + role redirect
 *
 * All routes gracefully return 404 when Google OIDC is not configured.
 */

import crypto from 'crypto';
import { Router } from 'express';
import {
  isOidcEnabled,
  getAuthUrl,
  completeOidcLogin,
  getOidcStatus,
  checkGoogleStartLimit,
  // AUTH A-24 (OAuth 2.1 / RFC 9700 hardening)
  assertExactRedirectUri,
  checkGoogleCallbackLimit,
  rotateGoogleRefreshToken,
  getStoredGoogleRefreshToken,
} from '../src/modules/auth/oidc.js';
import { audit, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';
import { safeReturnUrl } from '../src/modules/auth/session-timeout.js';
import { recordMetric } from '../src/telemetry/index.js';
import { fb } from '../firebase/admin.js';
import { safeKey } from '../utils/helpers.js';
// AUTH B-10: Google register — rol modal (2-qadam) sahifasi
import { AUTH_COPY, AUTH_LANGS, resolveAuthLang } from '../data/auth-i18n.js';
import { normalizeUserRecord } from '../src/modules/auth/user-schema.js';
import { normalizeUsername } from '../src/modules/auth/username.js';
// AUTH B-13: Google accept — invite claim (user yaratilishidan oldin)
import { claimInviteForGoogle } from '../src/modules/roster/index.js';
// AUTH B-14: teacher approval — canonical ariza record (Google teacher yo'li)
import { submitTeacherApplication } from '../src/modules/auth/teacher-approval.js';

// AUTH B-13 §06: invite parametri — faqat 64-hex hash qabul qilinadi
// (B-10'dagi slice(0,48) hash'ni kesib tashlar edi → lookup doim fail).
function normalizeInviteParam(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return /^[0-9a-f]{64}$/.test(t) ? t : null;
}

// AUTH B-13 §10: claim xatosini i18n xabarga xaritalash (invite blokdagi
// used/expired/revoked/invalid — B-12'da 4 tilga qo'shilgan).
function inviteClaimError(copy, error) {
  const e = String(error || '');
  if (e.includes('ishlatilgan')) return copy.invite.errors.used;
  if (e.includes('muddati')) return copy.invite.errors.expired;
  if (e.includes('bekor qilingan')) return copy.invite.errors.revoked;
  return copy.invite.errors.invalid;
}

const router = Router();

// AUTH A-07 §19: in-app browser (Telegram, FB/IG webview, Line, Android WebView) —
// OAuth consent cookie'larini to'g'ri saqlay olmaydi → real browser'ga o'tish kerak.
const INAPP_UA = /(TelegramBot|FBAN|FBAV|Instagram|Line\/|wv|Android.*Version\/.*Chrome\/[0-9.]+ Mobile Safari)/i;

function isInAppBrowser(ua) {
  return typeof ua === 'string' && INAPP_UA.test(ua);
}

// ── OIDC Status Check ──
router.get('/auth/status', (req, res) => {
  res.json(getOidcStatus());
});

// ── Initiate Google Login ──
router.get('/auth/google', (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(404).json({ error: 'Google login not configured' });
  }

  // AUTH A-07 §17: per-IP rate limit
  const limit = checkGoogleStartLimit(req.ip);
  if (!limit.allowed) {
    return res.status(429).render('error', {
      title: '429',
      message: 'Ko\'p urinish — 15 daqiqadan keyin qayta urinib ko\'ring',
      status: 429,
    });
  }

  // AUTH A-07 §19: in-app browser → real browser'ga o'tish xabari
  if (isInAppBrowser(req.headers['user-agent'])) {
    return res.status(400).render('error', {
      title: '400',
      message: 'Google orqali kirish uchun brauzeringizda oching. Telegram/ilova ichidagi brauzer Google login\'ni qo\'llab-quvvatlamaydi.',
      status: 400,
    });
  }

  try {
    recordMetric('auth.login.google_start', 1, { type: 'counter' })?.catch?.(() => {});
  } catch (_) { /* fail-soft */ }

  // AUTH B-10 §05: invite kod URL'da bo'lsa sessiyaga saqlanadi — callback
  // orqali rol modal'ga prefilled o'tadi (Google consent'dan omon qolishi uchun).
  if (typeof req.query.invite === 'string' && req.query.invite.trim()) {
    // AUTH B-13: 64-hex hash — to'liq saqlanadi (48'ga kesish lookup'ni buzardi)
    const inv = normalizeInviteParam(req.query.invite);
    if (inv) req.session.oidcInvite = inv;
  }

  const authUrl = getAuthUrl(req.session);
  if (!authUrl) {
    return res.status(500).json({ error: 'Failed to build auth URL' });
  }

  res.redirect(authUrl);
});

// ── Google OAuth Callback ──
router.get('/auth/google/callback', async (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(404).render('error', {
      title: '404',
      message: 'Sahifa topilmadi',
      status: 404,
    });
  }

  // AUTH A-24 §8: redirect_uri EXACT moslik — host-header confusion blok.
  if (!assertExactRedirectUri(req)) {
    await audit({
      action: AUDIT_ACTIONS.OIDC_REDIRECT_MISMATCH,
      outcome: 'blocked',
      details: { actual: `${req.protocol}://${req.get('host')}${req.path}` },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.status(400).render('error', {
      title: '400',
      message: 'Invalid callback origin',
      status: 400,
    });
  }

  // AUTH A-24 §15: callback abuse monitoring (20/15 daqiqa per IP)
  const cbLimit = checkGoogleCallbackLimit(req.ip);
  if (!cbLimit.allowed) {
    return res.status(429).render('error', {
      title: '429',
      message: "Ko'p urinish — 15 daqiqadan keyin qayta urinib ko'ring",
      status: 429,
    });
  }

  const { code, state, error: oauthError } = req.query;

  // Handle Google's own error response (user denied consent, etc.)
  if (oauthError) {
    console.warn('[OIDC] Google returned error:', oauthError);
    try {
      recordMetric('auth.login.google_denied', 1, { type: 'counter' })?.catch?.(() => {});
    } catch (_) { /* fail-soft */ }
    return res.redirect('/user/login?error=google_denied');
  }

  // Missing authorization code
  if (!code) {
    return res.redirect('/user/login?error=missing_code');
  }

  try {
    // Complete the OIDC login flow (state validation + token exchange + user lookup)
    const result = await completeOidcLogin(req.session, code, state);

    if (!result.success) {
      console.warn('[OIDC] Login failed:', result.error);

      // Audit failed OIDC login (AUTH A-24: oidcError sabab kod bilan)
      await audit({
        action: result.oidcError
          ? AUDIT_ACTIONS.OIDC_TOKEN_INVALID
          : AUDIT_ACTIONS.USER_LOGIN_FAILED,
        outcome: 'blocked',
        details: { provider: 'google', reason: result.error, oidcError: result.oidcError },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.redirect(`/user/login?error=${encodeURIComponent(result.error)}`);
    }

    const { googleUser } = result;

    // AUTH B-10 §06: yangi Google user — account hali yaratilmagan;
    // rol modal (2-qadam): pendingGoogle sessiyada, /user/google-setup'da
    // rol tanlanadi va account o'sha yerda yaratiladi (B-10 §08/§09).
    if (result.needsSetup) {
      // invite GET /auth/google'da saqlangan — regenerate'dan OLDIN o'qiladi
      const invite = typeof req.session.oidcInvite === 'string'
        ? req.session.oidcInvite.slice(0, 64)
        : null;
      req.session.regenerate((err) => {
        if (err) return res.redirect('/user/login?error=session_error');
        req.session.pendingGoogle = {
          sub: googleUser.sub,
          email: googleUser.email,
          name: googleUser.name || '',
          picture: googleUser.picture || '',
          emailVerified: googleUser.emailVerified === true,
          invite,
          createdAt: Date.now(),
        };
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        return res.redirect('/user/google-setup');
      });
      return;
    }

    const { user } = result;

    // Regenerate session to prevent session fixation
    req.session.regenerate(async (err) => {
      if (err) {
        console.error('[OIDC] Session regenerate error:', err);
        return res.redirect('/user/login?error=session_error');
      }

      // Set user session
      req.session.user = {
        id: user.id,
        safeKey: user.safeKey,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        isVip: user.isVip,
        authProvider: 'google',
        tenant_id: 1, // Default tenant
      };
      // regenerate() yangi bo'sh sessiya — CSRF token'ni qayta o'rnatamiz
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      // Audit successful OIDC login
      await audit({
        action: user.isNew ? AUDIT_ACTIONS.USER_REGISTER : AUDIT_ACTIONS.USER_LOGIN,
        userId: user.id,
        details: { provider: 'google', isNew: user.isNew, email: user.email },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // AUTH A-07 §15: role bo'yicha redirect + returnUrl allowlist.
      // MUHIM: returnUrl faqat query'da ANIQ berilganda ishlatiladi —
      // safeReturnUrl(undefined) default `/user/panel` qaytaradi va bu
      // teacher/admin role redirect'ini overwrite qilmasligi kerak.
      let redirectTarget = '/user/panel';
      const userSnap = await fb.get(`users/${user.safeKey}`).catch(() => null);
      if (userSnap && userSnap.exists()) {
        const role = userSnap.val().role;
        if (role === 'teacher' || role === 'admin') {
          redirectTarget = role === 'teacher' ? '/teacher' : '/admin/dashboard';
        }
      }
      const rawReturn = req.query.returnUrl;
      if (rawReturn) {
        const returnUrl = safeReturnUrl(rawReturn);
        if (returnUrl && returnUrl !== '/user/login' && returnUrl !== '/') {
          redirectTarget = returnUrl;
        }
      }

      return res.redirect(redirectTarget);
    });
  } catch (err) {
    console.error('[OIDC] Callback error:', err);
    return res.redirect('/user/login?error=server_error');
  }
});

// ── AUTH B-10: Google rol modal (2-qadam) ──
// Yangi Google user → callback'da account YARATILMAYDI; pendingGoogle
// sessiyada (15 daqiqa TTL) → /user/google-setup rol tanlash sahifasi →
// POST'da account yaratiladi. Admin rol allowlist'da YO'Q (§13).
const GOOGLE_SETUP_TTL_MS = 15 * 60 * 1000;

/** pendingGoogle validligini tekshiradi (TTL + sub/email); tugagan bo'lsa tozalaydi. */
function getValidPending(req) {
  const p = req.session.pendingGoogle;
  if (!p || !p.sub || !p.email) return null;
  if (Date.now() - (p.createdAt || 0) > GOOGLE_SETUP_TTL_MS) {
    delete req.session.pendingGoogle;
    return null;
  }
  return p;
}

function renderGoogleSetup(res, opts) {
  const { lang = 'uz', error = null, prevRole = null, prevInvite = '', pending = null } = opts || {};
  const l = resolveAuthLang(lang);
  res.render('user/google-setup', {
    title: AUTH_COPY[l].setup.title,
    description: AUTH_COPY[l].setup.sub,
    lang: l,
    AUTH_LANGS,
    copy: AUTH_COPY[l],
    pending,
    error,
    prevRole,
    prevInvite,
  });
}

// GET — rol modal sahifasi (pendingGoogle talab)
router.get('/user/google-setup', (req, res) => {
  const pending = getValidPending(req);
  if (!pending) return res.redirect('/user/login');
  const lang = resolveAuthLang(req.query.lang || req.cookies?.lang);
  renderGoogleSetup(res, {
    lang,
    pending,
    prevInvite: pending.invite || '',
    prevRole: 'student',
  });
});

// POST — rol tanlandi → account yaratiladi (B-10 §08/§09/§12)
router.post('/user/google-setup', async (req, res) => {
  const pending = getValidPending(req);
  if (!pending) {
    // Review fix: GET bilan izchil — tugagan sessiyada login'ga qaytariladi
    return res.redirect('/user/login?error=google_setup_expired');
  }
  const lang = resolveAuthLang(req.body.lang || req.query.lang || req.cookies?.lang);

  // §13/§17: rol allowlist — faqat student | teacher; admin Google bilan MUMKIN EMAS.
  const role = req.body.role;
  if (role !== 'student' && role !== 'teacher') {
    return renderGoogleSetup(res, {
      lang, pending,
      error: AUTH_COPY[resolveAuthLang(lang)].errors.required,
      prevRole: role === 'teacher' ? 'teacher' : 'student',
      prevInvite: pending.invite || '',
    });
  }

  const userKey = safeKey(`google:${pending.sub}`);
  const wantsTeacher = role === 'teacher';
  const teacherRole = wantsTeacher ? 'teacher_pending' : 'student';
  const invite = typeof req.body.invite === 'string' && req.body.invite.trim()
    ? normalizeInviteParam(req.body.invite)
    : (pending.invite || null);

  // Idempotency: POST ikki marta bo'lsa (refresh) account qayta yaratilmaydi.
  const exists = await fb.get(`users/${userKey}`).catch(() => null);
  if (exists && exists.exists()) {
    delete req.session.pendingGoogle;
    // Review fix (Nit Pick Nick): session o'rnatmasdan /user/panel'ga yuborish
    // requireAuth'da 401 qaytarar edi — login sessiyasi o'rnatib keyin redirect.
    const existingRole = exists.val().role;
    const existingSnap = exists.val();
    req.session.regenerate((err) => {
      if (err) return res.redirect('/user/login?error=session_error');
      req.session.user = {
        id: userKey,
        safeKey: userKey,
        username: existingSnap.username || (pending.email || '').split('@')[0],
        displayName: existingSnap.display_name || pending.name || '',
        email: existingSnap.email || pending.email,
        avatarUrl: existingSnap.avatar_url || pending.picture || '',
        isVip: !!existingSnap.isVip,
        role: existingRole,
        authProvider: existingSnap.auth_provider || 'google',
        tenant_id: 1,
      };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return res.redirect(existingRole === 'teacher' || existingRole === 'teacher_pending'
        ? '/user/teacher-approval'
        : '/user/panel');
    });
    return;
  }

  // AUTH B-13 §06/§09/§10: Google accept — invite claim faqat student uchun,
  // user YARATILISHIDAN OLDIN (replay/escalation'da partial state qolmaydi).
  // Teacher invite'ni claim qilmaydi (invite student-scoped, §09).
  let claimedInvite = null;
  if (invite && role === 'student') {
    const claim = await claimInviteForGoogle({ tokenHash: invite, userKey });
    if (!claim.ok) {
      // §10: ishlatilgan/eskirgan/bekor → setup sahifasida aniq xato, account YO'Q
      return renderGoogleSetup(res, {
        lang,
        pending,
        prevRole: role,
        prevInvite: invite,
        error: inviteClaimError(AUTH_COPY[lang], claim.error),
      });
    }
    claimedInvite = claim.invite;
  }

  // Review fix: bo'sh/noto'g'ri email prefix → bo'sh username bo'lib qolmasligi
  // uchun fallback (register path'dagi kabi).
  const emailPrefix = (pending.email || '').split('@')[0];
  const username = normalizeUsername(emailPrefix) || `user_${String(pending.sub).slice(0, 8)}`;
  const teacherApp = wantsTeacher
    ? { university: 'Google', reason: 'Google orqali ro\'yxatdan o\'tish', appliedAt: Date.now() }
    : null;

  // AUTH B-01: canonical users schema (normalizeUserRecord idempotent backfill)
  await fb.set(`users/${userKey}`, normalizeUserRecord({
    username,
    name: pending.name || '',
    email: pending.email,
    email_verified: true, // ID token verified (findOrCreateUser tekshirgan)
    google_sub: pending.sub,
    auth_provider: 'google',
    external_id: pending.sub,
    display_name: pending.name || '',
    avatar_url: pending.picture || '',
    password: '', // Google auth — parol yo'q
    created_at: Date.now(),
    safeKey: userKey,
    isVip: false,
    role: teacherRole,
    role_version: 1,
    ...(invite ? {
      invite_code: invite,
      // B-13: student claim qilgan → accepted; teacher (claim qilmaydi) → unverified
      invite_status: claimedInvite ? 'accepted' : 'unverified',
      ...(claimedInvite ? { invite_accepted_at: Date.now() } : {}),
    } : {}),
    ...(claimedInvite ? { group: claimedInvite.groupCode, course_code: claimedInvite.courseCode } : {}),
    ...(teacherApp ? { teacher_application: teacherApp } : {}),
    settings: { lang },
  }));
  // Canonical email index (A-18/B-09 bilan izchil)
  await fb.set(`users_email_index/${safeKey(pending.email)}`, userKey);

  // AUTH B-14: teacher arizasi → canonical record + audit + metric
  // (role teacher_pending bo'lsa; fire-and-forget — register bilan bir xil)
  if (teacherRole === 'teacher_pending') {
    submitTeacherApplication({
      userKey,
      username,
      email: pending.email || '',
      name: pending.name || '',
      university: 'Google',
      reason: 'Google orqali ro\'yxatdan o\'tish',
      lang,
    }).catch(() => {});
  }

  // §12: audit google_register_created + role_selected + metric
  try {
    await audit({
      action: AUDIT_ACTIONS.USER_REGISTER,
      outcome: 'success',
      resourceType: 'user',
      actorId: userKey,
      userId: userKey,
      details: { provider: 'google', role: teacherRole, invite: !!invite, inviteAccepted: !!claimedInvite },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    recordMetric('auth.register.role_selected', 1, {
      type: 'counter', labels: { role: wantsTeacher ? 'teacher' : 'student', provider: 'google' },
    })?.catch?.(() => {});
    if (claimedInvite) {
      // B-13 §17: invite_accepted metric (password path recordMetric'i B-16'da)
      recordMetric('auth.invite_accepted', 1, {
        type: 'counter', labels: { provider: 'google', channel: 'invite' },
      })?.catch?.(() => {});
    }
  } catch (_) { /* fail-soft */ }

  delete req.session.pendingGoogle;

  // §12: session regenerate (fixation) + role bo'yicha redirect
  req.session.regenerate((err) => {
    if (err) return res.redirect('/user/login?error=session_error');
    req.session.user = {
      id: userKey,
      safeKey: userKey,
      username,
      displayName: pending.name || '',
      email: pending.email,
      avatarUrl: pending.picture || '',
      isVip: false,
      role: teacherRole,
      authProvider: 'google',
      tenant_id: 1, // Review fix: OIDC login path bilan session shakli izchil
    };
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    // A-19: teacher_pending → "admin tasdiqlaydi" ekrani; student → panel
    return res.redirect(teacherRole === 'teacher_pending' ? '/user/teacher-approval' : '/user/panel');
  });
});

// §29: "Bekor qilish" — boshqa usul (pendingGoogle tozalanadi)
router.post('/user/google-setup/cancel', (req, res) => {
  delete req.session.pendingGoogle;
  return res.redirect('/user/login');
});

// ── Refresh token rotatsiya (AUTH A-24 §11) ──
// Body: { refreshToken }. Server saqlanganga tengligini tekshiradi;
// eski (rotated) token → 409 replay + butun zanjir invalid + audit.
// Access token CLIENT'ga qaytarilmaydi (§12 — server-side saqlanadi).
router.post('/auth/google/refresh', async (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(404).json({ error: 'Google login not configured' });
  }
  const userKey = req.session?.user?.safeKey;
  if (!userKey) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ ok: false, error: 'missing-refresh-token' });
  }

  const result = await rotateGoogleRefreshToken({ userKey, currentRefreshToken: refreshToken });
  if (result.ok) {
    try {
      recordMetric('oidc.refresh_rotated', 1, { type: 'counter' })?.catch?.(() => {});
    } catch (_) { /* fail-soft */ }
    await audit({
      action: AUDIT_ACTIONS.OIDC_REFRESH_ROTATED,
      outcome: 'success',
      userId: userKey,
      details: { rotated: !!result.rotated },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true, rotated: !!result.rotated });
  }

  if (result.error === 'replay') {
    await audit({
      action: AUDIT_ACTIONS.OIDC_REFRESH_REPLAY,
      outcome: 'blocked',
      userId: userKey,
      details: { reason: 'rotated-token-reused' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.status(409).json({ ok: false, error: 'refresh-token-replayed' });
  }

  return res.status(400).json({ ok: false, error: result.error });
});

export default router;
