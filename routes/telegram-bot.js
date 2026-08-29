/**
 * AUTH B-22 — Telegram bot routes (ulash + xabar + chat)
 * ------------------------------------------------------
 * GET  /user/telegram/link        — ulash UI (start-token ko'rsatadi)
 * POST /api/telegram/link         — yangi start-token yaratish (CSRF + auth)
 * POST /webhooks/telegram-bot     — bot callback (HMAC-signed): start-token
 *                                   consume + telegram_id biriktirish
 * POST /api/telegram/bot-message  — bot chat (read-only): "Natijalarim",
 *                                   "Bugungi jadval" (o'z ma'lumoti)
 *
 * Security: callback HMAC verify (bot_token) bo'lmasa 401; token 1 marta +
 * 5 daqiqa; telegram_id PII — preview'ga chiqmaydi; chat faqat o'z ma'lumoti
 * (userId lookup telegram_id orqali — boshqa user ma'lumoti yo'q).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { safeKey } from '../utils/helpers.js';
import { AUTH_COPY, resolveAuthLang } from '../data/auth-i18n.js';
import {
  createLinkToken,
  consumeLinkToken,
  verifyCallbackSignature,
  isTelegramEnabled,
  getBotUsername,
} from '../src/modules/email/telegram.js';
import { getNotifPrefs, setNotifPrefs } from '../src/modules/student/notifications.js';
import { getAccountEvents } from '../src/modules/auth/account-events.js';

const router = Router();

// ── Ulash (auth) ──
router.use((req, res, next) => {
  const p = req.path;
  if (p === '/user/telegram/link' || p === '/api/telegram/link' || p === '/api/telegram/unlink') {
    return requireAuth(req, res, next);
  }
  next();
});

router.get('/user/telegram/link', async (req, res) => {
  try {
    const lang = resolveAuthLang(req);
    const copy = AUTH_COPY[lang] || AUTH_COPY.uz;
    const user = req.session.user;
    const prefs = await getNotifPrefs(user.safeKey);
    let telegramId = null;
    try {
      const snap = await fb.get(`users/${safeKey(user.safeKey)}/telegram_id`);
      if (snap.exists()) telegramId = snap.val();
    } catch (_) {}
    // Eski token'ni ko'rsatmaymiz — faqat ulanish holati + link button
    return res.render('user/telegram-link', {
      layout: false,
      lang,
      user,
      notifCopy: copy.notif || {},
      telegramCopy: copy.telegram || {},
      enabled: isTelegramEnabled(),
      botUsername: getBotUsername(),
      linked: Boolean(telegramId),
      telegramId: telegramId ? maskTelegramId(telegramId) : null,
      csrf: res.locals.csrfToken || null,
    });
  } catch (err) {
    console.error('[telegram-bot] GET link failed:', err?.message || err);
    return res.status(500).send('internal');
  }
});

router.post('/api/telegram/link', async (req, res) => {
  try {
    if (!isTelegramEnabled()) {
      return res.status(400).json({ ok: false, error: 'telegram_disabled' });
    }
    const result = await createLinkToken(req.session.user.safeKey);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    return res.json({ ok: true, url: result.url, token: result.token, ttlMs: result.ttlMs });
  } catch (err) {
    console.error('[telegram-bot] POST link failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/api/telegram/unlink', async (req, res) => {
  try {
    const userId = req.session.user.safeKey;
    await fb.remove(`users/${safeKey(userId)}/telegram_id`);
    await fb.remove(`users/${safeKey(userId)}/telegram_meta`);
    // prefs.telegram = false (kanal o'chiriladi)
    await setNotifPrefs({ userId, channels: { telegram: false } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[telegram-bot] POST unlink failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── Bot callback (HMAC-signed) ──
router.post('/webhooks/telegram-bot', async (req, res) => {
  const body = req.body || {};
  const signature = String(req.headers['x-telegram-signature'] || req.headers['x-signature'] || '');
  const payload = JSON.stringify(body);

  // HMAC verify — bot_token bilan (test'da mock secret ishlatiladi)
  if (!verifyCallbackSignature({ payload, signature })) {
    return res.status(401).json({ ok: false, error: 'bad_signature' });
  }

  // Bot callback turlari:
  // 1) start-token (ulash): /start <token>
  // 2) chat xabari (read-only): "Natijalarim" / "Bugungi jadval"
  const message = body.message || {};
  const text = String(message.text || '').trim();
  const chatId = message.chat?.id || body.chat_id || null;
  const from = message.from || {};

  if (!chatId) return res.status(400).json({ ok: false, error: 'no_chat' });

  // start-token consume
  if (text.startsWith('/start ')) {
    const token = text.slice(7).trim();
    const result = await consumeLinkToken({
      token,
      telegramId: chatId,
      firstName: from.first_name,
      username: from.username,
    });
    if (result.ok) {
      await sendBotReply(chatId, { key: 'linked', lang: resolveAuthLang({}) }).catch(() => {});
      return res.json({ ok: true, action: 'linked' });
    }
    await sendBotReply(chatId, { key: 'linkFailed', lang: resolveAuthLang({}) }).catch(() => {});
    return res.status(400).json({ ok: false, error: result.error });
  }

  // Chat — read-only, faqat o'z ma'lumoti
  const userId = await resolveUserByTelegramId(chatId);
  if (!userId) {
    await sendBotReply(chatId, { key: 'notLinked', lang: resolveAuthLang({}) }).catch(() => {});
    return res.json({ ok: true, action: 'not_linked' });
  }

  const lang = await resolveUserLang(userId);
  const lower = text.toLowerCase();
  let reply = null;
  if (lower.includes('natija') || lower.includes('result') || lower.includes('результ') || lower.includes('натижа')) {
    reply = await buildResultsReply(userId, lang);
  } else if (lower.includes('jadval') || lower.includes('schedule') || lower.includes('распис') || lower.includes('жадвал')) {
    reply = await buildScheduleReply(userId, lang);
  } else {
    reply = { key: 'help', lang };
  }
  await sendBotReply(chatId, reply).catch(() => {});
  return res.json({ ok: true, action: 'chat' });
});

// ── Bot chat (test uchun to'g'ridan-to'g'ri API) ──
router.post('/api/telegram/bot-message', async (req, res) => {
  const body = req.body || {};
  const signature = String(req.headers['x-telegram-signature'] || '');
  const payload = JSON.stringify(body);
  if (!verifyCallbackSignature({ payload, signature })) {
    return res.status(401).json({ ok: false, error: 'bad_signature' });
  }
  // Xuddi callback logikasi
  const message = body.message || {};
  const text = String(message.text || '').trim();
  const chatId = message.chat?.id || body.chat_id || null;
  const from = message.from || {};
  if (!chatId) return res.status(400).json({ ok: false, error: 'no_chat' });

  if (text.startsWith('/start ')) {
    const result = await consumeLinkToken({ token: text.slice(7).trim(), telegramId: chatId, firstName: from.first_name, username: from.username });
    return res.json({ ok: true, action: 'linked', ...result });
  }

  const userId = await resolveUserByTelegramId(chatId);
  if (!userId) return res.json({ ok: true, action: 'not_linked' });
  const lang = await resolveUserLang(userId);
  const lower = text.toLowerCase();
  if (lower.includes('natija') || lower.includes('result')) {
    const reply = await buildResultsReply(userId, lang);
    return res.json({ ok: true, action: 'results', reply });
  }
  if (lower.includes('jadval') || lower.includes('schedule')) {
    const reply = await buildScheduleReply(userId, lang);
    return res.json({ ok: true, action: 'schedule', reply });
  }
  return res.json({ ok: true, action: 'help' });
});

// ── Helpers ──

async function resolveUserByTelegramId(chatId) {
  try {
    const usersSnap = await fb.get('users');
    if (!usersSnap.exists()) return null;
    const users = usersSnap.val() || {};
    for (const [key, u] of Object.entries(users)) {
      if (String(u.telegram_id) === String(chatId)) return key;
    }
  } catch (_) {}
  return null;
}

async function resolveUserLang(userId) {
  try {
    const snap = await fb.get(`users/${safeKey(userId)}/settings/lang`);
    if (snap.exists() && snap.val()) return snap.val();
  } catch (_) {}
  return 'uz';
}

/** Bot javobini yuboradi (telegram.js send orqali, fail-soft). */
async function sendBotReply(chatId, reply) {
  const { sendTelegramMessage } = await import('../src/modules/email/telegram.js');
  const text = buildBotText(reply);
  await sendTelegramMessage({ chatId, text });
}

/** Bot stringlar — 4 til (B-22 §14). */
const BOT_TEXT = {
  uz: {
    linked: "✅ Telegram ulandi! Endi natijalar va eslatmalar shu yerda keladi.",
    linkFailed: "❌ Ulash kodi amal qilmadi yoki muddati o'tgan. Saytda qayta urinib ko'ring.",
    notLinked: "Hisobingiz Telegram'ga ulanmagan. Saytda: Sozlamalar → Telegram'ni ulash.",
    help: "Salom! Mavjud buyruqlar:\n• Natijalarim\n• Bugungi jadval",
    resultsEmpty: "Hozircha natijalar yo'q.",
    scheduleEmpty: "Bugungi jadval bo'sh.",
  },
  'uz-cyrl': {
    linked: "✅ Telegram уланди! Энди натижалар ва эслатмалар шу ерда келади.",
    linkFailed: "❌ Улаш коди амал қилмади ёки муддати ўтган. Сайтда қайта уриниб кўринг.",
    notLinked: "Ҳисобингиз Telegram'га уланмаган. Сайтда: Созламалар → Telegram'ни улаш.",
    help: "Салом! Мавжуд буйруқлар:\n• Натижаларим\n• Бугунги жадвал",
    resultsEmpty: "Ҳозирча натижалар йўқ.",
    scheduleEmpty: "Бугунги жадвал бўш.",
  },
  ru: {
    linked: "✅ Telegram подключён! Результаты и напоминания будут приходить сюда.",
    linkFailed: "❌ Код недействителен или истёк. Попробуйте ещё раз на сайте.",
    notLinked: "Ваш аккаунт не подключён к Telegram. На сайте: Настройки → Подключить Telegram.",
    help: "Привет! Доступные команды:\n• Мои результаты\n• Расписание на сегодня",
    resultsEmpty: "Пока нет результатов.",
    scheduleEmpty: "Расписание на сегодня пусто.",
  },
  en: {
    linked: "✅ Telegram linked! Results and reminders will arrive here.",
    linkFailed: "❌ Link code is invalid or expired. Try again on the website.",
    notLinked: "Your account is not linked to Telegram. On the website: Settings → Link Telegram.",
    help: "Hello! Available commands:\n• My results\n• Today's schedule",
    resultsEmpty: "No results yet.",
    scheduleEmpty: "No schedule for today.",
  },
};

function buildBotText({ key, lang, data }) {
  const t = BOT_TEXT[lang] || BOT_TEXT.uz;
  if (key === 'results') {
    const rows = (data || []).map((r, i) => `${i + 1}. ${r.name} — ${r.score}%`).join('\n');
    return rows ? `📊 ${t.resultsTitle || 'Natijalarim'}:\n${rows}` : t.resultsEmpty;
  }
  if (key === 'schedule') {
    const rows = (data || []).map((r) => `• ${r.time} — ${r.name}`).join('\n');
    return rows ? `📅 ${t.scheduleTitle || 'Bugungi jadval'}:\n${rows}` : t.scheduleEmpty;
  }
  return t[key] || t.help;
}

/** "Natijalarim" — faqat o'z natijalari (read-only, PII minimal). */
async function buildResultsReply(userId, lang) {
  try {
    const snap = await fb.get(`users/${safeKey(userId)}/results`);
    if (!snap.exists()) return { key: 'results', lang, data: [] };
    const results = snap.val() || {};
    const list = Object.values(results)
      .slice(-5)
      .map((r) => ({
        name: String(r.name || r.test_name || 'Test').slice(0, 60),
        score: typeof r.score === 'number' ? r.score : (typeof r.percent === 'number' ? r.percent : 0),
      }));
    return { key: 'results', lang, data: list };
  } catch (_) {
    return { key: 'results', lang, data: [] };
  }
}

/** "Bugungi jadval" — faqat o'z jadvali. */
async function buildScheduleReply(userId, lang) {
  try {
    const snap = await fb.get(`users/${safeKey(userId)}/schedule`);
    if (!snap.exists()) return { key: 'schedule', lang, data: [] };
    const schedule = snap.val() || {};
    const list = Object.values(schedule).map((r) => ({
      time: String(r.time || r.start || '').slice(0, 8),
      name: String(r.name || r.subject || r.title || '').slice(0, 60),
    }));
    return { key: 'schedule', lang, data: list };
  } catch (_) {
    return { key: 'schedule', lang, data: [] };
  }
}

/** Telegram ID'ni maskalaydi (PII — UI'da to'liq ko'rinmaydi). */
function maskTelegramId(id) {
  const s = String(id || '');
  return s.length > 4 ? `${s.slice(0, 2)}***${s.slice(-2)}` : '***';
}

export default router;
