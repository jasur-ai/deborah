/**
 * AUTH B-19 §09 — Welcome sequence (Day 0/1/3/7)
 * ---------------------------------------------------------------------------
 * Onboarding Reinforce'ni qo'llab-quvvatlaydigan scheduled job: har day uchun
 * bitta xabar (idempotent — day flag'lar + chastota cap; spam YO'Q, §10).
 *
 * Day 0 — Xush kelibsiz + birinchi amaliyot (Trophy darsi, §29)
 * Day 1 — Birinchi natija (first-win summary bo'lsa)
 * Day 3 — 3 tip (amaliyot/checklist/streak)
 * Day 7 — Haftalik rejim
 *
 * Kanal: email (B-20'da to'liq template'lar; hozircha struktura + audit + metric).
 * Telegram P2 — kanal tanlovi settings'dan (notifChannel), infra bo'lmagani
 * uchun email'ga tushadi.
 *
 * PII minimal (§16): faqat email + username + fan (izohlarda yo'q).
 */
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { sendEmail } from '../email/provider.js';
import { logAuthEvent } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';

export const WELCOME_DAYS = [
  { day: 0, key: 'w0', type: 'welcome' },
  { day: 1, key: 'w1', type: 'first_result' },
  { day: 3, key: 'w3', type: 'tips' },
  { day: 7, key: 'w7', type: 'weekly' },
];

// §10: chastota cap — bitta run'da har user uchun 1 ta xabar (loop safe)
const MAX_PER_RUN = 200;

function welcomeSubject(type, lang = 'uz') {
  const s = {
    welcome: { uz: 'Xush kelibsiz — Deborah', 'uz-cyrl': 'Хуш келибсиз — Deborah', ru: 'Добро пожаловать — Deborah', en: 'Welcome — Deborah' },
    first_result: { uz: 'Birinchi natijangiz', 'uz-cyrl': 'Биринчи натижангиз', ru: 'Ваш первый результат', en: 'Your first result' },
    tips: { uz: '3 ta foydali maslahat', 'uz-cyrl': '3 та фойдали маслаҳат', ru: '3 полезных совета', en: '3 useful tips' },
    weekly: { uz: 'Haftalik rejim tayyor', 'uz-cyrl': 'Ҳафталик режим тайёр', ru: 'Недельный план готов', en: 'Weekly plan ready' },
  };
  return s[type]?.[lang] || s[type]?.uz || 'Deborah';
}

function welcomeBody(type, lang = 'uz', ctx = {}) {
  const name = ctx.username || 'talaba';
  const subjectLabel = ctx.subject || '';
  const map = {
    welcome: {
      uz: `Salom, ${name}! Deborah'ga xush kelibsiz. Bugun 5 daqiqalik birinchi amaliyot bilan boshlang — keyingi qadamda sizni birinchi g'alaba kutadi.`,
      'uz-cyrl': `Салом, ${name}! Deborah'га хуш келибсиз. Бугун 5 дақиқалик биринчи амалиёт билан бошланг.`,
      ru: `Привет, ${name}! Добро пожаловать в Deborah. Начните сегодня с 5-минутной практики.`,
      en: `Hi ${name}! Welcome to Deborah. Start today with a 5-minute practice — your first win awaits.`,
    },
    first_result: {
      uz: `${name}, birinchi natijangizni ko'ring! ${subjectLabel ? subjectLabel + ' bo\'yicha ' : ''}Amaliyotda qancha to'plaganingizni tekshiring va davom eting.`,
      'uz-cyrl': `${name}, биринчи натижангизни кўринг! ${subjectLabel ? subjectLabel + ' бўйича ' : ''}Амалиётда қанча тўплаганингизни текширинг.`,
      ru: `${name}, посмотрите свой первый результат! Проверьте, сколько вы набрали${subjectLabel ? ' по ' + subjectLabel : ''}, и продолжайте.`,
      en: `${name}, check your first result! See how much you scored${subjectLabel ? ' on ' + subjectLabel : ''} and keep going.`,
    },
    tips: {
      uz: `${name}, 3 ta maslahat: 1) Har kuni 10 daqiqa amaliyot, 2) Checklist'ni yakunlang, 3) Streak'ni saqlang — 7 kun ketma-ket.`,
      'uz-cyrl': `${name}, 3 та маслаҳат: 1) Ҳар куни 10 дақиқа амалиёт, 2) Checklist'ни якунланг, 3) Streak'ни сақланг.`,
      ru: `${name}, 3 совета: 1) 10 минут практики каждый день, 2) Завершите чек-лист, 3) Держите стрик 7 дней.`,
      en: `${name}, 3 tips: 1) 10 minutes of practice daily, 2) Complete the checklist, 3) Keep a 7-day streak.`,
    },
    weekly: {
      uz: `${name}, haftalik rejimingiz tayyor! Panelda maqsadingizni ko'rib chiqing va bu hafta 3 ta amaliyotni yakunlang.`,
      'uz-cyrl': `${name}, ҳафталик режимингиз тайёр! Панелда мақсадингизни кўриб чиқинг.`,
      ru: `${name}, ваш недельный план готов! Посмотрите цель на панели и завершите 3 практики.`,
      en: `${name}, your weekly plan is ready! Review your goal on the panel and complete 3 practices this week.`,
    },
  };
  return map[type]?.[lang] || map[type]?.uz || '';
}

function resolveLang(user) {
  const l = user?.settings?.lang;
  if (['uz', 'uz-cyrl', 'ru', 'en'].includes(l)) return l;
  return 'uz';
}

/**
 * Barcha onboarding'dan o'tgan userlar uchun welcome day'larini tekshiradi.
 * Idempotent: `onboarding/{safeKey}/welcomeSent` object — { w0: ts, w1: ts, ... }.
 * Faqat kerakli day'lar yuboriladi; har run'da 1 tadan ko'p emas (cap).
 */
export async function runWelcomeSequence({ now = Date.now(), deps = {} } = {}) {
  const send = deps.sendEmail || ((msg) => sendEmail(msg).catch(() => ({ ok: false })));
  const result = { sent: 0, skipped: 0, total: 0 };

  let usersSnap;
  try {
    usersSnap = await fb.get('users');
  } catch (_) {
    return result; // fail-open
  }
  if (!usersSnap || !usersSnap.exists()) return result;

  const users = usersSnap.val();
  const entries = Object.entries(users);
  result.total = entries.length;

  for (const [userKey, u] of entries) {
    if (result.sent >= MAX_PER_RUN) break;

    // Faqat onboarding'ni boshlagan (orient yoki first-win) userlar
    const onboardingSnap = await fb.get(`onboarding/${safeKey(userKey)}`).catch(() => null);
    if (!onboardingSnap || !onboardingSnap.exists()) { result.skipped++; continue; }
    const ob = onboardingSnap.val();
    // welcome'dan o'tmagan / orient qilmagan → skip
    if (!ob?.orient && !ob?.firstWin?.startedAt) { result.skipped++; continue; }

    const sentMap = ob?.welcomeSent && typeof ob.welcomeSent === 'object' ? ob.welcomeSent : {};
    const lang = resolveLang({ settings: u?.settings });
    const email = u?.email || u?.username_email || null;
    if (!email) { result.skipped++; continue; }

    for (const d of WELCOME_DAYS) {
      if (sentMap[d.key]) continue; // §10: har day bir marta
      const ageDays = Math.floor((now - (ob.activated_at || ob.updated_at || now)) / 86400000);
      if (ageDays < d.day) continue;

      const ctx = {
        username: u?.username || userKey,
        subject: ob?.orient?.subject || ob?.firstWin?.subject || '',
      };
      const sent = await send({
        to: email,
        subject: welcomeSubject(d.type, lang),
        html: `<p>${welcomeBody(d.type, lang, ctx)}</p>`,
        text: welcomeBody(d.type, lang, ctx),
        tag: `welcome-${d.key}`,
      }).catch(() => ({ ok: false }));

      if (!sent || sent.ok === false) { result.skipped++; continue; }

      // day flag yoziladi — qayta yuborilmaydi
      const next = { ...sentMap, [d.key]: Date.now() };
      await fb.set(`onboarding/${safeKey(userKey)}/welcomeSent`, next).catch(() => {});
      await logAuthEvent({
        action: 'onboarding:welcome_sent',
        outcome: 'success',
        method: 'job',
        actorId: userKey,
        details: { day: d.day, type: d.type, channel: 'email' },
      }).catch(() => {});
      recordMetric('deborah_onboarding_welcome_sent_total', 1);
      result.sent++;
      break; // har run'da bitta day — chastota cap
    }
  }

  return result;
}
