/**
 * Deborah — New-device detection & suspicious activity alerts (AUTH A-09)
 * -------------------------------------------------------------------
 * A-09 (guide §6-§13, §29-§30):
 *   - Login'da ip_hash/UA `users.{key}.last_login_ip_hash` bilan solishtiriladi.
 *   - Yangi qurilma → xabar queue: "Yangi qurilmadan kirish aniqlandi:
 *     [qurilma], [shahar], [vaqt]" (email/Telegram — settings'da tanlanadi).
 *   - Xabar ichida: "Bu siz bo'lmasangiz — parolni o'zgartiring" +
 *     [Sessiyalarni yakunlash] link.
 *   - Suspicious rules (§9): geolocation keskin o'zgarish; tez ketma-ket
 *     login; ko'p qurilma bir akkauntda.
 *   - Dedupe: 24 soatda 1 marta (§11); chastota cap: kuniga ≤2 (§30).
 *   - Preview'da sensitive yo'q (§13) — faqat qurilma/vaqt/shahar; ip_hash
 *     saqlanadi lekin hech qachon preview'ga chiqmaydi.
 *   - Metrics: new_device_alert_sent / suspicious_alert (§19).
 *
 * Delivery: email/Telegram infra P2 — hozircha queue'ga yoziladi va
 * `deliverAlert` status'ni 'delivered' qiladi (dev/test'da preview log).
 * Infra ulanganda `deliverAlert` real yetkazishga almashtiriladi.
 */
import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import CONFIG from '../../config/env.js';
import { audit, AUDIT_ACTIONS, logAuthEvent } from './audit.js';
import { getUserSessions } from './session-manager.js';
import { cityFromIp, cityChanged } from './geo-lite.js';
import { recordMetric } from '../../telemetry/index.js';
import { AUTH_COPY } from '../../../data/auth-i18n.js';

// ── Konfiguratsiya ──
const NEW_DEVICE_DEDUPE_MS = 24 * 60 * 60 * 1000; // 24 soatda 1 marta
const DAILY_ALERT_CAP = CONFIG.AUTH_ALERT_DAILY_CAP ?? 2; // kuniga ≤2 (§30)
const SUSPICIOUS_CITY_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 soatda keskin o'zgarish
const RAPID_LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 daqiqa
const RAPID_LOGIN_THRESHOLD = 3; // ≥3 ta turli IP shu oynada
const MAX_DEVICES_THRESHOLD = 5; // ≥5 ta qurilma bitta akkauntda
const ALERT_PATH = 'alerts';

// ── Per-user queue mutex (review: cap/dedupe state read-modify-write race) ──
// lockout.js `withUserFailureLock` pattern'i — parallel login'lar state'ni
// bir-birini kesib o'tib cap/dedupe'ni buzmasin.
const queueLocks = new Map(); // userId -> tail Promise

/** Per-user queue mutex — parallel yozuvlar state'ni race qilmasin (A-09). */
export async function withQueueLock(userId, fn) {
  const prev = queueLocks.get(userId) || Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const next = prev.catch(() => {}).then(() => gate);
  queueLocks.set(userId, next);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (queueLocks.get(userId) === next) queueLocks.delete(userId);
  }
}

/** ICU'siz Node'da ham ishlaydigan vaqt format (review: toLocaleString xavfi). */
function formatAlertTime(ts, lang) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return lang === 'en' ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}` : `${date} ${time}`;
}

// ── UA parse (qurilma + brauzer — preview'ga faqat shu agregatlar chiqadi) ──
export function parseDevice(ua) {
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
  return { device, browser };
}

/** IP → sha256 hash (PII minimal — faqat saqlash/taqqoslash uchun). */
export function ipHash(ipAddress) {
  if (!ipAddress) return null;
  return crypto.createHash('sha256').update(String(ipAddress)).digest('hex');
}

// ── Yangi qurilma aniqlash (§6) ──

/**
 * Login'da ip_hash/UA tekshirish: `users.{key}.last_login_ip_hash` + mavjud
 * session record'lar bilan solishtirish.
 *
 * @param {{ userId: string, ipAddress?: string, userAgent?: string, prevLoginState?: object, excludeSessionId?: string }} params
 *   prevLoginState — login boshlanishidagi oldingi holat ({ ipHash, city, at }).
 *   Berilmasa DB'dan o'qiladi (mustaqil foydalanish uchun).
 *   excludeSessionId — hozir yozilayotgan session'ni solishtiruvdan chiqarish
 *   (review: recordSession fire-and-forget — aks holda aniqlash race qilardi).
 * @returns {Promise<{ isNew: boolean, knownCount: number, reason: string|null }>}
 */
export async function evaluateNewDevice({ userId, ipAddress, userAgent, prevLoginState, excludeSessionId }) {
  if (!userId) return { isNew: false, knownCount: 0, reason: null };

  const currentIpHash = ipHash(ipAddress);
  const { device, browser } = parseDevice(userAgent);

  // 1) last_login_ip_hash bilan solishtirish (§6) — route'dan eski state
  // berilgan bo'lsa uni ishlatamiz (yangi login uni overwrite qilgan bo'lishi mumkin).
  let lastIpHash = prevLoginState?.ipHash ?? null;
  if (lastIpHash === null || prevLoginState === undefined) {
    try {
      const snap = await fb.get(`users/${userId}/last_login_ip_hash`);
      if (snap.exists()) lastIpHash = snap.val();
    } catch (_) { /* non-critical */ }
  }

  if (currentIpHash && lastIpHash && currentIpHash === lastIpHash) {
    // Bir xil IP'lik qurilma — oldin ko'rilgan
    return { isNew: false, knownCount: 1, reason: null };
  }

  // 2) Mavjud session record'lar bilan solishtirish (IP HAM UA ham tanish bo'lsa)
  // Hozir yozilayotgan session (excludeSessionId) chiqarib tashlanadi — aks holda
  // o'z session'i "tanish IP" bo'lib ko'rinib, yangi qurilma aniqlanmas edi.
  let sessions = {};
  try {
    sessions = await getUserSessions(userId);
  } catch (_) {}
  const known = Object.values(sessions || {}).filter((s) => s.sessionId !== excludeSessionId);
  if (known.length) {
    const seenSameIp = known.some((s) => s.ipHash && currentIpHash && s.ipHash === currentIpHash);
    const seenSameUa = known.some((s) => s.userAgent && userAgent && s.userAgent === userAgent.substring(0, 500));
    // Birinchi login (record yo'q) — "yangi" EMAS (A-05 qoidasi: FARQ qilmaydi).
    if (seenSameIp || seenSameUa) {
      return { isNew: false, knownCount: known.length, reason: null };
    }
  }

  const isNew = !!(currentIpHash && (lastIpHash ? currentIpHash !== lastIpHash : known.length > 0));
  return {
    isNew,
    knownCount: known.length,
    reason: isNew ? 'unseen_device' : null,
    device,
    browser,
  };
}

// ── Suspicious rules (§9) ──

/**
 * Suspicious holatni baholaydi — 3 qoida:
 *   1. Geolocation keskin o'zgarish (2 soat ichida boshqa shahardan login)
 *   2. Tez ketma-ket login (10 daqiqada ≥3 turli IP)
 *   3. Ko'p qurilma bir akkauntda (≥5 session)
 *
 * @param {{ userId: string, ipAddress?: string, userAgent?: string, prevLoginState?: object }} params
 * @returns {Promise<{ suspicious: boolean, rules: string[] }>}
 */
export async function evaluateSuspicious({ userId, ipAddress, userAgent, prevLoginState }) {
  if (!userId) return { suspicious: false, rules: [] };
  const rules = [];
  const now = Date.now();

  // Qoida 1: geolocation keskin o'zgarish — eski shahar/vaqt route'dan keladi
  // (yangi login ularni overwrite qilgan bo'lishi mumkin). prevLoginState
  // berilmasa DB'dan o'qiladi (mustaqil foydalanish/test uchun).
  const city = cityFromIp(ipAddress);
  try {
    let lastLoginAt = prevLoginState?.at ?? 0;
    let lastCity = prevLoginState?.city ?? null;
    if (prevLoginState === undefined) {
      const snap = await fb.get(`users/${userId}/last_login_at`);
      lastLoginAt = snap.exists() && typeof snap.val() === 'number' ? snap.val() : 0;
      const citySnap = await fb.get(`users/${userId}/last_city`);
      lastCity = citySnap.exists() ? citySnap.val() : null;
    }
    if (city && lastLoginAt && now - lastLoginAt < SUSPICIOUS_CITY_WINDOW_MS) {
      if (cityChanged(lastCity, city)) {
        rules.push('city_change_rapid');
      }
    }
  } catch (_) { /* non-critical */ }

  // Qoida 2 + 3: session record'lar bir marta o'qiladi (review: ikki marta
  // o'qish keraksiz edi).
  let sessions = {};
  try {
    sessions = await getUserSessions(userId);
  } catch (_) {}
  const known = Object.values(sessions || {});

  // Qoida 2: tez ketma-ket login — 10 daqiqada ≥3 turli ipHash
  try {
    const recent = known.filter((s) => s.createdAt && now - s.createdAt < RAPID_LOGIN_WINDOW_MS);
    const distinctIps = new Set(recent.map((s) => s.ipHash).filter(Boolean));
    if (distinctIps.size >= RAPID_LOGIN_THRESHOLD) {
      rules.push('rapid_distinct_ips');
    }
  } catch (_) {}

  // Qoida 3: ko'p qurilma — ≥5 session (turli ipHash)
  try {
    const distinctUa = new Set(known.map((s) => s.userAgent).filter(Boolean));
    if (known.length >= MAX_DEVICES_THRESHOLD && distinctUa.size >= 3) {
      rules.push('many_devices');
    }
  } catch (_) {}

  return { suspicious: rules.length > 0, rules };
}

// ── Alert queue (§11) + dedupe + cap (§30) ──

/** Bugungi day-key — kunlik cap uchun. */
function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Yangi qurilma/suspicious alert'ni queue'ga yozadi.
 * Dedupe: 24 soatda har tur uchun 1 marta. Cap: kuniga ≤2.
 *
 * @param {{ userId: string, type?: string, ipAddress?: string, userAgent?: string, bypassDailyCap?: boolean }} params
 *   bypassDailyCap — security-critical xabarlar (password_changed, email_changed,
 *   email_change_warning) uchun kunlik cap'ni hisobga olmaydi (AUTH A-29 §06-§07:
 *   akkaunt egasi o'zgarishlardan DOIM xabardor bo'lishi shart — cap ularni
 *   tashlab yubormasligi kerak). Dedupe 24h qoladi.
 * @returns {Promise<{ queued: boolean, alertId?: string, reason?: string }>}
 */
export async function queueNewDeviceAlert({ userId, type = 'new_device', ipAddress, userAgent, bypassDailyCap = false }) {
  if (!userId) return { queued: false, reason: 'no_user' };

  // Per-user mutex: parallel login'lar state'ni race qilib cap/dedupe'ni
  // buzmasin (review #2).
  return withQueueLock(userId, async () => {
    // ── Dedupe + cap: users.{key}.alerts.{dayKey} ──
    const statePath = `users/${userId}/alerts`;
    const now = Date.now();
    const today = dayKey(now);

    let state = {};
    try {
      const snap = await fb.get(statePath);
      if (snap.exists()) state = snap.val() || {};
    } catch (_) {}

    const todayState = state[today] || { count: 0, types: {} };

    // Cap: kuniga ≤2 (§30) — A-29: security-critical tiplar bypass (bypassDailyCap)
    if (!bypassDailyCap && todayState.count >= DAILY_ALERT_CAP) {
      return { queued: false, reason: 'daily_cap' };
    }
    // Dedupe: 24 soatda har tur uchun 1 marta (§11)
    if (todayState.types[type] && now - todayState.types[type] < NEW_DEVICE_DEDUPE_MS) {
      return { queued: false, reason: 'dedupe_24h' };
    }

    // ── Alert record yaratish ──
    const alertId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const { device, browser } = parseDevice(userAgent);
    const city = cityFromIp(ipAddress);
    // Lang: user settings'dan (review #3 — §16 4 til talabi bajarilishi uchun)
    let lang = 'uz';
    try {
      const settingsSnap = await fb.get(`users/${userId}/settings`);
      if (settingsSnap.exists()) {
        const s = settingsSnap.val();
        if (s?.lang && ['uz', 'uz-cyrl', 'ru', 'en'].includes(s.lang)) lang = s.lang;
      }
    } catch (_) {}
    const record = {
      type,
      userId,
      device,
      browser,
      city, // agregat — sensitive emas (§13)
      ipHash: ipHash(ipAddress), // PII — hech qachon preview'ga chiqmaydi
      time: now,
      lang,
      channel: null, // deliverAlert'da belgilanadi
      status: 'queued',
      createdAt: now,
    };

    await fb.set(`${ALERT_PATH}/${userId}/${alertId}`, record);

    // ── State yangilash (dedupe/cap uchun) ──
    todayState.count += 1;
    todayState.types[type] = now;
    state[today] = todayState;
    // eski kunlarni tozalash (30 kundan kattasini olib tashlash)
    for (const k of Object.keys(state)) {
      if (k < dayKey(now - 30 * 24 * 60 * 60 * 1000)) delete state[k];
    }
    await fb.set(statePath, state);

    // Metrics (§19)
    try {
      recordMetric('auth.new_device_alert_sent', 1, { type: 'counter', labels: { alertType: type } });
    } catch (_) {}

    return { queued: true, alertId };
  });
}

/**
 * Alert'ni "yetkazadi" — email/Telegram infra P2; hozircha status'ni
 * 'delivered' qiladi + preview'ni (dev/test'da) log'laydi. Return: preview.
 */
export async function deliverAlert({ userId, alertId }, deps = {}) {
  const path = `${ALERT_PATH}/${userId}/${alertId}`;
  const snap = await fb.get(path);
  if (!snap.exists()) return { ok: false, error: 'alert_not_found' };
  const alert = snap.val();

  // Channel: AUTH B-21 notif prefs orqali (security hodisalari forced —
  // email fallback har doim). Telegram default (§12/§08).
  let channel = 'telegram';
  try {
    const { dispatchNotification } = await import('../student/notifications.js');
    const routed = await dispatchNotification({ userId, type: 'security', eventType: alert.type });
    // Telegram default (§08), email faqat telegram o'chirilgan bo'lsa (fallback)
    if (routed.ok && routed.channels.includes('telegram')) channel = 'telegram';
    else if (routed.ok && routed.channels.includes('email')) channel = 'email';
  } catch (_) {}

  // Preview — sensitive yo'q (§13): faqat qurilma/vaqt/shahar
  const preview = buildAlertPreview(alert, alert.lang || 'uz');

  // Infra P2: real yetkazish shu yerda (Telegram API / SMTP).
  // Email kanalida AUTH B-20 security template orqali yuboramiz (fail-soft;
  // mock provider dev/test'da hech qaerga yubormaydi).
  if (channel === 'email') {
    try {
      const { renderSecurity } = await import('../email/templates.js');
      const { sendEmail } = await import('../email/provider.js');
      const sendFn = deps.sendImpl ? (msg) => deps.sendImpl(msg).then((r) => ({ ok: true, ...r })) : sendEmail;
      const alertType = ['password_changed', 'email_changed', 'suspicious'].includes(alert.type)
        ? alert.type : 'new_device';
      const tpl = renderSecurity({
        type: alertType,
        device: alert.device,
        browser: alert.browser,
        city: alert.city,
        time: preview.time,
        lang: alert.lang || 'uz',
      });
      const userSnap = await fb.get(`users/${userId}`);
      const userData = userSnap.exists() ? userSnap.val() : {};
      const to = userData.email;
      if (to) {
        const sent = await sendFn({ to, subject: tpl.subject, html: tpl.html, text: tpl.text, tag: `security:${alertType}` });
        if (sent.ok) {
          try { recordMetric('auth.security_alert_email', 1, { type: 'counter', labels: { alertType } }); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn(`[alert:${alert.type}] email send failed (fail-soft):`, e?.message || e);
    }
  } else if (channel === 'telegram') {
    // AUTH B-22: telegram kanali — sendTelegramMessage orqali (fail-soft)
    try {
      const { sendTelegramMessage } = await import('../email/telegram.js');
      const tgSnap = await fb.get(`users/${userId}/telegram_id`);
      const chatId = tgSnap.exists() ? tgSnap.val() : null;
      if (chatId) {
        const text = `${preview.subject}\n\n${preview.body}`.slice(0, 4096);
        const sent = await sendTelegramMessage({ chatId, text, deps });
        if (sent.ok) {
          try { recordMetric('auth.security_alert_telegram', 1, { type: 'counter' }); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn(`[alert:${alert.type}] telegram send failed (fail-soft):`, e?.message || e);
    }
  } else if (CONFIG.NODE_ENV !== 'production') {
    console.log(`[alert:${alert.type}] ${userId}: ${preview.subject} — ${preview.body}`);
  }

  alert.status = 'delivered';
  alert.channel = channel;
  alert.deliveredAt = Date.now();
  await fb.set(path, alert);

  // Audit (§10) — aniq xabar yuborildi
  try {
    await logAuthEvent({
      action: 'auth.alert.delivered',
      outcome: 'success',
      method: channel,
      actorId: userId,
      details: { alertType: alert.type },
    });
  } catch (_) {}

  return { ok: true, channel, preview };
}

// ── Preview builder (sensitive yo'q — §13, §17) ──

/**
 * Xabar preview'ini quradi — FAQAT qurilma/vaqt/shahar (agregat).
 * ipHash, to'liq IP, raw UA hech qachon kirmaydi.
 * @param {Object} alert — alert record
 * @param {string} lang
 */
export function buildAlertPreview(alert, lang = 'uz') {
  const l = AUTH_COPY[lang] || AUTH_COPY.uz;
  const alertsCopy = l.alerts || {};
  // ICU'siz Node build'larida ham ishlaydi (review #6)
  const time = formatAlertTime(alert.time || Date.now(), lang);
  const city = alert.city || alertsCopy.unknownCity || 'Noma\'lum shahar';
  const device = [alert.device, alert.browser].filter(Boolean).join(' / ') || alertsCopy.unknownDevice || 'Noma\'lum qurilma';

  // AUTH A-29: yangi xabar tiplari — password_changed / email_changed
  let subject = alertsCopy.newDeviceSubject;
  let body = alertsCopy.newDeviceBody || '';
  if (alert.type === 'suspicious') {
    subject = alertsCopy.suspiciousSubject;
    body = alertsCopy.suspiciousBody || '';
  } else if (alert.type === 'password_changed') {
    subject = alertsCopy.passwordChangedSubject;
    body = alertsCopy.passwordChangedBody || '';
  } else if (alert.type === 'email_changed') {
    subject = alertsCopy.emailChangedSubject;
    body = alertsCopy.emailChangedBody || '';
  } else if (alert.type === 'email_change_warning') {
    subject = alertsCopy.emailChangeWarningSubject;
    body = alertsCopy.emailChangeWarningBody || '';
  }
  body = String(body)
    .replace('__device__', device)
    .replace('__city__', city)
    .replace('__time__', time);

  return {
    subject,
    body,
    // Sensitive-ga tekshirish uchun foydali agregatlar (security test)
    device,
    city,
    time,
    hasSensitive: false, // invariant: build jarayonida ipHash/UA kiritilmaydi
  };
}

/** Testlar uchun queue mutex store tozalash. */
export function _resetNewDeviceStores() {
  queueLocks.clear();
}
