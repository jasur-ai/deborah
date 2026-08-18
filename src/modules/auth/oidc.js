/**
 * Deborah — Google OIDC Authentication Service
 *
 * Implements the Authorization Code + PKCE flow for Google Sign-In.
 *
 * Flow:
 *   1. User clicks "Sign in with Google"
 *   2. GET /auth/google → generates PKCE challenge, stores in session, redirects
 *   3. Google redirects to /auth/google/callback with authorization code
 *   4. Server exchanges code for tokens, validates ID token
 *   5. Finds or creates user in local DB, sets session, redirects to panel
 *
 * Gracefully degrades when Google credentials are not configured.
 * In that case, the login button is hidden and routes return 404.
 */

import crypto from 'crypto';
import * as jose from 'jose';
import CONFIG from '../../config/env.js';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
// AUTH B-04: username write path izchilligi — Google email prefix normalizatsiya
import { normalizeUsername } from './username.js';
import { audit, AUDIT_ACTIONS } from './audit.js';
// AUTH A-07 §22: login_google_start / login_google_callback / account_linked_google
import { recordMetric } from '../../telemetry/index.js';
// E-01a: canonical OneID — provider'lar yagona identifikatorga bog'lanadi
import { ensureOneId, linkProviderToOneId } from './identity.js';

// ── E-04 §1: Multi-provider OIDC registry ──
// Har bir provider: { clientId, clientSecret, redirectUri, authUrl, tokenUrl,
// userInfoUrl, jwksUrl, issuer, scopes }. Google default; kelajakda
// Microsoft/GitHub qo'shish uchun PROVIDERS'ga entry + CONFIG qo'shiladi.
const PROVIDERS = {
  google: {
    clientId: CONFIG.GOOGLE_CLIENT_ID || '',
    clientSecret: CONFIG.GOOGLE_CLIENT_SECRET || '',
    redirectUri: CONFIG.GOOGLE_REDIRECT_URI || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com', // AUTH A-24 §7: EXACT
    scopes: ['openid', 'email', 'profile'],
  },
};

// Disabled when no client ID is configured
const isConfigured = !!(CONFIG.GOOGLE_CLIENT_ID && CONFIG.GOOGLE_CLIENT_SECRET);

/** Provider config'ni qaytaradi (default google; noma'lum → null). */
export function getProvider(providerId = 'google') {
  return PROVIDERS[providerId] || null;
}

/** Ro'yxatga olingan provider id'lar (status/health uchun). */
export function listProviders() {
  return Object.keys(PROVIDERS);
}

// Backward-compat: eski kod GOOGLE_CONFIG'ni ishlatadi
const GOOGLE_CONFIG = PROVIDERS.google;

// AUTH A-24 §29: JWKS cache 24 soat — jose createRemoteJWKSet rotation'ni
// o'zi boshqaradi (noma'lum kid bo'lsa qayta fetch qiladi), shuning uchun
// TTL faqat set'ni qayta yaratish davrini belgilaydi.
let jwksCache = null;
let jwksFetchedAt = 0;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

// AUTH A-24 §7: issuer EXACT — prefix emas (OAuth 2.1 / RFC 9700).
// E-04: provider registry'dan olinadi (getProvider('google').issuer).

function getJwks() {
  if (!jwksCache || Date.now() - jwksFetchedAt > JWKS_TTL_MS) {
    jwksCache = jose.createRemoteJWKSet(new URL(GOOGLE_CONFIG.jwksUrl));
    jwksFetchedAt = Date.now();
  }
  return jwksCache;
}

// ── E-04 §2: JWKS key rotation monitoring ──
// Provider (Google) signing key'lar aylanishini kuzatadi. Yangi `kid`
// paydo bo'lsa → `oidc:jwks:rotated` audit event (ops ko'radi). Grace window
// 24 soat: eski kid'lar hali qabul qilinadi (jose o'zi unknown kid'da qayta
// fetch qiladi), lekin audit bu o'zgarishni qayd qiladi — E-04 key rotation
// tekshiruvining asosiy qismi.
let lastSeenKids = new Set();
let lastRotationAt = 0;
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000; // 24h grace window

/**
 * JWKS'dan kid'lar ro'yxatini oladi (fetch orqali — mock'lanadigan).
 * @param {Object} [opts] — test uchun: { fetchFn, url }
 * @returns {Promise<string[]>}
 */
export async function fetchJwksKids({ fetchFn = globalThis.fetch, url = GOOGLE_CONFIG.jwksUrl } = {}) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.keys) ? data.keys.map((k) => k.kid).filter(Boolean) : [];
  } catch (_) {
    return []; // JWKS unreachable — jose verify keyin hal qiladi (fail-closed)
  }
}

/**
 * Key rotation monitoring: yangi kid ko'rinsa audit yozadi.
 * @param {Object} [opts] — test uchun: { fetchFn, now }
 * @returns {Promise<{ rotated: boolean, kids: string[], newKids: string[] }>}
 */
export async function watchJwksRotation({ fetchFn, now = Date.now() } = {}) {
  const kids = await fetchJwksKids({ fetchFn });
  if (!kids.length) return { rotated: false, kids, newKids: [] };

  const newKids = kids.filter((k) => !lastSeenKids.has(k));
  let rotated = false;
  if (newKids.length > 0) {
    rotated = true;
    lastRotationAt = now;
    try {
      await audit({
        action: AUDIT_ACTIONS.OIDC_JWKS_ROTATED,
        resourceType: 'oidc',
        details: { newKids, totalKids: kids.length, graceMs: ROTATION_GRACE_MS },
      }).catch(() => {});
    } catch (_) { /* fail-soft */ }
  }
  lastSeenKids = new Set(kids);
  return { rotated, kids, newKids };
}

/** Rotation holati (health/ops uchun) — grace window tugaganmi. */
export function getJwksRotationStatus({ now = Date.now() } = {}) {
  return {
    lastRotationAt: lastRotationAt || null,
    inGrace: lastRotationAt ? (now - lastRotationAt) < ROTATION_GRACE_MS : null,
    graceMs: ROTATION_GRACE_MS,
    seenKids: [...lastSeenKids],
  };
}

/** Test reset. */
export function _resetJwksRotationState() {
  lastSeenKids = new Set();
  lastRotationAt = 0;
}

// AUTH A-07 §17: GET /auth/google rate limit — 10/15 daqiqa per IP
const googleStartAttempts = new Map();
const GOOGLE_START_MAX = 10;
const GOOGLE_START_WINDOW_MS = 15 * 60 * 1000;

// AUTH A-24 §15: callback abuse monitoring — 20/15 daqiqa per IP
const googleCallbackAttempts = new Map();
const GOOGLE_CALLBACK_MAX = 20;
const GOOGLE_CALLBACK_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /auth/google/callback uchun per-IP rate limit (abuse monitoring).
 * @returns {{ allowed: boolean, retryAfterSeconds?: number }}
 */
export function checkGoogleCallbackLimit(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const arr = (googleCallbackAttempts.get(key) || []).filter((t) => now - t < GOOGLE_CALLBACK_WINDOW_MS);
  if (arr.length >= GOOGLE_CALLBACK_MAX) {
    return { allowed: false, retryAfterSeconds: Math.ceil((arr[0] + GOOGLE_CALLBACK_WINDOW_MS - now) / 1000) };
  }
  arr.push(now);
  googleCallbackAttempts.set(key, arr);
  if (googleCallbackAttempts.size > 5000) {
    googleCallbackAttempts.delete(googleCallbackAttempts.keys().next().value);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * AUTH A-24 §8: redirect_uri EXACT moslik (OAuth 2.1 MUST).
 * Wildcard/regex yo'q; trailing slash farqi muhim. Host-header
 * confusion (DNS rebinding) hujumiga qarshi — callback request'
 * qaysi URL'ga kelgani registered redirect_uri bilan to'liq mos
 * bo'lishi shart.
 * @param {ExpressRequest} req
 * @returns {boolean}
 */
export function assertExactRedirectUri(req) {
  const configured = CONFIG.GOOGLE_REDIRECT_URI;
  if (!configured) return false;
  // req.protocol — server.js `app.set('trust proxy', 1)` bilan X-Forwarded-Proto'ni
  // inobatga oladi (TLS-terminating proxy orqasida https to'g'ri keladi).
  const actual = `${req.protocol}://${req.get('host')}${req.path}`;
  return actual === configured;
}
// Xotira cheklovi: Map cheksiz o'smasligi uchun (reviewer MEDIUM) —
// 5000 dan ortiq unique IP bo'lsa eng eski yozuvlarni tozalaymiz.
const GOOGLE_START_MAX_KEYS = 5000;

/**
 * GET /auth/google uchun per-IP rate limit (AUTH A-07 §17).
 * @returns {{ allowed: boolean, retryAfterSeconds?: number }}
 */
export function checkGoogleStartLimit(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const arr = (googleStartAttempts.get(key) || []).filter((t) => now - t < GOOGLE_START_WINDOW_MS);
  if (arr.length >= GOOGLE_START_MAX) {
    return { allowed: false, retryAfterSeconds: Math.ceil((arr[0] + GOOGLE_START_WINDOW_MS - now) / 1000) };
  }
  arr.push(now);
  googleStartAttempts.set(key, arr);
  // Memory guard: Map cheksiz o'sishini oldini olish (spoofed XFF DoS).
  if (googleStartAttempts.size > GOOGLE_START_MAX_KEYS) {
    const oldestKey = googleStartAttempts.keys().next().value;
    googleStartAttempts.delete(oldestKey);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Check if Google OIDC is configured and ready.
 */
export function isOidcEnabled() {
  return isConfigured;
}

/**
 * Get OIDC configuration status (for health endpoint / UI).
 */
export function getOidcStatus() {
  return {
    enabled: isConfigured,
    hasClientId: !!CONFIG.GOOGLE_CLIENT_ID,
    hasClientSecret: !!CONFIG.GOOGLE_CLIENT_SECRET,
    hasRedirectUri: !!CONFIG.GOOGLE_REDIRECT_URI,
    redirectUri: CONFIG.GOOGLE_REDIRECT_URI || null,
  };
}

/**
 * Generate PKCE challenge pair.
 * Returns { verifier, challenge, method }
 */
export function generatePkceChallenge() {
  const verifier = crypto.randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const challenge = crypto.createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return { verifier, challenge, method: 'S256' };
}

/**
 * Generate Google OAuth URL with PKCE.
 * Stores state + verifier in session for callback validation.
 *
 * @param {Object} session - Express session object
 * @returns {string|null} Authorization URL or null if not configured
 */
export function buildAuthUrl(session) {
  if (!isConfigured) return null;

  // AUTH A-07 §7: state + nonce 32 bayt (32B random → 64 hex belgi)
  const state = crypto.randomBytes(32).toString('hex');
  const { verifier, challenge, method } = generatePkceChallenge();

  // Store in session for callback validation
  session.oidcState = state;
  session.oidcVerifier = verifier;
  session.oidcNonce = crypto.randomBytes(32).toString('hex');

  const params = new URLSearchParams({
    client_id: GOOGLE_CONFIG.clientId,
    redirect_uri: GOOGLE_CONFIG.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CONFIG.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: method,
    nonce: session.oidcNonce,
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_CONFIG.authUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 *
 * @param {string} code - Authorization code from Google
 * @param {string} verifier - PKCE code verifier from session
 * @returns {Promise<Object|null>} Token response or null on failure
 */
export async function exchangeCodeForTokens(code, verifier) {
  const params = new URLSearchParams({
    code,
    client_id: GOOGLE_CONFIG.clientId,
    client_secret: GOOGLE_CONFIG.clientSecret,
    redirect_uri: GOOGLE_CONFIG.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });

  try {
    const response = await fetch(GOOGLE_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OIDC] Token exchange failed:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || 3600,
    };
  } catch (err) {
    console.error('[OIDC] Token exchange error:', err.message);
    return null;
  }
}

/**
 * Verify Google ID token (JWT) — AUTH A-24 (OAuth 2.1 / RFC 9700).
 *
 * Hardening:
 *   §06 — alg ALLOWLIST: faqat RS256 (HS256 rad — alg confusion himoya)
 *   §07 — issuer EXACT: 'https://accounts.google.com' (prefix emas)
 *   §09 — audience + exp (clockTolerance 30s) — jose o'zi tekshiradi
 *   §10 — nonce (replay) + email_verified — qo'lda
 *
 * Xato sababi aniq qaytariladi (audit uchun):
 *   { ok:false, error: 'alg'|'issuer'|'audience'|'expired'|'signature'|'nonce'|'email-unverified'|'missing-claims'|'invalid-token' }
 *
 * @param {string} idToken - JWT ID token (token exchange javobidan)
 * @param {string} expectedNonce - session.oidcNonce (replay himoya)
 * @param {Object} [opts] - test uchun override: { jwks, audience }
 * @returns {Promise<{ok: boolean, profile?: Object, error?: string}>}
 */
export async function verifyGoogleIdTokenDetailed(idToken, expectedNonce, opts = {}) {
  if (!idToken || typeof idToken !== 'string') return { ok: false, error: 'invalid-token' };
  const { jwks = getJwks(), audience = GOOGLE_CONFIG.clientId } = opts || {};
  let payload;
  try {
    const result = await jose.jwtVerify(idToken, jwks, {
      algorithms: ['RS256'], // AUTH A-24 §06: alg allowlist — HS256 rad
      issuer: (getProvider('google') || {}).issuer || 'https://accounts.google.com', // AUTH A-24 §07: EXACT
      audience: audience || undefined,
      clockTolerance: 30,    // §14: leeway 30s
    });
    payload = result.payload;
  } catch (err) {
    const code = err?.code;
    console.warn('[OIDC] ID token verify failed:', code || err.message);
    // jose 4.x xato kodlari: alg confusion → ERR_JOSE_ALG_NOT_ALLOWED;
    // iss/aud → ERR_JWT_CLAIM_VALIDATION_FAILED (message: '"iss" claim check failed').
    if (code === 'ERR_JOSE_ALG_NOT_ALLOWED') return { ok: false, error: 'alg' };
    if (code === 'ERR_JWT_EXPIRED') return { ok: false, error: 'expired' };
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      const msg = String(err?.message || '');
      if (/iss/.test(msg)) return { ok: false, error: 'issuer' };
      if (/aud/i.test(msg)) return { ok: false, error: 'audience' };
      return { ok: false, error: 'claim' };
    }
    // ERR_JWS_SIGNATURE_VERIFICATION_FAILED / boshqa — signature
    return { ok: false, error: 'signature' };
  }
  // nonce — callback replay himoya (session'da saqlangan bilan bir xil bo'lishi kerak)
  if (expectedNonce && payload.nonce !== expectedNonce) {
    console.warn('[OIDC] nonce mismatch');
    return { ok: false, error: 'nonce' };
  }
  // email_verified === true talab (AUTH A-07 §13)
  if (payload.email_verified !== true) {
    console.warn('[OIDC] email not verified:', payload.email);
    return { ok: false, error: 'email-unverified' };
  }
  if (!payload.sub || !payload.email) {
    console.warn('[OIDC] missing sub/email in ID token');
    return { ok: false, error: 'missing-claims' };
  }
  return {
    ok: true,
    profile: {
      sub: payload.sub,
      email: payload.email,
      emailVerified: true,
      name: payload.name || payload.email.split('@')[0],
      givenName: payload.given_name || '',
      familyName: payload.family_name || '',
      picture: payload.picture || '',
      locale: payload.locale || '',
      hostedDomain: payload.hd || null,
    },
  };
}

/**
 * AUTH A-07 §12 backward-compat wrapper: profile yoki null.
 * (A-07 unit testlari shu shaklni ishlatadi.)
 * @returns {Promise<Object|null>}
 */
export async function verifyGoogleIdToken(idToken, expectedNonce, opts = {}) {
  const r = await verifyGoogleIdTokenDetailed(idToken, expectedNonce, opts);
  return r.ok ? r.profile : null;
}

/**
 * Decode and verify the Google ID token (JWT) via userinfo endpoint.
 *
 * AUTH A-24: login flow'da ENDI ISHLATILMAYDI (fail-closed — ID token majburiy
 * verify). Faqat legacy oidc.test.js backward-compat uchun export qilingan;
 * yangi kod buni fallback sifatida ishlatmasin.
 *
 * @param {string} accessToken - Access token (used for userinfo)
 * @returns {Promise<Object|null>} Verified user info or null
 */
export async function verifyAndGetUserInfo(accessToken) {
  try {
    const response = await fetch(GOOGLE_CONFIG.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error('[OIDC] Userinfo fetch failed:', response.status);
      return null;
    }

    const data = await response.json();

    // Validate required fields
    if (!data.sub || !data.email) {
      console.error('[OIDC] Invalid userinfo response:', JSON.stringify(data));
      return null;
    }

    // Validate email_verified
    if (!data.email_verified) {
      console.warn('[OIDC] Unverified email:', data.email);
      return null;
    }

    // Optional: Validate hosted domain (hd) policy
    // Can be configured to only allow specific Google Workspace domains

    return {
      sub: data.sub,
      email: data.email,
      emailVerified: data.email_verified,
      name: data.name || data.email.split('@')[0],
      givenName: data.given_name || '',
      familyName: data.family_name || '',
      picture: data.picture || '',
      locale: data.locale || '',
      hostedDomain: data.hd || null,
    };
  } catch (err) {
    console.error('[OIDC] Userinfo error:', err.message);
    return null;
  }
}

/**
 * Find or create a local user from Google profile.
 *
 * @param {Object} googleUser - Verified Google user info
 * @returns {Promise<Object>} User data with session info
 */
export async function findOrCreateUser(googleUser) {
  // AUTH B-10: qaytish kontrakti — status mashinasi.
  //   { status: 'login',  user }      → mavjud google user YOKI verified email
  //                                      parol account'ga link qilindi → kirish
  //   { status: 'setup',  googleUser } → YANGI user — account HENUZ yaratilmaydi;
  //                                      rol modal (2-qadam) kerak (B-10 §06)
  //   { status: 'blocked', error }     → escalation/unverified → kirish YO'Q
  const externalId = `google:${googleUser.sub}`;
  const userKey = safeKey(externalId);
  const snap = await fb.get(`users/${userKey}`);

  if (snap.exists()) {
    // Mavjud Google-bog'langan user — profil yangilanadi, darhol kirish.
    const existing = snap.val();
    // E-01a: canonical OneID — user'da yo'q bo'lsa beriladi + google bog'lanadi
    if (!existing.oneid_sub) {
      try {
        const r = await ensureOneId(userKey);
        if (r.ok && r.oneId) {
          await linkProviderToOneId(r.oneId, 'google', googleUser.sub).catch(() => {});
        }
      } catch (_) { /* fail-soft — OneID muhim emas, login davom etadi */ }
    }
    await fb.update(`users/${userKey}`, {
      last_login: Date.now(),
      email: googleUser.email,
      display_name: googleUser.name,
      avatar_url: googleUser.picture,
    });
    return {
      status: 'login',
      user: {
        id: existing.id || userKey,
        safeKey: userKey,
        username: normalizeUsername(existing.username || googleUser.email.split('@')[0]),
        displayName: googleUser.name,
        email: googleUser.email,
        avatarUrl: googleUser.picture,
        isVip: existing.isVip || false,
        isNew: false,
      },
    };
  }

  // AUTH B-09 §08-§09: account linking (Google ↔ password).
  // Email index `users_email_index/${safeKey(email)}` — A-18 register
  // yozadigan canonical path (ilgari bu yerda `email_index:` o'qilardi —
  // real register account'larini HECH QACHON topmas, link o'lik edi).
  const emailLookupKey = `users_email_index/${safeKey(googleUser.email)}`;
  const emailSnap = await fb.get(emailLookupKey);
  if (emailSnap.exists()) {
    const localKey = emailSnap.val();
    if (typeof localKey !== 'string' || !localKey) {
      return { status: 'blocked', error: 'linking_required' };
    }

    // §09: Google email VERIFIED bo'lmasa — link YO'Q (escalation yo'q).
    if (googleUser.emailVerified !== true) {
      return { status: 'blocked', error: 'linking_required' };
    }

    const localSnap = await fb.get(`users/${safeKey(localKey)}`);
    const local = localSnap.exists() ? (localSnap.val() || {}) : {};
    if (!local.password) {
      // Parolsiz account'ga link qilmaymiz (auth_methods aniq bo'lsin)
      return { status: 'blocked', error: 'linking_required' };
    }
    // Review fix (B-09): boshqa Google account allaqachon bog'langan bo'lsa
    // yangi sub ustiga yozilmaydi — takeover blok.
    if (local.google_sub && local.google_sub !== googleUser.sub) {
      try {
        await audit({
          action: AUDIT_ACTIONS.ACCOUNT_LINKED,
          outcome: 'blocked',
          resourceType: 'user',
          actorId: safeKey(localKey),
          details: { provider: 'google', reason: 'google_sub_conflict' },
        });
      } catch (_) { /* fail-soft */ }
      return { status: 'blocked', error: 'linking_required' };
    }
    // E-01a: canonical OneID — link'lanayotgan lokal user'ga beriladi
    if (!local.oneid_sub) {
      try {
        const r = await ensureOneId(safeKey(localKey));
        if (r.ok && r.oneId) {
          await linkProviderToOneId(r.oneId, 'google', googleUser.sub).catch(() => {});
        }
      } catch (_) { /* fail-soft */ }
    }
    await fb.update(`users/${safeKey(localKey)}`, {
      google_sub: googleUser.sub,
      auth_provider: 'password+google',
      last_login: Date.now(),
      ...(local.display_name ? {} : { display_name: googleUser.name }),
      ...(local.avatar_url ? {} : { avatar_url: googleUser.picture }),
    });
    try {
      await audit({
        action: AUDIT_ACTIONS.ACCOUNT_LINKED,
        outcome: 'success',
        resourceType: 'user',
        actorId: safeKey(localKey),
        details: { provider: 'google', emailVerified: true },
      });
      await recordMetric('auth.account_linked', 1, {
        type: 'counter', labels: { provider: 'google' },
      })?.catch?.(() => {});
    } catch (_) { /* fail-soft */ }

    return {
      status: 'login',
      user: {
        id: local.id || safeKey(localKey),
        safeKey: safeKey(localKey),
        username: normalizeUsername(local.username || googleUser.email.split('@')[0]),
        displayName: local.display_name || googleUser.name,
        email: local.email || googleUser.email,
        avatarUrl: local.avatar_url || googleUser.picture,
        isVip: local.isVip || false,
        isNew: false,
        linked: true, // B-09: callback 'auth.login.google_linked' metric'ida ishlatadi
      },
    };
  }

  // AUTH B-10 §06/§17: yangi Google user — account yaratish rol modal'da.
  // Email verified bo'lmasa account yaratilmaydi (security guard §17).
  if (googleUser.emailVerified !== true) {
    return { status: 'blocked', error: 'google_email_unverified' };
  }
  return { status: 'setup', googleUser };
}

/**
 * Google bilan bog'langan parol user'ini rad etish uchun xabar (escalation yo'q).
 * findOrCreateUser email_index mavjud bo'lsa null qaytaradi — bu intentional:
 * verified email + google_sub boshqa odamga tegishli bo'lishi mumkin.
 * (AUTH A-07 §20: account-linking escalation blok.)
 */
export function getLinkingError() {
  // B-09: stable kod — routes/auth.js OIDC_ERROR_MAP + i18n 'linkingRequired'
  return 'linking_required';
}

/**
 * Perform the complete OIDC login flow (state validation + token exchange + user lookup).
 * Called from the callback route handler.
 *
 * @param {Object} session - Express session
 * @param {string} code - Authorization code from Google
 * @param {string} state - State parameter from Google
 * @returns {Promise<Object>} { success, user, error }
 */
export async function completeOidcLogin(session, code, state) {
  // 1. Validate state (CSRF protection)
  if (!session.oidcState || state !== session.oidcState) {
    return { success: false, error: 'Invalid state parameter. Possible CSRF attack.' };
  }

  // 2. Get verifier + nonce from session — O'CHIRISHDAN OLDIN lokaldan olib
  //    qo'yamiz (AUTH A-07 §12: nonce verify ID token'da ishlatiladi).
  const verifier = session.oidcVerifier;
  const expectedNonce = session.oidcNonce;
  if (!verifier) {
    return { success: false, error: 'Missing PKCE verifier. Session expired.' };
  }

  // 3. Clear OIDC session data (one-time use)
  delete session.oidcState;
  delete session.oidcVerifier;
  delete session.oidcNonce;

  // AUTH A-07 §22: callback boshlangani metric
  try {
    recordMetric('auth.login.google_callback', 1, { type: 'counter' })?.catch?.(() => {});
  } catch (_) { /* fail-soft */ }

  // 4. Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code, verifier);
  if (!tokens) {
    return { success: false, error: 'Token exchange failed.' };
  }

  // 5. Verify ID token (AUTH A-24) — iss/aud/exp/nonce/email_verified + alg allowlist.
  //    FAIL-CLOSED: ID token majburiy va to'liq verify bo'lishi shart.
  //    userinfo API fallback YO'Q (downgrade himoya — guide §06).
  if (!tokens.idToken) {
    return { success: false, error: 'Missing ID token.' };
  }
  const verified = await verifyGoogleIdTokenDetailed(tokens.idToken, expectedNonce);
  if (!verified.ok) {
    // AUTH A-24 §19: oidc_token_invalid metric + audit detail (sabab kod)
    try {
      recordMetric('oidc.token_invalid', 1, { type: 'counter' })?.catch?.(() => {});
    } catch (_) { /* fail-soft */ }
    return { success: false, error: 'ID token verification failed.', oidcError: verified.error };
  }
  const googleUser = verified.profile;
  if (!googleUser) {
    return { success: false, error: 'User info verification failed.' };
  }

  // 6. Optional: Validate hosted domain policy
  if (CONFIG.GOOGLE_HD && googleUser.hostedDomain !== CONFIG.GOOGLE_HD) {
    return { success: false, error: `Only @${CONFIG.GOOGLE_HD} accounts allowed.` };
  }

  // 7. Find or create local user — AUTH B-10 status mashinasi:
  //    login (mavjud/link) | setup (yangi — rol modal) | blocked
  const signin = await findOrCreateUser(googleUser);
  if (signin.status === 'blocked') {
    return { success: false, error: signin.error || getLinkingError() };
  }

  // AUTH B-10 §06: yangi Google user — account YO'Q; rol modal (2-qadam).
  // Refresh token hozir saqlanadi (server-side, google_refresh/{subKey}) —
  // account setup'da yaratilganda o'sha zanjir tayyor bo'ladi.
  if (signin.status === 'setup') {
    if (tokens.refreshToken) {
      const setupKey = safeKey(`google:${googleUser.sub}`);
      await storeGoogleRefreshToken(setupKey, tokens.refreshToken).catch(() => {});
    }
    try {
      recordMetric('auth.login.google_new', 1, { type: 'counter' })?.catch?.(() => {});
    } catch (_) { /* fail-soft */ }
    return { success: true, needsSetup: true, googleUser, refreshTokenStored: !!tokens.refreshToken };
  }

  const localUser = signin.user;

  // AUTH A-24 §11: refresh token server-side saqlanadi (rotatsiya uchun).
  // Google access_type=offline + prompt=consent bergan refresh_token
  // saqlanadi; har ishlatishda yangilab boriladi (rotatsiya).
  if (tokens.refreshToken) {
    await storeGoogleRefreshToken(localUser.safeKey, tokens.refreshToken).catch((err) => {
      console.warn('[OIDC] refresh token store failed:', err?.message || err);
    });
  }

  // AUTH A-07 §22: yangi / mavjud / linked login metrikasi
  try {
    const kind = localUser.linked ? 'auth.login.google_linked' : (localUser.isNew ? 'auth.login.google_new' : 'auth.login.google_existing');
    recordMetric(kind, 1, { type: 'counter' })?.catch?.(() => {});
  } catch (_) { /* fail-soft */ }

  return { success: true, user: localUser, googleUser, refreshTokenStored: !!tokens.refreshToken };
}

// ── AUTH A-24 §11: refresh token rotatsiya ──
// Refresh token faqat server'da, ALOHIDA path'da (`google_refresh/{safeKey}`)
// saqlanadi — users/ record'iga qo'shilmaydi (profile/panel API'lar user
// record'ni serializatsiya qilsa, uzoq muddatli Google credentiali
// client'ga chiqib ketmasligi uchun). Har ishlatishda yangi refresh_token
// saqlanadi; eski (rotated) token qayta ishlatilsa → kompromat signali →
// butun zanjir invalid + audit.
const GOOGLE_REFRESH_PATH = 'google_refresh';

/** Refresh tokenni saqlaydi (server-side, alohida path). */
export async function storeGoogleRefreshToken(userKey, refreshToken) {
  if (!userKey || !refreshToken) return;
  await fb.set(`${GOOGLE_REFRESH_PATH}/${safeKey(userKey)}`, refreshToken);
}

/** Saqlangan refresh tokenni oladi. */
export async function getStoredGoogleRefreshToken(userKey) {
  if (!userKey) return null;
  const snap = await fb.get(`${GOOGLE_REFRESH_PATH}/${safeKey(userKey)}`);
  return snap.exists() ? snap.val() : null;
}

/** Zanjirni invalid qiladi (replay/kompromatda). */
export async function clearGoogleRefreshToken(userKey) {
  if (!userKey) return;
  await fb.set(`${GOOGLE_REFRESH_PATH}/${safeKey(userKey)}`, null);
}

// Race himoya: ikkita parallel refresh bir xil tokenni ishlatib, rotatsiyani
// chalkashtirmasligi uchun per-userKey lock (email-verify withLock andoza).
const refreshLocks = new Map();
function withRefreshLock(key, fn) {
  const prev = refreshLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  refreshLocks.set(key, next.catch(() => {}));
  return next;
}

/**
 * Refresh token rotatsiya (AUTH A-24 §11).
 *
 * Qoidalar:
 *   - Taqdim etilgan token saqlanganga TENG bo'lishi kerak.
 *   - Eski (allaqachon rotated) token kelsa → 'replay' → zanjir invalid + audit.
 *   - Google yangi refresh_token bersa → saqlanadi (rotatsiya).
 *
 * Test'da deps injeksiyasi (haqiqiy tarmoq/DB'siz):
 *   { getStored, setStored, clearStored, fetch }
 *
 * @returns {Promise<{ok: boolean, error?: string, rotated?: boolean, status?: number}>}
 */
export async function rotateGoogleRefreshToken({ userKey, currentRefreshToken, deps = {} }) {
  const getStored = deps.getStored || getStoredGoogleRefreshToken;
  const setStored = deps.setStored || storeGoogleRefreshToken;
  const clearStored = deps.clearStored || clearGoogleRefreshToken;
  const doFetch = deps.fetch || ((url, opts) => fetch(url, opts));

  if (!userKey || !currentRefreshToken) {
    return { ok: false, error: 'missing-token' };
  }

  // Review fix: parallel refresh race'ini yopish (per-userKey lock)
  return withRefreshLock(`refresh:${safeKey(userKey)}`, async () => {
    const stored = await getStored(userKey);
    if (!stored) {
      return { ok: false, error: 'no-stored-token' };
    }
    if (stored !== currentRefreshToken) {
      // Rotated token qayta ishlatildi → kompromat signali
      console.warn('[OIDC] refresh token REPLAY — zanjir invalid qilindi');
      await clearStored(userKey).catch(() => {});
      return { ok: false, error: 'replay' };
    }

    const params = new URLSearchParams({
      refresh_token: currentRefreshToken,
      client_id: GOOGLE_CONFIG.clientId,
      client_secret: GOOGLE_CONFIG.clientSecret,
      grant_type: 'refresh_token',
    });
    try {
      const response = await doFetch(GOOGLE_CONFIG.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn('[OIDC] refresh exchange failed:', response.status, body.slice(0, 120));
        return { ok: false, error: 'exchange-failed', status: response.status };
      }
      const data = await response.json();
      let rotated = false;
      if (data.refresh_token) {
        await setStored(userKey, data.refresh_token); // rotatsiya
        rotated = true;
      }
      return { ok: true, rotated, accessToken: data.access_token || null, expiresIn: data.expires_in || 3600 };
    } catch (err) {
      console.warn('[OIDC] refresh network error:', err?.message || err);
      return { ok: false, error: 'network' };
    }
  });
}

/**
 * Get the Google auth URL for the sign-in button.
 * Returns null when OIDC is not configured.
 */
export function getAuthUrl(session) {
  return buildAuthUrl(session);
}
