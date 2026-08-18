/**
 * AUTH C-01 — Tiered rate limiter middleware (sliding-window + token-bucket)
 * ---------------------------------------------------------------------------
 * `createAuthRateLimiter({ redis, redisOk })` → `authLimiter(routeKey)` factory.
 *
 * Tier'lar (config: src/config/rate-limits.js):
 *   - ip / account / asn / admin / user / burst
 * Sliding-window: 2 bucket (joriy + oldingi, proporsional qoldiq) — Redis'da
 * Lua (INCR + PEXPIRE atomic, §27), test/dev'da in-memory (bir xil logika).
 *
 * 429: { error: 'RATE_LIMITED', retryAfter } + Retry-After + X-RateLimit-*
 * header'lar (§10-§11). Audit: rate_limit_hit (endpoint, tier) + metric (§13).
 * Fail-open: Redis/ASN ishlamasa tier skip qilinadi (§23).
 */
import { createHash } from 'crypto';
import { ENDPOINT_LIMITS } from '../src/config/rate-limits.js';
import { resolveAsn } from '../src/modules/auth/asn.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';
import { recordMetric } from '../src/telemetry/index.js';
import { startSpan, endSpan } from '../src/telemetry/tracer.js'; // AUTH D-05: rate-limit span

const LUA_INCR = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local p = redis.call('GET', KEYS[2])
return { c, p and tonumber(p) or 0 }
`;

function bucketKey(routeKey, tier, key, windowMs, now) {
  const bucket = Math.floor(now / windowMs);
  return `rl:${routeKey}:${tier}:${bucket}:${hashKey(key)}`;
}

function hashKey(val) {
  const secret = process.env.SESSION_SECRET || 'rate-limit';
  return createHash('sha256').update(`${secret}:${val}`).digest('hex').slice(0, 24);
}

/** Account kaliti — raw PII yo'q (HMAC-hash); aniqlanmasa null (tier skip). */
function accountKeyOf(req) {
  const raw = req.body?.username || req.body?.email || req.session?.user?.safeKey || '';
  return raw ? hashKey(String(raw).toLowerCase().trim()) : null;
}

/** Redis script'ni cache'laydi (bitta upload) */
const scriptCache = new Map();

export function createAuthRateLimiter({ redis = null, redisOk = false } = {}) {
  const mem = new Map(); // key -> { count, windowStart }

  async function countInWindow(routeKey, tier, key, windowMs, now) {
    const cur = bucketKey(routeKey, tier, key, windowMs, now);
    const prev = bucketKey(routeKey, tier, key, windowMs, now - windowMs);
    if (redisOk && redis) {
      try {
        let sha = scriptCache.get('rl');
        if (!sha) {
          sha = await redis.script('LOAD', LUA_INCR);
          scriptCache.set('rl', sha);
        }
        const res = await redis.evalsha(sha, 2, cur, prev, String(2 * windowMs));
        const [curCount, prevCount] = [Number(res[0] || 0), Number(res[1] || 0)];
        const frac = (now % windowMs) / windowMs;
        return { count: curCount + prevCount * frac, resetAt: (Math.floor(now / windowMs) + 1) * windowMs };
      } catch (_) {
        // Redis down → yumshoq (fail-open, §23)
        return null;
      }
    }
    // In-memory sliding window (bir xil 2-bucket logika)
    const prevKey = `${cur}|p`;
    const prevEntry = mem.get(prevKey);
    const frac = (now % windowMs) / windowMs;
    const prevCount = prevEntry ? prevEntry.count : 0;
    const entry = mem.get(cur);
    const count = entry ? entry.count + 1 : 1;
    mem.set(cur, { count, windowStart: now });
    mem.set(prevKey, { count: prevCount, windowStart: now });
    if (mem.size > 50000) {
      const oldest = mem.keys().next().value;
      if (oldest) mem.delete(oldest);
    }
    return { count: count + prevCount * frac, resetAt: (Math.floor(now / windowMs) + 1) * windowMs };
  }

  /** @param {string} routeKey — ENDPOINT_LIMITS kaliti */
  function authLimiter(routeKey, opts = {}) {
    const baseCfg = ENDPOINT_LIMITS[routeKey];
    if (!baseCfg) return (req, res, next) => next(); // noma'lum route — o'tkazib yubor

    return async (req, res, next) => {
      // POST /user/login + mode=reg → register tier (B-03: register POST
      // /user/login'ga mode:'reg' bilan keladi; register GET sahifasi alohida).
      // MUHIM: closure'ni mutatsiya qilma — har request'da lokal (register
      // POST'idan keyin login POST'lari ham register cfg bilan ishlamasligi
      // uchun).
      const cfg = (routeKey === 'login' && req.body?.mode === 'reg' && ENDPOINT_LIMITS.register)
        ? ENDPOINT_LIMITS.register
        : baseCfg;
      // Faqat state-changing method'lar sanaladi (GET sahifa yuklashlari
      // login/register limiter'ga urilmasligi uchun — A-03 testi GET+POST
      // ketma-ket qiladi; express-rate-limit'ning `skip` kontrakti bilan bir xil).
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      const now = Date.now();
      const ip = req.ip || '';
      let blocked = null; // { tier, retryAfterSeconds }
      let best = null;    // { limit, remaining, resetAt }

      const check = async (tier, key, limit, windowMs) => {
        if (!limit || !key) return;
        const r = await countInWindow(routeKey, tier, key, windowMs, now);
        if (!r) return; // fail-open
        const remaining = Math.max(0, Math.floor(limit - r.count));
        const resetAt = r.resetAt;
        if (!best || remaining < best.remaining) {
          best = { tier, limit, remaining, resetAt };
        }
        // express-rate-limit semantikasi: max ta request o'tadi, (max+1)-chisi blok
        if (r.count > limit) {
          blocked = { tier, retryAfterSeconds: Math.ceil((resetAt - now) / 1000) };
        }
      };

      // Tier'lar: account (qattiq) → ip → asn → admin/user → burst
      if (cfg.account) await check('account', accountKeyOf(req), cfg.account.max, cfg.account.windowMs);
      if (cfg.ip && ip) await check('ip', ip, cfg.ip.max, cfg.ip.windowMs);
      if (cfg.asn && ip) {
        const asn = await resolveAsn(ip);
        if (asn) await check('asn', `asn:${asn}`, cfg.asn.max, cfg.asn.windowMs);
      }
      if (cfg.admin && req.session?.admin) {
        await check('admin', req.session.admin.username || 'admin', cfg.admin.max, cfg.admin.windowMs);
      }
      if (cfg.user && req.session?.user) {
        await check('user', req.session.user.safeKey || 'user', cfg.user.max, cfg.user.windowMs);
      }
      if (cfg.burst && ip) await check('burst', `burst:${ip}`, cfg.burst.max, cfg.burst.windowMs);

      // X-RateLimit-* header'lar (§11) — eng cheklovchi tier bo'yicha
      if (best) {
        res.set('X-RateLimit-Limit', String(best.limit));
        res.set('X-RateLimit-Remaining', String(best.remaining));
        res.set('X-RateLimit-Reset', String(Math.ceil(best.resetAt / 1000)));
      }

      if (blocked) {
        const retryAfter = blocked.retryAfterSeconds;
        res.set('Retry-After', String(retryAfter));
        // §13: audit + metric (faqat blok'da — har request'da emas)
        logAuthEvent({
          action: AUDIT_ACTIONS.RATE_LIMIT_HIT,
          outcome: 'blocked',
          method: 'rate_limit',
          ipAddress: ip,
          userAgent: req.headers['user-agent'],
          details: { endpoint: routeKey, tier: blocked.tier, retryAfter },
        }).catch(() => {});
        try {
          recordMetric('auth.rate_limit_hit', 1, {
            type: 'counter', labels: { endpoint: routeKey, tier: blocked.tier },
          });
          // AUTH D-06 §06: auth_rate_limit_hit_total (rate-limit abuse alert)
          recordMetric('auth_rate_limit_hit_total', 1, {
            type: 'counter', labels: { endpoint: routeKey, tier: blocked.tier },
          });
        } catch (_) { /* fail-soft */ }
        // AUTH D-05 §08: rate-limit span (trace'da 429 sababi ko'rinadi).
        try {
          endSpan(startSpan('rate-limit', {
            kind: 'server',
            attributes: {
              'rate_limit.endpoint': routeKey,
              'rate_limit.tier': blocked.tier,
              'rate_limit.retry_after': retryAfter,
              'http.status_code': 429,
              'auth.outcome': 'blocked',
            },
          }), { status: 'error', statusMessage: 'rate_limited' });
        } catch (_) { /* fail-soft: telemetry xatosi limitni buzmasin */ }
        // A-03 lockout kontrakti bilan bir xil: body.code === 'RATE_LIMITED'
        return res.status(429).json({ ok: false, code: 'RATE_LIMITED', retryAfter, tier: blocked.tier });
      }
      next();
    };
  };

  // Test hygiene (lockout.js `_resetStores` konventsiyasi): in-memory
  // bucket'larni tozalaydi — bitta test fayli per-IP limitga urilib
  // qolgan testlarni 429 bilan bloklamasligi uchun.
  authLimiter._reset = () => mem.clear();
  return authLimiter;
}
