/**
 * Deborah — Session routes
 * --------------------------------------------------------------
 * AUTH A-02 (keepalive):
 *   POST /api/session/ping      → 204 (idle timer reset; touchSession)
 *
 * AUTH A-08 (session boshqaruv UI):
 *   GET  /sessions              → o'z faol sessiyalar ro'yxati (IDOR-safe)
 *   POST /sessions/:id/revoke   → bitta sessiyani yakunlash (idempotent)
 *   POST /sessions/revoke-all   → barcha boshqa sessiyalarni yakunlash
 *
 * Xavfsizlik:
 *   - Faqat o'z sessiyalarini ko'rish / yakunlash (userId scope — IDOR himoya).
 *   - Revoke idempotent: allaqachon yakunlangan → 404 (guide §29).
 *   - Barcha POST'lar global CSRF bilan himoyalangan (x-csrf-token/_csrf).
 *   - Audit: session_revoked / session_revoke_all + telemetry metric.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AUTH_COPY, AUTH_LANGS, resolveAuthLang } from '../data/auth-i18n.js';
import { getUserSessions, revokeSession, revokeOtherSessions, touchSession } from '../src/modules/auth/session-manager.js';
import { sessionCookieName } from '../src/modules/auth/session-store.js';
import { recordMetric } from '../src/telemetry/index.js';

const router = Router();

// MUHIM: `router.use(requireAuth)` qilish mumkin EMAS — bu mount path '/'
// bo'lgani uchun BARCHA request'larga (/, /qr, /nonexistent, ...) qo'llanib,
// authsiz barcha sahifalarni 401 qaytarardi. requireAuth har route'ga
// alohida qo'yiladi.

// ── AUTH A-02: session keepalive (idle timeout reset) ──
router.post('/api/session/ping', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (!user?.safeKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    await touchSession(user.safeKey, req.sessionID || req.session.id || '');
    return res.status(204).end();
  } catch (_) {
    return res.status(204).end(); // non-critical — fail-open
  }
});

/** UA parse — qurilma + brauzer (PII minimal, guide §28). */
function parseUa(ua) {
  const s = String(ua || '');
  const lower = s.toLowerCase();
  let device = null;
  let browser = null;

  if (/iphone|ipad|ipod/.test(lower)) device = 'iOS';
  else if (/android/.test(lower)) device = 'Android';
  else if (/windows/.test(lower)) device = 'Windows';
  else if (/mac os x|macintosh/.test(lower)) device = 'macOS';
  else if (/linux/.test(lower)) device = 'Linux';

  if (/edg\//.test(lower)) browser = 'Edge';
  else if (/firefox/.test(lower)) browser = 'Firefox';
  else if (/chrome\/|crios\//.test(lower)) browser = 'Chrome';
  else if (/safari\//.test(lower)) browser = 'Safari';
  else if (/opera|opr\//.test(lower)) browser = 'Opera';

  // BUG-045: brauzersiz so'rovlar (server/test/monitoring) — "Noma'lum" emas, aniq belgi
  const noUa = !s.trim() || /curl|wget|node-fetch|node|python|axios|postman|insomnia|bot|spider|monitor|uptime/i.test(s);
  return { device, browser, noUa };
}

/** Oxirgi faollikni odam o'qiydigan formatga keltirish. */
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'hozir';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} soat`;
  return `${Math.floor(diff / 86400_000)} kun`;
}

/** Sessiya ro'yxatini view'ga tayyorlaydi (PII minimal — ipHash yuboriladi). */
async function buildSessionList(userId) {
  const sessions = await getUserSessions(userId);
  return Object.entries(sessions || {})
    .map(([key, s]) => {
      const { device, browser, noUa } = parseUa(s.userAgent);
      return {
        key,
        sessionId: s.sessionId || key,
        device: device || null,
        browser: browser || null,
        noUa: noUa === true,
        userAgent: s.userAgent || null,
        ipHash: s.ipHash || null,
        authMethod: s.authMethod || 'password',
        remember: !!s.remember,
        createdAt: s.createdAt || 0,
        lastActiveAt: s.lastActiveAt || 0,
        role: s.role || null,
      };
    })
    .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
    // BUG-045: bir xil qurilma (device+browser+ipHash) ketma-ket guruhlanadi
    // (barqaror comparator — avval guruh, guruh ichida lastActive tartibi saqlanadi)
    .sort((a, b) => {
      const ka = `${a.device || '?'}|${a.browser || '?'}|${a.ipHash || ''}`;
      const kb = `${b.device || '?'}|${b.browser || '?'}|${b.ipHash || ''}`;
      return ka === kb ? (b.lastActiveAt || 0) - (a.lastActiveAt || 0) : ka.localeCompare(kb);
    });
}

// ── AUTH A-08: GET /sessions — o'z sessiyalari ──
router.get('/sessions', requireAuth, async (req, res) => {
  const user = req.session.user;
  const lang = resolveAuthLang(req.query.lang || req.cookies?.lang);
  const copy = AUTH_COPY[lang];
  const currentSessionId = req.sessionID || req.session.id || '';

  try {
    const sessions = await buildSessionList(user.safeKey);
    res.render('user/sessions', {
      title: copy.sessions.title,
      description: copy.sessions.sub,
      lang,
      AUTH_LANGS,
      copy,
      csrfToken: req.session.csrfToken,
      sessions,
      currentSessionId,
      timeAgo,
      username: user.username,
      active: 'security',
    });
  } catch (err) {
    console.error('Sessions render error:', err);
    res.render('user/sessions', {
      title: copy.sessions.title,
      description: copy.sessions.sub,
      lang,
      AUTH_LANGS,
      copy,
      csrfToken: req.session.csrfToken,
      sessions: [],
      currentSessionId,
      timeAgo,
      username: user.username,
      active: 'security',
      error: err.message,
    });
  }
});

// ── AUTH A-08: POST /sessions/:id/revoke — bitta sessiyani yakunlash ──
router.post('/sessions/:id/revoke', requireAuth, async (req, res) => {
  const user = req.session.user;
  const targetId = String(req.params.id || '');
  const lang = resolveAuthLang(req.body?.lang || req.query.lang || req.cookies?.lang);

  if (!targetId) {
    return res.status(400).json({ ok: false, error: 'Missing session id' });
  }

  try {
    // IDOR himoya: faqat o'z sessiyalari orasidan qidiramiz
    const sessions = await getUserSessions(user.safeKey);
    const exists = Object.values(sessions).some((s) => s.sessionId === targetId);
    if (!exists) {
      // Idempotent: allaqachon yakunlangan yoki boshqa user'ga tegishli → 404
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    // Joriy sessiyani yakunlash → /user/login (returnUrl bilan)
    const isCurrent = targetId === req.sessionID || targetId === req.session.id;
    const result = await revokeSession(user.safeKey, targetId);

    if (!result.ok) {
      return res.status(404).json({ ok: false, error: result.error });
    }

    // AUTH A-08 §8: haqiqiy session store'dan ham o'chirish (Redis DEL / MemoryStore)
    // — faqat DB tracking'ni o'chirish yetarli emas, aks holda revoke qilingan
    // cookie hamon authed bo'lib qoladi.
    if (!isCurrent && req.sessionStore && typeof req.sessionStore.destroy === 'function') {
      await new Promise((resolve) => {
        try {
          req.sessionStore.destroy(targetId, () => resolve());
        } catch (_) { resolve(); }
      });
    }

    try {
      recordMetric('auth.session_revoked', 1, { type: 'counter' })?.catch?.(() => {});
    } catch (_) {}

    if (isCurrent) {
      // Joriy sessiyani yakunlash — logout'ga o'xshash
      req.session.destroy(() => {
        // AUTH A-08 §8: cookie nomi config'dan — production'da `__Host-`
        // prefiks bilan ham to'g'ri o'chadi (P2).
        res.clearCookie(sessionCookieName());
        return res.json({ ok: true, redirected: true, redirect: `/user/login?lang=${lang}` });
      });
      return;
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Session revoke error:', err);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── AUTH A-08: POST /sessions/revoke-all — barcha boshqa sessiyalarni yakunlash ──
router.post('/sessions/revoke-all', requireAuth, async (req, res) => {
  const user = req.session.user;
  const lang = resolveAuthLang(req.body?.lang || req.query.lang || req.cookies?.lang);

  try {
    const currentSid = req.sessionID || req.session.id || '';
    // Haqiqiy store'dan boshqa sessiyalarni o'chirishdan oldin ularni bilamiz
    const sessions = await getUserSessions(user.safeKey);
    const others = Object.values(sessions || {}).filter((s) => s.sessionId && s.sessionId !== currentSid);

    const result = await revokeOtherSessions(user.safeKey, currentSid);

    // AUTH A-08 §8: store'dan ham o'chirish (Redis DEL / MemoryStore)
    if (req.sessionStore && typeof req.sessionStore.destroy === 'function') {
      await Promise.all(others.map((s) => new Promise((resolve) => {
        try { req.sessionStore.destroy(s.sessionId, () => resolve()); } catch (_) { resolve(); }
      })));
    }

    try {
      recordMetric('auth.session_revoke_all', result.count, { type: 'counter' })?.catch?.(() => {});
    } catch (_) {}

    return res.json({ ok: true, count: result.count });
  } catch (err) {
    console.error('Session revoke-all error:', err);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

export default router;
