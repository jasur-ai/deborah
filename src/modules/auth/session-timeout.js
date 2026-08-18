/**
 * Deborah — Session idle timeout helpers (AUTH A-02)
 *
 * Sof funksiyalar — middleware'dan va unit testlardan ishlatiladi.
 * Idle timeout: sessiya harakatsizlik limitidan oshsa bekor qilinadi.
 * Touch throttling: lastActive har request'da emas, oraliqda bir marta yangilanadi
 * (Redis/MemoryStore yozuvlarni kamaytiradi).
 */
import CONFIG from '../../config/env.js';
import { absoluteTimeoutMs, rotateIntervalMs } from './session-store.js';

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 daqiqa
export const DEFAULT_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // 5 daqiqa
export const WARN_BEFORE_MS = 60 * 1000; // frontend ogohlantirish — 60 soniya oldin

// AUTH A-25: sensitive amallar uchun re-auth TTL (parol/email change, teacher approve)
export const DEFAULT_REAUTH_TTL_MS = 10 * 60 * 1000; // 10 daqiqa

/** Idle timeout davomiyligi (tenant config'dan). */
export function idleTimeoutMs() {
  return CONFIG.SESSION_IDLE_TIMEOUT_MS || DEFAULT_IDLE_TIMEOUT_MS;
}

/** Touch oraliq (throttle). */
export function touchIntervalMs() {
  return CONFIG.SESSION_TOUCH_INTERVAL_MS || DEFAULT_TOUCH_INTERVAL_MS;
}

/**
 * Sessiya idle timeout o'tganmi?
 * lastActiveAt yo'q (yangi sessiya) — fail-open (hali tekshirilmagan).
 * @param {number|undefined} lastActiveAt
 * @param {number} [now]
 * @param {number} [idleMs]
 */
export function isSessionExpired(lastActiveAt, now = Date.now(), idleMs = idleTimeoutMs()) {
  if (typeof lastActiveAt !== 'number' || !Number.isFinite(lastActiveAt)) return false;
  return now - lastActiveAt > idleMs;
}

/**
 * lastActive yangilash kerakmi? (throttle — oraliq o'tmagan bo'lsa yozilmaydi)
 * @param {number|undefined} lastActiveAt
 * @param {number} [now]
 * @param {number} [intervalMs]
 */
export function shouldTouch(lastActiveAt, now = Date.now(), intervalMs = touchIntervalMs()) {
  if (typeof lastActiveAt !== 'number') return true;
  return now - lastActiveAt >= intervalMs;
}

/**
 * AUTH A-25: absolute session timeout — login'dan boshlab qat'iy limit (12 soat).
 * Idle'dan farqli: har qanday harakat bo'lsa ham o'tadi.
 * @param {number|undefined} startedAt
 * @param {number} [now]
 * @param {number} [absoluteMs]
 */
export function isAbsoluteExpired(startedAt, now = Date.now(), absoluteMs = absoluteTimeoutMs()) {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  return now - startedAt > absoluteMs;
}

/**
 * AUTH A-25: mid-session ID rotation vaqti keldimi? (hijack window kamayadi)
 * @param {number|undefined} lastRotatedAt
 * @param {number} [now]
 * @param {number} [intervalMs]
 */
export function shouldRotateSession(lastRotatedAt, now = Date.now(), intervalMs = rotateIntervalMs()) {
  if (typeof lastRotatedAt !== 'number') return true;
  return now - lastRotatedAt >= intervalMs;
}

/**
 * AUTH A-25: re-auth hali yangimi? (sensitive amallar uchun — OWASP)
 * @param {number|undefined} reauthedAt
 * @param {number} [now]
 * @param {number} [ttlMs]
 */
export function isReauthFresh(reauthedAt, now = Date.now(), ttlMs = CONFIG.REAUTH_TTL_MS || DEFAULT_REAUTH_TTL_MS) {
  if (typeof reauthedAt !== 'number' || !Number.isFinite(reauthedAt)) return false;
  return now - reauthedAt <= ttlMs;
}

/**
 * Idle timeout'dan keyin login'ga qaytish havolasi (returnUrl).
 * Open-redirect himoyasi: safeReturnUrl bilan bir xil qoida.
 * @param {string|undefined} originalUrl
 * @returns {string} encode qilingan relative path
 */
export function loginReturnUrl(originalUrl) {
  return encodeURIComponent(safeReturnUrl(originalUrl));
}

/**
 * Login'dan keyin returnUrl'ga qaytish — allowlist bilan (AUTH A-05).
 *
 * A-04/A-05 guide: returnUrl allowlist (/, /panel, /assignments, /teacher/*,
 * /admin/*). Relative path bo'lsa ham faqat ma'lum prefikslarga ruxsat
 * beriladi — XSS/open-redirect xavfini kamaytiradi (masalan `/'>...`).
 *
 * Ruxsat etilgan prefikslar (segment darajasida):
 *   /, /user, /panel, /assignments, /teacher, /student, /proctor, /marker,
 *   /board, /admin, /game, /cast
 *
 * @param {string|undefined} candidate
 * @returns {string} xavfsiz relative path yoki /user/panel
 */
export const ALLOWED_RETURN_PREFIXES = [
  '/user', '/panel', '/assignments', '/teacher', '/student', '/proctor',
  '/marker', '/board', '/admin', '/game', '/cast', '/api',
];

export function safeReturnUrl(candidate) {
  if (typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//')) {
    // JS scheme'lar va absolute URL'lar bloklanadi (starts with '/' va '//' emas)
    if (candidate === '/' ) return candidate;
    // Path-traversal normalizatsiya: '/user/../admin' → '/admin' (browser
    // Location'ni normalizatsiya qiladi — allowlist bypass bo'lmasin).
    const normPath = candidate
      .split('?')[0]
      .split('/')
      .filter(Boolean)
      .reduce((acc, seg) => {
        if (seg === '..') return acc.slice(0, -1); // parent — o'tkazib yuboramiz
        if (seg === '.' || seg === '') return acc;
        return [...acc, seg];
      }, [])
      .join('/');
    // Segment darajasida allowlist — '/admin/evil' emas, '/admin' prefiksi ruxsat.
    const firstSegment = '/' + normPath.split('/')[0];
    if (ALLOWED_RETURN_PREFIXES.includes(firstSegment)) {
      return candidate;
    }
  }
  return '/user/panel';
}

// ── Frontend timeout modal copy (AUTH A-02, a11y: live-region matnlar) ──
export const SESSION_TIMEOUT_COPY = {
  uz: {
    title: 'Sessiya tugayapti',
    body: 'Harakatsizlik tufayli sessiya tez orada yakunlanadi.',
    countdown: 'Qolgan vaqt',
    keep: 'Davom etish',
    logout: 'Chiqish',
    second: 'soniya',
  },
  ru: {
    title: 'Сессия истекает',
    body: 'Из-за неактивности сессия скоро завершится.',
    countdown: 'Осталось времени',
    keep: 'Продолжить',
    logout: 'Выйти',
    second: 'сек',
  },
  cyrl: {
    title: 'Сессия тугаяпти',
    body: 'Ҳаракатсизлик туфайли сессия тез орада якунланади.',
    countdown: 'Қолган вақт',
    keep: 'Давом этиш',
    logout: 'Чиқиш',
    second: 'сония',
  },
};

/** Foydalanuvchi tili bo'yicha copy (fallback: uz). */
export function sessionTimeoutCopy(lang) {
  return SESSION_TIMEOUT_COPY[lang] || SESSION_TIMEOUT_COPY.uz;
}
