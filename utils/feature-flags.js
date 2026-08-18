/**
 * ═══════════════════════════════════════════════════════════════════════
 * STEP 40 — Feature flags: incremental migration va rollout (S40.02, S40.07)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Har bir dizayn konteksti mustaqil flag bilan boshqariladi — failure blast
 * radius kichik, har bosqich rollback qilinadi.
 *
 * Kontekstlar (S40.07 — independent rollout):
 *   theme     — design tokens/theme (semantic palette)
 *   landing   — public landing sahifasi
 *   auth      — login/register/forgot sahifalari
 *   workspace — user panel/test builder
 *   cast      — Cast director/participant/projector
 *   admin     — admin dashboard/panellari
 *
 * Manbalar (priority yuqoridan pastga):
 *   1. Query:    ?ff_<ctx>=0|1        — dev/testing uchun (NODE_ENV !== production)
 *   2. Env:      EDIKIT_FF_<CTX>=0|1  — infra level rollout
 *   3. Cookie:   edikit_ff_<ctx>       — session-stable (S40.02: active session
 *                                         o'rtasida visual shell almashtirilmaydi)
 *   4. Default:  ON (yangi dizayn — redesign allaqachon production default)
 *
 * Rollout pattern: EDIKIT_FF_<CTX>=0 → 1 foiz ishlatuvchilarga (query/cookie
 * orqali), xatolik kuzatiladi, keyin 100%.
 */
/** Cookie'ni o'qish (minimal parse — helpers.getCookie yo'qligi uchun lokal). */
function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// Barcha kontekstlar — yangi dizayn default ON
export const FLAG_CONTEXTS = ['theme', 'landing', 'auth', 'workspace', 'cast', 'admin'];

/** Flag nomini kanonik formaga keltirish: 'theme' → 'EDIKIT_FF_THEME', 'cast' → 'EDIKIT_FF_CAST' */
export function envName(ctx) {
  return `EDIKIT_FF_${ctx.toUpperCase()}`;
}

/**
 * Bitta kontekst uchun flag qiymatini hisoblash.
 * @returns {boolean} flag enabled
 */
export function resolveFlag(req, ctx) {
  if (!FLAG_CONTEXTS.includes(ctx)) return true;

  // 1. Query override (faqat non-production)
  if (process.env.NODE_ENV !== 'production' && req?.query) {
    const q = req.query[`ff_${ctx}`];
    if (q === '0') return false;
    if (q === '1') return true;
  }

  // 2. Env
  const env = process.env[envName(ctx)];
  if (env === '0') return false;
  if (env === '1') return true;

  // 3. Cookie (session-stable)
  const cookieVal = req?.headers?.cookie ? readCookie(req.headers.cookie, `edikit_ff_${ctx}`) : null;
  if (cookieVal === '0') return false;
  if (cookieVal === '1') return true;

  // 4. Default ON
  return true;
}

/**
 * Barcha kontekstlar uchun flags obyekti.
 * @returns {Record<string, boolean>}
 */
export function resolveFlags(req) {
  const out = {};
  for (const ctx of FLAG_CONTEXTS) out[ctx] = resolveFlag(req, ctx);
  return out;
}

/**
 * S40.02 — session-stable kontekstlar: visual shell + active session.
 * Ushbu kontekstlar uchun flag qiymati cookie'da mustahkamlanadi — session
 * o'rtasida visual shell o'zgarmaydi.
 */
export function sessionStableContexts() {
  return ['theme', 'cast'];
}

/**
 * Session-stable cookie'ni hisoblash: agar flag default (ON) dan farq qilsa,
 * `edikit_ff_<ctx>=<0|1>` cookie'ini o'rnatish kerak. Farq bo'lmasa — null
 * (cookie o'rnatilmaydi, default yetarli).
 * @returns {Array<{name: string, value: string, maxAge: number}>}
 */
export function sessionStableCookies(req) {
  const cookies = [];
  for (const ctx of sessionStableContexts()) {
    const enabled = resolveFlag(req, ctx);
    // Flag ON (default) bo'lsa — cookie shart emas; OFF bo'lsa — mustahkamlaymiz
    if (!enabled) {
      cookies.push({
        name: `edikit_ff_${ctx}`,
        value: '0',
        maxAge: 7 * 24 * 60 * 60, // 7 kun
      });
    }
  }
  return cookies;
}

/** CLI test uchun: env-only resolve (req'siz) */
export function resolveFlagsForTest(env = process.env) {
  const out = {};
  for (const ctx of FLAG_CONTEXTS) {
    const v = env[envName(ctx)];
    out[ctx] = !(v === '0');
  }
  return out;
}
