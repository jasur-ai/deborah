/**
 * AUTH B-21 — Notification preferences (schema + dispatch)
 * --------------------------------------------------------
 * Prefs `users.{id}.notif_prefs` da saqlanadi (Firebase/local-db):
 *
 *   {
 *     channels: { telegram: bool, email: bool, push: bool },  // default: tg on, email/push off
 *     types:    { assignment, result, practice, deadline, feedback, security }, // per-type toggle
 *     updated_at: number
 *   }
 *
 * Qoidalar:
 *   - Default: Telegram ON (O‘zbekiston standardi), email/push OFF (§08).
 *   - Security hodisalari (new device, password change, suspicious, breach)
 *     — O‘CHIRIB BO‘LMAYDI (majburiy xabar, §09). `setNotifPrefs` buni
 *     kuch bilan qayta yoqadi (forced).
 *   - `dispatch` — hodisa → kanal routing (prefs bo‘yicha). Telegram infra P2;
 *     email B-20 template'lar orqali; hozircha kanal qaytaradi (P2 yetkazadi).
 *   - telegram_id PII (UZ) — alohida path `users.{id}.telegram_id`; prefs'da
 *     faqat flag'lar, hech qachon raw telegram_id UI'ga chiqmaydi.
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../../src/telemetry/index.js';

// ── Hodisa turlari (B-21 §06) ──
export const NOTIF_TYPES = ['assignment', 'result', 'practice', 'deadline', 'feedback', 'security'];

// ── Kanal turlari ──
export const NOTIF_CHANNELS = ['telegram', 'email', 'push'];

// Security hodisalari — o'chirib bo'lmaydi (B-21 §09)
export const FORCED_SECURITY_TYPES = [
  'new_device',
  'password_changed',
  'email_changed',
  'suspicious',
  'breach',
];

// Kanallar bo'yicha sutkalik cap (B-21 §11) — config'dan override qilish mumkin
export const CHANNEL_DAILY_CAP = {
  telegram: Number(process.env.NOTIF_TELEGRAM_DAILY_CAP || 3),
  email: Number(process.env.NOTIF_EMAIL_DAILY_CAP || 3),
  push: Number(process.env.NOTIF_PUSH_DAILY_CAP || 2),
};

export const NOTIF_DEDUPE_MS = 24 * 60 * 60 * 1000; // 24 soat dedupe

/** Default prefs (B-21 §08). */
export function defaultNotifPrefs() {
  return {
    channels: { telegram: true, email: false, push: false },
    types: {
      assignment: true,
      result: true,
      practice: true,
      deadline: true,
      feedback: true,
      security: true, // majburiy — UI'da o'chirib bo'lmaydi
    },
    updated_at: 0,
  };
}

/**
 * Prefs o'qiydi (yo'q bo'lsa default). Normalize: eski/noto'g'ri maydonlar
 * tozalanadi, security doim true (forced).
 * @returns {Promise<object>} normalize qilingan prefs
 */
export async function getNotifPrefs(userId) {
  const d = defaultNotifPrefs();
  if (!userId) return d;
  try {
    const snap = await fb.get(`users/${safeKey(userId)}/notif_prefs`);
    if (!snap.exists()) return d;
    const raw = snap.val() || {};
    const out = {
      channels: { ...d.channels },
      types: { ...d.types },
      updated_at: typeof raw.updated_at === 'number' ? raw.updated_at : 0,
    };
    // Kanal flag'lar — faqat boolean qabul qilamiz
    for (const c of NOTIF_CHANNELS) {
      if (typeof raw.channels?.[c] === 'boolean') out.channels[c] = raw.channels[c];
    }
    // Type toggle'lar — security forced true (o'chirib bo'lmaydi)
    for (const t of NOTIF_TYPES) {
      if (typeof raw.types?.[t] === 'boolean') out.types[t] = raw.types[t];
    }
    out.types.security = true;
    return out;
  } catch (_) {
    return d;
  }
}

/**
 * Prefs yangilaydi — input validation + security forced + audit.
 * @param {{ userId: string, channels?: object, types?: object, ipAddress?: string, userAgent?: string }} params
 * @returns {Promise<{ok: boolean, prefs?: object, error?: string}>}
 */
export async function setNotifPrefs({ userId, channels, types, ipAddress, userAgent }) {
  if (!userId) return { ok: false, error: 'no_user' };
  if (channels && typeof channels !== 'object') return { ok: false, error: 'invalid_channels' };
  if (types && typeof types !== 'object') return { ok: false, error: 'invalid_types' };

  const current = await getNotifPrefs(userId);

  // Kanal yangilash — faqat ma'lum kanallar, faqat boolean
  if (channels) {
    for (const c of NOTIF_CHANNELS) {
      if (typeof channels[c] === 'boolean') current.channels[c] = channels[c];
    }
  }
  // Type yangilash — security forced TRUE (hech qanday yo'l bilan o'chmaydi)
  if (types) {
    for (const t of NOTIF_TYPES) {
      if (typeof types[t] === 'boolean') current.types[t] = types[t];
    }
  }
  current.types.security = true;

  current.updated_at = Date.now();
  await fb.set(`users/${safeKey(userId)}/notif_prefs`, current);

  // Audit (B-21 §17)
  try {
    await logAuthEvent({
      action: AUDIT_ACTIONS.NOTIF_PREFS_UPDATED,
      outcome: 'success',
      method: 'user',
      actorId: userId,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      details: {
        channels: current.channels,
        types: current.types,
      },
    });
  } catch (_) { /* audit fail-soft */ }

  return { ok: true, prefs: current };
}

// ── Dispatch (B-21 §10) — hodisa → kanal routing ──

/**
 * Hodisani prefs bo'yicha kanal(lar)ga route qiladi.
 * Security hodisalari har doim kamida bitta kanalga yuboriladi
 * (agar email off bo'lsa ham — email kanali security uchun fallback).
 *
 * @param {{ userId: string, type: string, eventType?: string }} params
 *   type — NOTIF_TYPES'dan biri (assignment/result/...); eventType — aniq hodisa
 *   (new_device/password_changed/...) — FORCED_SECURITY_TYPES'da bo'lsa forced.
 * @returns {Promise<{ok: boolean, channels: string[], forced?: boolean, error?: string}>}
 */
export async function dispatchNotification({ userId, type, eventType }) {
  if (!userId) return { ok: false, channels: [], error: 'no_user' };
  const prefs = await getNotifPrefs(userId);

  // Security hodisasi → forced (kanal toggle'laridan qat'iy nazar)
  const isSecurityEvent = (eventType && FORCED_SECURITY_TYPES.includes(eventType)) || type === 'security';
  const typeEnabled = isSecurityEvent ? true : (prefs.types[type] ?? true);

  if (!typeEnabled) {
    return { ok: false, channels: [], error: 'type_disabled' };
  }

  const channels = NOTIF_CHANNELS.filter((c) => prefs.channels[c]);
  // Security fallback: agar barcha kanallar o'chirilgan bo'lsa ham email'ga
  // yuboriladi (B-21 §09 — security xabarlari doim yetib borishi shart).
  // Lekin mavjud kanal bor bo'lsa unga yuboriladi (default: telegram).
  if (isSecurityEvent && channels.length === 0) channels.push('email');

  return { ok: channels.length > 0, channels, forced: isSecurityEvent };
}

// ── Chastota cap + dedupe (B-21 §11) ──
// State: users.{id}.notif_caps.{dateKey}.{channel} = { count, lastType }

function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Kanal uchun chastota tekshiradi: sutkalik cap + 24h dedupe.
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkNotifRate({ userId, channel, type, cap = null }) {
  if (!userId) return { allowed: true }; // no-user → allow (fail-open emas; callers guard)
  const today = dateKey();
  try {
    const snap = await fb.get(`users/${safeKey(userId)}/notif_caps/${today}/${channel}`);
    const state = snap.exists() ? snap.val() : { count: 0, lastType: null, lastAt: 0 };
    const limit = cap ?? (CHANNEL_DAILY_CAP[channel] ?? 3);
    if (state.count >= limit) {
      return { allowed: false, reason: 'daily_cap' };
    }
    if (type && state.lastType === type && state.lastAt && Date.now() - state.lastAt < NOTIF_DEDUPE_MS) {
      return { allowed: false, reason: 'dedupe_24h' };
    }
    return { allowed: true };
  } catch (_) {
    return { allowed: true };
  }
}

/** Cap/dedupe state'ni increment qiladi (dispatch muvaffaqiyatidan keyin). */
export async function recordNotifSent({ userId, channel, type }) {
  if (!userId) return;
  const today = dateKey();
  try {
    const snap = await fb.get(`users/${safeKey(userId)}/notif_caps/${today}/${channel}`);
    const state = snap.exists() ? snap.val() : { count: 0, lastType: null, lastAt: 0 };
    await fb.set(`users/${safeKey(userId)}/notif_caps/${today}/${channel}`, {
      count: (state.count || 0) + 1,
      lastType: type || null,
      lastAt: Date.now(),
    });
  } catch (_) { /* non-critical */ }
}

/** Testlar uchun. */
export function _notifConfig() {
  return { NOTIF_TYPES, NOTIF_CHANNELS, CHANNEL_DAILY_CAP, NOTIF_DEDUPE_MS };
}

// ═══════════════════════════════════════════════════════════════════════
// AUTH B-32 — Notification detail: dedupe, quiet hours, per-event template,
// segment, chastota cap, kanal fallback
// ═══════════════════════════════════════════════════════════════════════

// §06 Dedupe: event:day kaliti — bir hodisa 24 soat ichida bir marta
const NOTIF_DEDUPE_PATH = 'notif_dedupe';
// §07 Kechiktirilgan xabarlar (quiet hours)
const NOTIF_DELAYED_PATH = 'notif_delayed';

// §07 Quiet hours default 22:00-08:00 (user sozlashi mumkin: notif_prefs.quiet)
const QUIET_DEFAULT = { start: 22, end: 8 };
// Marketing hodisalari — quiet hours'ga bo'ysunadi (security DARHOL, §07)
const MARKETING_TYPES = ['assignment', 'result', 'practice', 'deadline', 'feedback'];

/**
 * §07 Quiet hours ichidamizmi? (user sozlashiga ko'ra; default 22-08).
 * @param {number} ts
 * @param {{start?: number, end?: number}|null} [quiet] — null → quiet yo'q
 */
export function inQuietHours(ts = Date.now(), quiet = null) {
  if (quiet === null) return false;
  const q = quiet && typeof quiet === 'object' && Number.isFinite(quiet.start) && Number.isFinite(quiet.end)
    ? { start: quiet.start, end: quiet.end }
    : QUIET_DEFAULT;
  if (q.start === q.end) return false; // user quiet'ni o'chirgan
  const h = new Date(ts).getHours();
  if (q.start < q.end) return h >= q.start && h < q.end;
  return h >= q.start || h < q.end; // 22-08 kabi tun oralig'i
}

/** Quiet hours tugash vaqti (keyingi ertalab) — kechiktirilgan xabarning dueAt'i. */
export function nextQuietEnd(ts = Date.now(), quiet = null) {
  const q = quiet && typeof quiet === 'object' && Number.isFinite(quiet.start) && Number.isFinite(quiet.end)
    ? { start: quiet.start, end: quiet.end }
    : QUIET_DEFAULT;
  const d = new Date(ts);
  // Bugun end soatida tashqaridamiz? Aks holda ertaga.
  if (q.start < q.end) {
    d.setHours(q.end, 0, 0, 0);
    if (d.getTime() <= ts) d.setDate(d.getDate() + 1);
  } else {
    d.setHours(q.end, 0, 0, 0);
    if (d.getTime() <= ts) d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

/**
 * §09 Segment: user faolligiga ko'ra (consistent/sporadic/lapsed).
 * Chastota cap'ni segmentga moslash uchun (B-21 §11 + B-32 §09).
 * @returns {'consistent'|'sporadic'|'lapsed'}
 */
export function userSegment(u) {
  if (!u) return 'sporadic';
  const lastActive = u.last_active || u.last_login || u.lastSeen || 0;
  if (!lastActive) return 'sporadic';
  const days = (Date.now() - lastActive) / 86400000;
  if (days <= 7) return 'consistent';
  if (days <= 30) return 'sporadic';
  return 'lapsed'; // 30+ kun — qiymat (win-back) xabarlari
}

/** §10: marketing sutkalik cap'ni segmentga moslash (security cap'ga kirmaydi). */
export function segmentDailyCap(segment = 'sporadic', type = null, configuredCap = null) {
  if (type && FORCED_SECURITY_TYPES.includes(type)) return Infinity; // security — cap yo'q
  const base = configuredCap ?? CHANNEL_DAILY_CAP.email ?? 3;
  if (segment === 'consistent') return base; // aktiv foydalanuvchi — odatiy
  if (segment === 'lapsed') return Math.max(2, base); // win-back qiymat xabarlari
  return Math.max(1, Math.min(2, base)); // sporadic — kamroq xabar
}

// ── §08 Per-event template (3 kanal: email/Telegram/push) ──
// Har event o'z matniga ega; security → B-20 renderSecurity (email).

function t(type, lang, uz, ru, en, cyrl) {
  const map = { uz, ru, en, 'uz-cyrl': cyrl || uz };
  return map[lang] || map.uz;
}

const EVENT_TEXTS = {
  assignment: {
    emailSubject: (d, l) => t('assignment', l, 'Yangi topshiriq', 'Новое задание', 'New assignment', 'Янги топшириқ'),
    emailBody: (d, l) => t('assignment', l,
      'Sizga yangi topshiriq berildi. Panelda ko\'rib chiqing.',
      'Вам назначено новое задание. Посмотрите на панели.',
      'You have a new assignment. Check it on your panel.',
      'Сизга янги топшириқ берилди. Панелда кўриб чиқинг.'),
    tgText: (d, l) => t('assignment', l, '📚 Yangi topshiriq — panelda ko\'rib chiqing.', '📚 Новое задание — посмотрите на панели.', '📚 New assignment — check it on your panel.', '📚 Янги топшириқ — панелда кўриб чиқинг.'),
    pushTitle: (d, l) => t('assignment', l, 'Yangi topshiriq', 'Новое задание', 'New assignment', 'Янги топшириқ'),
    pushBody: (d, l) => t('assignment', l, 'Panelda yangi topshiriq bor.', 'На панели новое задание.', 'There is a new assignment on your panel.', 'Панелда янги топшириқ бор.'),
  },
  deadline: {
    emailSubject: (d, l) => t('deadline', l, 'Muddat yaqin', 'Срок близко', 'Deadline approaching', 'Муддат яқин'),
    emailBody: (d, l) => t('deadline', l,
      'Topshiriq muddati yaqinlashmoqda — topshirmoqchi bo\'lsangiz shoshiling.',
      'Срок сдачи приближается — поторопитесь, если планируете сдать.',
      'Your deadline is approaching — hurry if you plan to submit.',
      'Топшириқ муддати яқинлашмоқда — топширмоқчи бўлсангиз шошилинг.'),
    tgText: (d, l) => t('deadline', l, '⏰ Muddat yaqin!', '⏰ Срок близко!', '⏰ Deadline soon!', '⏰ Муддат яқин!'),
    pushTitle: (d, l) => t('deadline', l, 'Muddat yaqin', 'Срок близко', 'Deadline soon', 'Муддат яқин'),
    pushBody: (d, l) => t('deadline', l, 'Topshiriq muddati yaqin.', 'Срок сдачи близко.', 'Assignment due soon.', 'Топшириқ муддати яқин.'),
  },
  result: {
    emailSubject: (d, l) => t('result', l, 'Natija tayyor', 'Результат готов', 'Result ready', 'Натижа тайёр'),
    emailBody: (d, l) => t('result', l, 'Natijangiz tayyor — panelda ko\'ring.', 'Ваш результат готов — посмотрите на панели.', 'Your result is ready — check your panel.', 'Натижангиз тайёр — панелда кўринг.'),
    tgText: (d, l) => t('result', l, '🏆 Natijangiz tayyor!', '🏆 Ваш результат готов!', '🏆 Your result is ready!', '🏆 Натижангиз тайёр!'),
    pushTitle: (d, l) => t('result', l, 'Natija tayyor', 'Результат готов', 'Result ready', 'Натижа тайёр'),
    pushBody: (d, l) => t('result', l, 'Natijangizni panelda ko\'ring.', 'Посмотрите результат на панели.', 'See your result on the panel.', 'Натижангизни панелда кўринг.'),
  },
  feedback: {
    emailSubject: (d, l) => t('feedback', l, 'Fikr-mulohaza', 'Обратная связь', 'Feedback', 'Фикр-мулоҳаза'),
    emailBody: (d, l) => t('feedback', l, 'O\'qituvchingiz fikr qoldirdi — panelda o\'qing.', 'Ваш преподаватель оставил отзыв — прочитайте на панели.', 'Your teacher left feedback — read it on your panel.', 'Ўқитувчингиз фикр қолдирди — панелда ўқинг.'),
    tgText: (d, l) => t('feedback', l, '💬 O\'qituvchi fikri bor', '💬 Есть отзыв преподавателя', '💬 Teacher feedback', '💬 Ўқитувчи фикри бор'),
    pushTitle: (d, l) => t('feedback', l, 'Yangi fikr', 'Новый отзыв', 'New feedback', 'Янги фикр'),
    pushBody: (d, l) => t('feedback', l, 'Fikrni panelda o\'qing.', 'Прочитайте отзыв на панели.', 'Read the feedback on your panel.', 'Фикрни панелда ўқинг.'),
  },
  practice: {
    emailSubject: (d, l) => t('practice', l, 'Amaliyot eslatmasi', 'Напоминание о практике', 'Practice reminder', 'Амалиёт эслатмаси'),
    emailBody: (d, l) => t('practice', l, 'Kunlik amaliyotni unutmang — 10 daqiqa kifoya.', 'Не забудьте про ежедневную практику — 10 минут достаточно.', 'Don\'t forget your daily practice — 10 minutes is enough.', 'Кунлик амалиётни унутманг — 10 дақиқа кифоя.'),
    tgText: (d, l) => t('practice', l, '🎯 Kunlik amaliyot — 10 daqiqa', '🎯 Ежедневная практика — 10 минут', '🎯 Daily practice — 10 minutes', '🎯 Кунлик амалиёт — 10 дақиқа'),
    pushTitle: (d, l) => t('practice', l, 'Amaliyot vaqti', 'Время практики', 'Practice time', 'Амалиёт вақти'),
    pushBody: (d, l) => t('practice', l, '10 daqiqa amaliyot qiling.', 'Сделайте 10 минут практики.', 'Do 10 minutes of practice.', '10 дақиқа амалиёт қилинг.'),
  },
  security: {
    emailSubject: (d, l) => t('security', l, 'Xavfsizlik xabari', 'Сообщение безопасности', 'Security alert', 'Хавфсизлик хабари'),
    emailBody: (d, l) => t('security', l,
      'Xavfsizlikka oid hodisa ro\'yxatga olindi. Tafsilotlarni panelda ko\'ring.',
      'Зафиксировано событие безопасности. Подробности на панели.',
      'A security event was recorded. See details on your panel.',
      'Хавфсизликка оид ҳодиса рўйхатга олинди. Тафсилотларни панелда кўринг.'),
    tgText: (d, l) => t('security', l, '🔐 Xavfsizlik xabari — panelni tekshiring', '🔐 Сообщение безопасности — проверьте панель', '🔐 Security alert — check your panel', '🔐 Хавфсизлик хабари — панелни текширинг'),
    pushTitle: (d, l) => t('security', l, 'Xavfsizlik xabari', 'Сообщение безопасности', 'Security alert', 'Хавфсизлик хабари'),
    pushBody: (d, l) => t('security', l, 'Xavfsizlik hodisasi ro\'yxatga olindi.', 'Зафиксировано событие безопасности.', 'A security event was recorded.', 'Хавфсизлик ҳодисаси рўйхатга олинди.'),
  },
};

/**
 * §08/§13: event → 3 kanal uchun kontent (OTP/parol/answer YO'Q — preview xavfsiz).
 * @returns {{ subject: string, emailBody: string, tgText: string, pushTitle: string, pushBody: string }}
 */
export function notifContent(type, { eventType = null, lang = 'uz', username = '' } = {}) {
  const e = EVENT_TEXTS[type] || EVENT_TEXTS.security;
  const subject = e.emailSubject(null, lang);
  const emailBody = e.emailBody(null, lang);
  // §13: preview'da maxfiy emas — faqat umumiy matn; username xush kelish (non-sensitive)
  const greet = username ? `, ${username}` : '';
  const tgText = `${e.tgText(null, lang)}${greet}`;
  return {
    subject,
    emailBody,
    tgText,
    pushTitle: e.pushTitle(null, lang),
    pushBody: e.pushBody(null, lang),
  };
}

/**
 * §14 Dedupe marker — bir hodisa (event:day) 24 soat ichida bir marta.
 * @returns {Promise<{duplicate: boolean}>}
 */
async function dedupeCheck({ userId, type, ts = Date.now() }) {
  try {
    const key = `${safeKey(userId)}/${type}/${dateKey(ts)}`;
    const snap = await fb.get(`${NOTIF_DEDUPE_PATH}/${key}`);
    if (snap.exists()) return { duplicate: true };
    await fb.set(`${NOTIF_DEDUPE_PATH}/${key}`, { at: ts });
    return { duplicate: false };
  } catch (_) {
    return { duplicate: false }; // fail-open
  }
}

/**
 * B-32 asosiy yuborish funksiyasi: dedupe + quiet hours + cap + template +
 * 3 kanalga yetkazish (fallback bilan).
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.type — NOTIF_TYPES'dan
 * @param {string|null} [opts.eventType] — security event (new_device, password_changed...)
 * @param {object} [opts.data] — template ma'lumotlari (sensitive YO'Q)
 * @param {string} [opts.lang]
 * @param {number} [opts.now]
 * @param {object} [opts.deps] — { sendTelegram, sendEmail, sendPush, recordCap } (test injeksiyasi)
 */
export async function sendNotification({
  userId,
  type,
  eventType = null,
  data = {},
  lang = 'uz',
  now = Date.now(),
  deps = {},
}) {
  if (!userId) return { ok: false, error: 'no_user', channels: [] };
  const isSecurity = (eventType && FORCED_SECURITY_TYPES.includes(eventType)) || type === 'security';

  // User + segment
  let user = null;
  try {
    const us = await fb.get(`users/${safeKey(userId)}`);
    if (us.exists()) user = us.val();
  } catch (_) {}
  const segment = userSegment(user);
  const quiet = user?.notif_prefs?.quiet ?? QUIET_DEFAULT;

  // §06 Dedupe — marketing hodisalari uchun (security alohida hodisa — har biri xabar)
  if (!isSecurity && MARKETING_TYPES.includes(type)) {
    const dd = await dedupeCheck({ userId, type, ts: now });
    if (dd.duplicate) {
      logAuthEvent({
        action: AUDIT_ACTIONS.NOTIF_DEDUPE,
        outcome: 'success',
        method: 'dedupe',
        actorId: safeKey(userId),
        channel: 'notif',
        details: { type, eventType },
      }).catch(() => {});
      recordMetric('notif.dedupe', 1, { type: 'counter' })?.catch?.(() => {});
      return { ok: false, reason: 'dedupe_24h', channels: [] };
    }
  }

  // §07 Quiet hours — marketing kechiktiriladi; security DARHOL
  if (!isSecurity && inQuietHours(now, quiet)) {
    const dueAt = nextQuietEnd(now, quiet);
    const id = `${now}-${crypto.randomBytes(4).toString('hex')}`;
    await fb.set(`${NOTIF_DELAYED_PATH}/${safeKey(userId)}/${id}`, {
      type, eventType, data, lang, dueAt, createdAt: now,
    }).catch(() => {});
    logAuthEvent({
      action: AUDIT_ACTIONS.NOTIF_QUIET_DELAYED,
      outcome: 'success',
      method: 'delay',
      actorId: safeKey(userId),
      channel: 'notif',
      details: { type, dueAt },
    }).catch(() => {});
    recordMetric('notif.quiet_delayed', 1, { type: 'counter' })?.catch?.(() => {});
    return { ok: true, delayed: true, dueAt, channels: [] };
  }

  // Kanal routing (B-21 prefs; security forced)
  const routed = await dispatchNotification({ userId, type, eventType });
  if (!routed.ok) return { ok: false, error: routed.error || 'no_channels', channels: [] };
  let channels = routed.channels;
  if (isSecurity && !channels.includes('email')) channels = [...channels, 'email']; // §24: security hech bo'lmasa email

  // §10 Chastota cap — security cap'ga kirmaydi; segmentga mos cap (§09)
  const cap = segmentDailyCap(segment, eventType, CHANNEL_DAILY_CAP.email);
  const allowedChannels = [];
  for (const ch of channels) {
    if (!isSecurity) {
      const segCap = segmentDailyCap(segment, type, CHANNEL_DAILY_CAP[ch]);
      const rate = await checkNotifRate({ userId, channel: ch, type, cap: segCap });
      if (!rate.allowed) {
        recordMetric('notif.cap_enforced', 1, { type: 'counter' })?.catch?.(() => {});
        continue;
      }
    }
    allowedChannels.push(ch);
  }
  if (allowedChannels.length === 0) {
    return { ok: false, reason: 'cap_or_disabled', channels: [] };
  }

  // §08 Kontent (preview xavfsiz — sensitive yo'q)
  const content = notifContent(type, { eventType, lang, username: user?.username || '' });

  // §24 Yetkazish — fallback: bir kanal failsa keyingisiga; security hech bo'lmasa bittasi
  const delivered = [];
  const failed = [];
  const l = lang;
  for (const ch of allowedChannels) {
    let ok = false;
    if (ch === 'telegram') {
      const { notifyUserTelegram } = await import('../email/telegram.js');
      const r = await notifyUserTelegram({ userId, type: isSecurity ? 'security' : type, text: content.tgText, deps: { sendImpl: deps.sendTelegram } });
      ok = r?.ok === true;
    } else if (ch === 'email') {
      ok = await sendNotifEmail({ userId, type, eventType, content, lang: l, deps });
    } else if (ch === 'push') {
      const { sendPushNotification } = await import('./push.js');
      const r = await sendPushNotification({ userId, type: isSecurity ? 'security' : type, title: content.pushTitle, body: content.pushBody, url: data.url || '/' });
      ok = r?.ok === true;
    }
    if (ok) {
      delivered.push(ch);
      // Cap count — faqat email uchun (telegram/push o'z recordNotifSent qiladi,
      // ikki marta count bo'lmasligi uchun)
      if (!isSecurity && ch === 'email') await recordNotifSent({ userId, channel: ch, type });
      logAuthEvent({
        action: AUDIT_ACTIONS.NOTIF_SENT,
        outcome: 'success',
        method: ch,
        actorId: safeKey(userId),
        channel: 'notif',
        details: { type, eventType, channel: ch, ts: now },
      }).catch(() => {});
      recordMetric(`notif.delivered.${ch}`, 1, { type: 'counter' })?.catch?.(() => {});
    } else {
      failed.push(ch);
    }
    // §24: security — bitta kanal yetgizdi, qolganlari shart emas
    if (isSecurity && delivered.length > 0) break;
  }

  return { ok: delivered.length > 0, delivered, failed, segment, cap };
}

/** Email kanal orqali xabar (B-20 security template / marketing oddiy). */
async function sendNotifEmail({ userId, type, eventType, content, lang, deps }) {
  try {
    let userSnap;
    try {
      userSnap = await fb.get(`users/${safeKey(userId)}`);
    } catch (_) { userSnap = null; }
    const email = userSnap?.exists() ? userSnap.val()?.email : null;
    if (!email) return false;

    let tpl = null;
    if (type === 'security') {
      // B-20 renderSecurity — device/browser/city preview (sensitive yo'q)
      const { renderSecurity } = await import('../email/templates.js');
      const alertType = ['password_changed', 'email_changed', 'suspicious'].includes(eventType) ? eventType : 'new_device';
      tpl = renderSecurity({
        type: alertType,
        device: 'Noma\'lum', browser: '', city: '', time: '', lang,
      });
    } else {
      // Marketing — oddiy matnli email (subject/body)
      tpl = {
        subject: content.subject,
        html: `<p style="font-size:15px;color:#334155">${String(content.emailBody).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>`,
        text: content.emailBody,
      };
    }

    const sendFn = deps.sendEmail
      ? (msg) => deps.sendEmail(msg).then((r) => ({ ok: true, ...r }))
      : (await import('../email/provider.js')).sendEmail;
    const sent = await sendFn({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, tag: `notif:${type}` });
    return sent?.ok === true;
  } catch (_) {
    return false;
  }
}

/**
 * §07 Kechiktirilgan xabarlarni to'kadi (server interval'da chaqiriladi).
 * Hali quiet bo'lsa — keyinga qoldiriladi; aks holda sendNotification orqali yuboriladi.
 */
export async function drainDelayedNotifications({ now = Date.now(), deps = {} } = {}) {
  const result = { sent: 0, stillDelayed: 0, failed: 0 };
  let snap;
  try {
    snap = await fb.get(NOTIF_DELAYED_PATH);
  } catch (_) {
    return result;
  }
  if (!snap || !snap.exists()) return result;

  for (const [userId, records] of Object.entries(snap.val())) {
    if (!records || typeof records !== 'object') continue;
    for (const [id, rec] of Object.entries(records)) {
      if (!rec || rec.dueAt > now) continue;
      // Hali quiet bo'lsa — keyinga
      const us = await fb.get(`users/${safeKey(userId)}`).catch(() => null);
      const quiet = us?.exists() ? (us.val()?.notif_prefs?.quiet ?? QUIET_DEFAULT) : QUIET_DEFAULT;
      if (inQuietHours(now, quiet)) {
        result.stillDelayed++;
        continue;
      }
      const r = await sendNotification({ userId, type: rec.type, eventType: rec.eventType, data: rec.data || {}, lang: rec.lang || 'uz', now, deps });
      if (r.ok) result.sent++;
      else if (r.reason === 'dedupe_24h') result.sent++; // allaqachon yuborilgan — muammo emas
      else result.failed++;
      await fb.remove(`${NOTIF_DELAYED_PATH}/${safeKey(userId)}/${id}`).catch(() => {});
    }
  }
  return result;
}

