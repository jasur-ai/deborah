/**
 * Deborah — Bot Guard (AUTH B-08)
 * -------------------------------------------------
 * Register'ni bot'lardan himoyalash — layered:
 *   1. Honeypot (A-21, yashirin field) — bot'lar to'ldiradi → silent 200.
 *   2. Turnstile (Cloudflare) — widget + server siteverify; secret backend'da.
 *   3. Rate limit (layered): per-IP 5/15 (A-03 lockout.js) + per-email 3/soat.
 *
 * TURNSTILE_SECRET_KEY yo'q bo'lsa → fail-open ({ ok:true, skipped:true }) —
 * dev/test'da widget ishlamaydi, lekin honeypot + rate limitlar doim ishlaydi.
 * Production'da secret o'rnatilgan bo'lsa, Turnstile qat'iy tekshiriladi
 * (botDetected signal → risk score, C-faza).
 */

// ── Config ──
const SITE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EMAIL_MAX_PER_HOUR = 3; // per-email 3/soat (distributed bot signup qarshi)
const EMAIL_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_KEYS = 10000;

// AUTH B-34 — signup velocity + review queue (C-01 config'dan qoidalar)
const SIGNUP_VELOCITY_IP_MAX_PER_HOUR = Number(process.env.SIGNUP_VELOCITY_IP_MAX_PER_HOUR || 15); // per-IP yumshoq (kampus NAT)
const SIGNUP_VELOCITY_FP_MAX_PER_HOUR = Number(process.env.SIGNUP_VELOCITY_FP_MAX_PER_HOUR || 10); // per-fingerprint qattiq
const SIGNUP_VELOCITY_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_VELOCITY_PATH = 'signup_velocity';
const SIGNUP_DOMAIN_HISTORY_PATH = 'signup_domain_history';
const SIGNUP_REVIEWS_PATH = 'signup_reviews';

import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from './audit.js';
import { recordMetric } from '../../../src/telemetry/index.js';

/** per-email signup urinishlari (memory; C-faza: Redis/ASN). */
const emailAttempts = new Map();

function bump(map, key, max, windowMs) {
  const now = Date.now();
  const arr = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((arr[0] + windowMs - now) / 1000) };
  }
  arr.push(now);
  // Eviction: eng eski kalit chiqariladi, keyin HAR DOIM map.set — aks holda
  // to'liq map'da yangi kalitning birinchi urinishi yo'qolardi (review fix).
  if (map.size > RATE_MAX_KEYS) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  map.set(key, arr);
  return { allowed: true };
}

/**
 * B-08 §06: honeypot field to'ldirilganmi? Bot'lar yashirin input'ni to'ldiradi.
 * @param {unknown} val — yashirin field qiymati
 */
export function isHoneypotTriggered(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

/**
 * B-08 §07: Cloudflare Turnstile token'ni server tomonda verify qiladi.
 * TURNSTILE_SECRET_KEY yo'q → fail-open (dev/test). Secret bor → siteverify
 * API; noto'g'ri/eskirgan token → { ok:false }. Token yo'q va secret bor → 400.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string, httpStatus?: number }>}
 */
export async function verifyTurnstile(token) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Secret o'rnatilmagan — widget ko'rsatilmaydi; honeypot+rate limit qoladi.
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== 'string' || token.length < 4) {
    return { ok: false, error: 'turnstile_required', httpStatus: 400 };
  }

  try {
    const resp = await fetch(SITE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: undefined }),
      // siteverify oddiy tezkor — 5s timeout yetarli
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return { ok: false, error: 'turnstile_error', httpStatus: 502 };
    }
    const data = await resp.json();
    if (data.success === true) return { ok: true };
    // Token yaroqsiz (bot) — fail-closed (secret bor bo'lsa)
    return { ok: false, error: 'bot_detected', httpStatus: 403 };
  } catch (err) {
    // Turnstile API ishlamayapti — fail-open (qisqa outage signup'ni buzmaydi),
    // lekin audit'dagi signup_blocked uchun signal yo'q; honeypot+limit qoladi.
    return { ok: true, skipped: true };
  }
}

/**
 * B-08 §08: per-email register limit (3/soat).
 * @param {string} email — canonical (lowercase trim)
 */
export function checkEmailRegisterLimit(email) {
  if (!email || typeof email !== 'string') return { allowed: true, retryAfterSeconds: 0 };
  const key = String(email).toLowerCase().trim();
  return bump(emailAttempts, key, EMAIL_MAX_PER_HOUR, EMAIL_WINDOW_MS);
}

/** Testlar uchun. */
export function _resetBotStores() {
  emailAttempts.clear();
}

// ═══════════════════════════════════════════════════════════════════════
// AUTH B-34 — Register security extra: signup velocity, domain reputation,
// review queue (bot fingerprint signup himoyasi)
// ═══════════════════════════════════════════════════════════════════════

function velocityDateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** DB counter'ni o'qiydi + increment qiladi (fail-open: DB ishlamasa soft). */
async function bumpVelocity(scope, key, max, now = Date.now()) {
  try {
    const path = `${SIGNUP_VELOCITY_PATH}/${velocityDateKey(now)}/${scope}/${safeKey(key)}`;
    const snap = await fb.get(path);
    const count = snap.exists() ? (snap.val().count || 0) : 0;
    if (count >= max) {
      return { allowed: false, count, retryAfterSeconds: 3600 };
    }
    // Tekshiruv o'tdi → counter'ni increment qilamiz (har urinish hisoblanadi)
    await fb.set(path, { count: count + 1, at: now });
    return { allowed: true, count: count + 1 };
  } catch (_) {
    // §23 Failure state: velocity yumshoq — blok EMAS (Turnstile qattiq qoladi)
    return { allowed: true, count: 0, failOpen: true };
  }
}

/**
 * §06/§07: signup velocity — per-IP (yumshoq, kampus NAT) + per-fingerprint
 * (qattiq). Limit'ga yaqin (max-2) → suspicious signal (review uchun score).
 * @param {{ ip?: string, fingerprint?: string|null }} opts
 * @returns {Promise<{allowed: boolean, reason?: string, retryAfterSeconds?: number, score?: number}>}
 */
export async function checkSignupVelocity({ ip = '', fingerprint = null }, now = Date.now()) {
  const fp = fingerprint && typeof fingerprint === 'string' ? fingerprint : null;
  let ipOk = true;
  let ipScore = 0;
  if (ip) {
    const r = await bumpVelocity('ip', ip, SIGNUP_VELOCITY_IP_MAX_PER_HOUR, now);
    ipOk = r.allowed;
    if (r.allowed) ipScore = Math.min(1, (r.count || 0) / SIGNUP_VELOCITY_IP_MAX_PER_HOUR);
  }
  if (!ipOk) {
    return { allowed: false, reason: 'velocity_ip', retryAfterSeconds: 3600, score: 1 };
  }
  // Per-fingerprint — qattiq (device ko'p account yaratmasin)
  if (fp) {
    const r = await bumpVelocity('fp', fp, SIGNUP_VELOCITY_FP_MAX_PER_HOUR, now);
    if (!r.allowed) {
      return { allowed: false, reason: 'velocity_fp', retryAfterSeconds: 3600, score: 1 };
    }
    // Fingerprint bo'yicha ham score (review uchun)
    const fpScore = Math.min(1, (r.count || 0) / SIGNUP_VELOCITY_FP_MAX_PER_HOUR);
    return { allowed: true, score: Math.max(ipScore, fpScore) };
  }
  return { allowed: true, score: ipScore };
}

/**
 * §07: muvaffaqiyatli register'dan keyin velocity counter'ni increment qiladi.
 * @returns {Promise<void>}
 */
export async function recordSignup({ ip = '', fingerprint = null }, now = Date.now()) {
  const day = velocityDateKey(now);
  const inc = async (scope, key) => {
    try {
      const path = `${SIGNUP_VELOCITY_PATH}/${day}/${scope}/${safeKey(key)}`;
      const snap = await fb.get(path);
      const count = snap.exists() ? (snap.val().count || 0) : 0;
      await fb.set(path, { count: count + 1, at: now });
    } catch (_) { /* non-critical */ }
  };
  if (ip) await inc('ip', ip);
  if (fingerprint) await inc('fp', fingerprint);
}

/**
 * §09: email domain reputatsiyasi — yangi domain (avval signup ko'rmagan)
 * → suspicious review; tanish domain → normal.
 * @returns {Promise<{known: boolean, count: number}>}
 */
export async function checkDomainReputation(domain) {
  if (!domain) return { known: true, count: 0 };
  try {
    const snap = await fb.get(`${SIGNUP_DOMAIN_HISTORY_PATH}/${safeKey(domain)}`);
    const count = snap.exists() ? (snap.val().count || 0) : 0;
    return { known: count > 0, count };
  } catch (_) {
    return { known: true, count: 0 }; // fail-open
  }
}

/** Muvaffaqiyatli signup'dan keyin domain history'ni oshiradi. */
export async function recordDomainSignup(domain, now = Date.now()) {
  if (!domain) return;
  try {
    const snap = await fb.get(`${SIGNUP_DOMAIN_HISTORY_PATH}/${safeKey(domain)}`);
    const count = snap.exists() ? (snap.val().count || 0) : 0;
    await fb.set(`${SIGNUP_DOMAIN_HISTORY_PATH}/${safeKey(domain)}`, { count: count + 1, lastAt: now });
  } catch (_) { /* non-critical */ }
}

/**
 * §10/§11: suspicious signup → review queue (admin manual verify).
 * @param {{ userId: string, reason: string, score?: number, ipHash?: string, fingerprintHash?: string|null, domain?: string|null }} opts
 * @returns {Promise<{ok: boolean, id?: string}>}
 */
export async function createSignupReview({
  userId,
  reason,
  score = 0.5,
  ipHash = null,
  fingerprintHash = null,
  domain = null,
}, now = Date.now()) {
  if (!userId || !reason) return { ok: false };
  try {
    const id = `${now}-${Math.random().toString(16).slice(2, 8)}`;
    await fb.set(`${SIGNUP_REVIEWS_PATH}/${id}`, {
      userId: safeKey(userId),
      reason, // velocity|fingerprint|domain
      score: Math.min(1, Math.max(0, score)),
      ipHash: ipHash || null,
      fingerprintHash: fingerprintHash || null, // faqat hash — PII yo'q (§14)
      domain: domain ? String(domain).toLowerCase().slice(0, 120) : null,
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
      reviewedBy: null,
    });
    logAuthEvent({
      action: AUDIT_ACTIONS.SIGNUP_REVIEW_CREATED,
      outcome: 'success',
      method: 'review',
      actorId: safeKey(userId),
      channel: 'signup',
      details: { reason, score: Math.min(1, Math.max(0, score)) },
    }).catch(() => {});
    recordMetric('signup.review_created', 1, { type: 'counter', labels: { reason } })?.catch?.(() => {});
    return { ok: true, id };
  } catch (_) {
    return { ok: false }; // review yozilmasa register buzilmaydi
  }
}

/** §10: review queue — status bo'yicha ro'yxat. */
export async function listSignupReviews({ status = 'pending', limit = 50 } = {}) {
  try {
    const snap = await fb.get(SIGNUP_REVIEWS_PATH);
    if (!snap || !snap.exists()) return [];
    return Object.entries(snap.val())
      .filter(([, r]) => r && r.status === status)
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
      .slice(0, limit)
      .map(([id, r]) => ({ id, ...r }));
  } catch (_) {
    return [];
  }
}

/**
 * §10: review resolve — approve (user ruxsat oladi) | reject (user bloklanadi).
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function resolveSignupReview({ id, decision, adminId = null }) {
  if (!id || !['approve', 'reject'].includes(decision)) return { ok: false, error: 'bad-input' };
  try {
    const snap = await fb.get(`${SIGNUP_REVIEWS_PATH}/${id}`);
    if (!snap.exists()) return { ok: false, error: 'not-found' };
    const rec = snap.val();
    if (rec.status !== 'pending') return { ok: false, error: 'not-pending' };
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await fb.set(`${SIGNUP_REVIEWS_PATH}/${id}/status`, status);
    await fb.set(`${SIGNUP_REVIEWS_PATH}/${id}/resolvedAt`, Date.now());
    await fb.set(`${SIGNUP_REVIEWS_PATH}/${id}/reviewedBy`, adminId || null);
    // Reject → user'ni bloklaymiz (signup flag) — admin qarori
    if (decision === 'reject' && rec.userId) {
      await fb.set(`users/${rec.userId}/signup_review_blocked`, { at: Date.now(), reason: rec.reason }).catch(() => {});
    }
    logAuthEvent({
      action: AUDIT_ACTIONS.SIGNUP_REVIEW_RESOLVED,
      outcome: decision === 'approve' ? 'approved' : 'rejected',
      method: 'admin',
      actorId: adminId || null,
      channel: 'signup',
      details: { reviewId: id, reason: rec.reason },
    }).catch(() => {});
    recordMetric('signup.review_resolved', 1, { type: 'counter', labels: { decision } })?.catch?.(() => {});
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'store-error' };
  }
}

/** §24: review queue chuqurligi (observability). */
export async function signupReviewDepth() {
  try {
    const snap = await fb.get(SIGNUP_REVIEWS_PATH);
    if (!snap || !snap.exists()) return 0;
    return Object.values(snap.val()).filter((r) => r && r.status === 'pending').length;
  } catch (_) {
    return -1;
  }
}
