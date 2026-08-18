/**
 * AUTH A-23 — Email validation (signup'da)
 * -------------------------------------------------
 * 1. Syntax (bazaviy — Zod emailInvalid bilan birga)
 * 2. MX tekshiruvi (domain'da mail server bormi) — async, 200ms budget
 * 3. Disposable (temp-mail) blok — hard block
 *
 * Performans:
 *   - MX natijasi 24 soat cache (Map) — takroriy so'rovlar DNS'ga chiqmaydi
 *   - Budget: MX lookup 200ms timeout (AbortController)
 *   - Test rejimida DNS'ga chiqmaydi (NODE_ENV=test → mx skip, fail-open)
 *
 * Disposable ro'yxat — eng keng tarqalgan temp-mail provayderlari
 * (to'liq ro'yxat: https://github.com/disposable-email-domains — deploy'da
 *  `DISP_DOMAINS_JSON` fayl orqali ulash mumkin).
 */

import dns from 'dns/promises';
import net from 'net';

const MX_TIMEOUT_MS = 200;
const MX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MX_CACHE_MAX = 5000; // review fix: xotira guard (spam register urinishlar)

// ── AUTH B-05: typo suggestion ──
// Ommabop doménlar — typo'da taklif faqat ishonchli holatda chiqadi (§26).
const COMMON_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'mail.ru', 'yandex.ru', 'yandex.com', 'icloud.com',
  'proton.me', 'protonmail.com', 'deborah.uz', 'aol.com',
];

// Aniq (ma'lum) typo xaritalari — Levenshtein 1 dan ham ishonchli.
const DOMAIN_TYPOS = new Map([
  ['gmial.com', 'gmail.com'], ['gmai.com', 'gmail.com'], ['gmil.com', 'gmail.com'],
  ['gmiall.com', 'gmail.com'], ['gmaill.com', 'gmail.com'], ['gamil.com', 'gmail.com'],
  ['hotmial.com', 'hotmail.com'], ['hotmil.com', 'hotmail.com'], ['hotmail.co', 'hotmail.com'],
  ['yaho.com', 'yahoo.com'], ['yahooo.com', 'yahoo.com'], ['yhaoo.com', 'yahoo.com'],
  ['outllok.com', 'outlook.com'], ['outlok.com', 'outlook.com'],
  ['yandexr.ru', 'yandex.ru'], ['yndex.ru', 'yandex.ru'],
  ['icloud.co', 'icloud.com'], ['protom.me', 'proton.me'],
]);

/** Oddiy Levenshtein masofa (kichik string'lar uchun yetarli). */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Domén typo taklifi — faqat ishonchli holatda qaytaradi (§26):
 *  - aniq typo xarita (gmial→gmail)
 *  - yoki Levenshtein masofa 1 (uzunlik farqi ≤1)
 * @returns {string|null} — to'g'ri domén yoki null
 */
export function suggestDomainFix(domain) {
  const d = String(domain || '').trim().toLowerCase();
  if (!d || d.length < 4) return null;
  if (COMMON_DOMAINS.includes(d) || DOMAIN_TYPOS.has(d)) {
    return DOMAIN_TYPOS.get(d) || null;
  }
  for (const known of COMMON_DOMAINS) {
    if (Math.abs(known.length - d.length) > 1) continue;
    if (levenshtein(d, known) === 1) return known;
  }
  return null;
}


const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', '10minutemail.com', 'temp-mail.org', 'guerrillamail.com',
  'yopmail.com', 'throwawaymail.com', 'sharklasers.com', 'maildrop.cc',
  'getnada.com', 'tempmail.com', 'mohmal.com', 'emailondeck.com',
  'dispostable.com', 'trashmail.com', 'mailnesia.com', 'tempinbox.com',
  'spamgourmet.com', 'mintemail.com', 'burnermail.io', 'mailtemp.net',
  'mailmetrash.com', 'maileater.com', 'mytrashmail.com', 'inboxbear.com',
  'fakemailgenerator.com', 'fakeinbox.com', 'throwaway.email', 'tempail.com',
  'tmail.ws', '0-mail.com', '0815.ru', 'discard.email', 'nada.email',
  'one-time.email', 'tmpmail.org', 'luxusmail.org', 'spambox.us',
  'safetymail.info', 'mailcatch.com', 'deadaddress.com', 'casualdx.com',
]);

const mxCache = new Map(); // domain -> { ok: boolean, at: number }

function cacheSet(domain, val) {
  mxCache.set(domain, val);
  if (mxCache.size > MX_CACHE_MAX) {
    // Eng eski key'ni tashlab yuboramiz (LRU-ish eviction)
    mxCache.delete(mxCache.keys().next().value);
  }
}

function emailParts(email) {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/i.exec(String(email || '').trim());
  if (!m) return null;
  return { local: m[0].split('@')[0], domain: m[1].toLowerCase() };
}

function isDisposable(domain) {
  const base = domain.replace(/^www\./, '');
  return DISPOSABLE_DOMAINS.has(base) || DISPOSABLE_DOMAINS.has(base.split('.').slice(-2).join('.'));
}

/**
 * MX lookup (200ms budget, 24h cache). Test'da DNS'ga chiqmaydi (fail-open).
 */
export async function checkMx(domain) {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_CACHE_TTL_MS) return cached.ok;

  if (process.env.NODE_ENV === 'test') {
    mxCache.set(domain, { ok: true, at: Date.now() }); // test: fail-open
    return true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MX_TIMEOUT_MS);
  try {
    const records = await dns.resolveMx(domain, { signal: controller.signal });
    const ok = Array.isArray(records) && records.length > 0;
    cacheSet(domain, { ok, at: Date.now() });
    return ok;
  } catch (err) {
    // Review fix: faqat mavjud bo'lmagan domain (ENOTFOUND) rad etiladi.
    // Timeout/AbortError/ENODATA (MX yo'q lekin A-record bor — qabul qilishi
    // mumkin) va boshqa transient xatolar → fail-open (register buzilmaydi).
    const code = err?.code;
    if (code === 'ENOTFOUND') {
      cacheSet(domain, { ok: false, at: Date.now() });
      return false;
    }
    cacheSet(domain, { ok: true, at: Date.now() });
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * To'liq validatsiya: syntax + disposable + MX.
 * @returns {Promise<{ok: boolean, reason?: 'syntax'|'disposable'|'no-mx', checked: boolean}>}
 *   checked — MX haqiqatan tekshirildi (test'da false).
 */
export async function validateEmail(email, deps = {}) {
  const parts = emailParts(email);
  if (!parts) return { ok: false, reason: 'syntax', checked: false };

  if (isDisposable(parts.domain)) {
    return { ok: false, reason: 'disposable', checked: false };
  }

  const mxOk = await (deps.checkMx || checkMx)(parts.domain);
  return mxOk ? { ok: true, checked: true } : { ok: false, reason: 'no-mx', checked: true };
}

/**
 * AUTH B-05: tez validatsiya (blur/submit) — syntax + disposable + MX + typo.
 * validateEmail'ning kengaytmasi — `suggestion` qo'shadi (faqat ishonchli).
 * @returns {Promise<{ok: boolean, reason?: 'syntax'|'disposable'|'no-mx',
 *   suggestion: string|null, checked: boolean}>}
 */
export async function validateFast(email, deps = {}) {
  const parts = emailParts(email);
  if (!parts) return { ok: false, reason: 'syntax', suggestion: null, checked: false };

  if (isDisposable(parts.domain)) {
    return { ok: false, reason: 'disposable', suggestion: null, checked: false };
  }

  const mxOk = await (deps.checkMx || checkMx)(parts.domain);
  if (!mxOk) return { ok: false, reason: 'no-mx', suggestion: null, checked: true };

  const suggestion = deps.suggest ? deps.suggest(parts.domain) : suggestDomainFix(parts.domain);
  return { ok: true, reason: null, suggestion, checked: true };
}

/**
 * AUTH B-05: SMTP javob kodini talqin qilish (pure — unit test uchun).
 *  250 → exists · 550/551/553/554 → missing · 451 (greylisting) → retry
 *  qolganlari → unknown (fail-open).
 * @returns {{ mailbox?: 'exists'|'missing'|'unknown', retry?: boolean }}
 */
export function interpretSmtpReply(code, { greylisted = false } = {}) {
  if (code === 250) return { mailbox: 'exists' };
  if ([550, 551, 553, 554].includes(code)) return { mailbox: 'missing' };
  // Greylisting (451): server vaqtincha rad etdi — bir marta qayta urinamiz (§25)
  if (code === 451 && !greylisted) return { retry: true };
  return { mailbox: 'unknown' };
}

/**
 * AUTH B-05: minimal SMTP dialog — EHLO → MAIL FROM → RCPT TO.
 * Har doim resolve qiladi (throw emas); fail-open.
 * @param {string} host MX server
 * @param {{from: string, to: string, timeoutMs?: number}} opts
 * @returns {Promise<{mailbox: 'exists'|'missing'|'unknown', code?: number, error?: string}>}
 */
export function smtpDialog(host, opts = {}) {
  const { from, to, timeoutMs = 4000 } = opts;
  return new Promise((resolve) => {
    let buffer = '';
    let stage = 'banner'; // banner → ehlo → mailfrom → rcpt
    let greylisted = false;

    const sock = net.connect({ host, port: 25, timeout: timeoutMs });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ mailbox: 'unknown', error: 'timeout' });
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      sock.destroy();
      resolve(result);
    };
    const send = (line) => sock.write(line + '\r\n');

    sock.setEncoding('utf8');
    sock.on('error', () => finish({ mailbox: 'unknown', error: 'connect_failed' }));
    sock.on('close', () => {
      if (stage !== 'rcpt') finish({ mailbox: 'unknown', error: 'closed' });
    });
    sock.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const code = parseInt(line.slice(0, 3), 10);
        const isLast = line.length > 3 && line[3] === ' ';
        if (Number.isNaN(code) || !isLast) continue; // multipart davom etadi

        if (stage === 'banner') {
          stage = 'ehlo';
          send('EHLO deborah.uz');
        } else if (stage === 'ehlo') {
          stage = 'mailfrom';
          send(`MAIL FROM:<${from}>`);
        } else if (stage === 'mailfrom') {
          stage = 'rcpt';
          send(`RCPT TO:<${to}>`);
        } else if (stage === 'rcpt') {
          const res = interpretSmtpReply(code, { greylisted });
          if (res.retry) {
            greylisted = true;
            stage = 'ehlo'; // greylisting — dialogni qayta boshlaymiz (§25)
            send('EHLO deborah.uz');
          } else {
            finish({ mailbox: res.mailbox, code });
            return;
          }
        }
      }
    });
  });
}

/**
 * AUTH B-05: SMTP probe (mailbox mavjudligi) — EHLO/MAIL FROM/RCPT TO.
 * Test'da tarmoqqa chiqmaydi; har qanday xato → fail-open 'unknown'.
 * @returns {Promise<{mailbox: 'unknown'|'exists'|'missing', error?: string}>}
 */
export async function smtpProbe(domain, deps = {}) {
  // Test'da tarmoqqa chiqmaydi — LEKIN deps.dialog inyeksiya qilingan bo'lsa
  // (unit test) real dialog o'rniga uni ishlatamiz (skip faqat default yo'l).
  if (process.env.NODE_ENV === 'test' && !deps.dialog) return { mailbox: 'unknown' };
  const resolveMx = deps.resolveMx || dns.resolveMx;
  try {
    const records = await resolveMx(domain);
    if (!Array.isArray(records) || records.length === 0) return { mailbox: 'unknown' };
    const host = records[0].exchange;
    const res = await (deps.dialog || smtpDialog)(host, {
      from: 'probe@deborah.uz',
      to: `probe@${domain}`,
    });
    return res;
  } catch (_) {
    return { mailbox: 'unknown' };
  }
}

/**
 * AUTH B-05: to'liq (background) validatsiya — register'dan keyin fire-and-
 * forget. Natija faqat flag/metrika uchun — signup'ni HECH QACHON buzmaydi.
 * @returns {Promise<{ok: true, mailbox: string, error?: string}>}
 */
export async function validateFull(email, deps = {}) {
  const probe = deps.probe || smtpProbe;
  const parts = emailParts(email);
  if (!parts) return { ok: true, mailbox: 'unknown' };
  try {
    const res = await probe(parts.domain);
    return { ok: true, ...res };
  } catch (_) {
    return { ok: true, mailbox: 'unknown', error: 'probe_error' };
  }
}

/** Test'da cache'ni tozalash. */
export function _emailCacheResetForTests() {
  mxCache.clear();
}
