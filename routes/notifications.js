/**
 * AUTH B-21 — Notification preferences routes
 * -------------------------------------------
 * GET  /user/notifications       — settings UI (toggle'lar)
 * POST /api/notifications/prefs  — prefs saqlash (CSRF + auth + audit)
 *
 * Security: faqat o'z user'i (req.user.safeKey — IDOR yopiq); CSRF global
 * middleware orqali; audit NOTIF_PREFS_UPDATED.
 */
import { Router } from 'express';
import CONFIG from '../src/config/env.js';
import { pushEnabled } from '../src/modules/student/push.js';

// BUG-046: kanal mavjudligi — sozlanmagan kanal UI'da yoqilib ko'rinmaydi
const channelAvail = () => ({
  telegram: CONFIG.TELEGRAM_ENABLED !== false && Boolean(CONFIG.TELEGRAM_BOT_TOKEN),
  email: true,
  push: pushEnabled(),
});
import { requireAuth } from '../middleware/auth.js';
import { getNotifPrefs, setNotifPrefs } from '../src/modules/student/notifications.js';
import { AUTH_COPY, resolveAuthLang } from '../data/auth-i18n.js';

const router = Router();

// → Faqat notification yo'llari login talab qiladi. Router '/' da mount
// qilingani uchun shartsiz router.use(requireAuth) BARCHA so'rovlarni ushlab
// qolardi — path scope kerak (onboarding.js pattern'i).
router.use((req, res, next) => {
  const p = req.path;
  if (p === '/user/notifications' || p === '/api/notifications/prefs') {
    return requireAuth(req, res, next);
  }
  next();
});

// Lang user settings'dan (4 til — B-19 §16 pattern'i)
async function userLang(req) {
  try {
    const { fb } = await import('../firebase/admin.js');
    const { safeKey } = await import('../utils/helpers.js');
    const snap = await fb.get(`users/${safeKey(req.session.user.safeKey)}/settings/lang`);
    if (snap.exists() && snap.val()) return snap.val();
  } catch (_) {}
  // BUG-085 (S14): avval req OBYEKTINI berilardi — String(req)='[object Object]'
  // → doim 'uz' qaytardi. Query/cookie (BUG-084'dan keyin cookie o'qiladi) to'g'ri.
  return resolveAuthLang(req.query?.lang || req.cookies?.lang);
}

router.get('/user/notifications', async (req, res) => {
  try {
    const lang = await userLang(req);
    const copy = AUTH_COPY[lang] || AUTH_COPY.uz;
    const prefs = await getNotifPrefs(req.session.user.safeKey);
    const avail = channelAvail();
    // BUG-046: sozlanmagan kanal UI'da yoqilganholda ko'rinmasin (faqat ko'rinish — DB o'zgarmaydi)
    if (!avail.telegram) prefs.channels.telegram = false;
    if (!avail.push) prefs.channels.push = false;
    return res.render('user/notifications', {
      layout: false,
      lang,
      user: req.session.user,
      prefs,
      copy, // S14 (BUG-087): sidebar/theme-control 4 til
      notifCopy: copy.notif,
      channelAvail: avail,
      accountCopy: copy.account || {},
      __csrf: res.locals.csrfToken || null,
    });
  } catch (err) {
    console.error('[notifications] GET failed:', err?.message || err);
    return res.status(500).send('internal');
  }
});

router.post('/api/notifications/prefs', async (req, res) => {
  try {
    const body = req.body || {};
    const channels = {};
    const types = {};
    // Faqat ma'lum kanallar/tiplar qabul qilinadi (whitelist)
    for (const c of ['telegram', 'email', 'push']) {
      if (typeof body[`ch_${c}`] === 'boolean') channels[c] = body[`ch_${c}`];
      else if (body[`ch_${c}`] === 'true' || body[`ch_${c}`] === 'false') channels[c] = body[`ch_${c}`] === 'true';
    }
    for (const t of ['assignment', 'result', 'practice', 'deadline', 'feedback', 'security']) {
      if (typeof body[`tp_${t}`] === 'boolean') types[t] = body[`tp_${t}`];
      else if (body[`tp_${t}`] === 'true' || body[`tp_${t}`] === 'false') types[t] = body[`tp_${t}`] === 'true';
    }
    const avail2 = channelAvail();
    // BUG-046: sozlanmagan kanalni server tomonda ham qabul qilmaymiz
    if (!avail2.telegram) channels.telegram = false;
    if (!avail2.push) channels.push = false;
    const result = await setNotifPrefs({
      userId: req.session.user.safeKey,
      channels: Object.keys(channels).length ? channels : undefined,
      types: Object.keys(types).length ? types : undefined,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    return res.json({ ok: true, prefs: result.prefs });
  } catch (err) {
    console.error('[notifications] POST failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

export default router;
