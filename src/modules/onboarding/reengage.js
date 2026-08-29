/**
 * AUTH B-35 — Re-engagement journey (7/14 kun)
 * ---------------------------------------------------------------------------
 * Harakatsiz userlarni qaytarish: yumshoq qiymat xabari (7-kun) va qaytish
 * rejasi (14-kun). Welcome journey (B-19, Day 0/1/3/7) dan alohida — bu
 * MARKETING xabari, shuning uchun:
 *   §14 Opt-out: user email kanalini yoqmaguncha yuborilmaydi
 *     (B-21 default channels.email=false — privacy-first opt-in).
 *   §15 Suppress: hard-bounce/complaint'dagi email'ga yuborilmaydi (A-23/B-31).
 *   §11 Segment: B-32 `userSegment` qayta ishlatiladi — lapsed → win-back matn.
 *   §13 Timezone: Asia/Tashkent (UTC+5) chegarasi bo'yicha kun hisobi.
 *   §25 Idempotency: `onboarding/{key}/reengageSent` flag'lar — har step bir marta.
 *
 * PII minimal (§16): faqat email + username + subject. Preview sensitive YO'Q.
 */
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { sendEmail } from '../email/provider.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';
import { userSegment } from '../student/notifications.js';

// §08: kadans — 7-kun yumshoq qiymat, 14-kun qaytish rejasi
export const REENGAGE_STEPS = [
  { key: 'r7', minInactiveDays: 7, type: 're_engage_7' },
  { key: 'r14', minInactiveDays: 14, type: 're_engage_14' },
];

// §10: chastota cap — bitta run'da har user uchun 1 ta xabar (loop safe)
const MAX_PER_RUN = 200;

/** Asia/Tashkent = UTC+5 — kun chegarasi Toshkent vaqti bo'yicha. */
export function tashkentNow(now = Date.now()) {
  return now + 5 * 60 * 60 * 1000;
}

function reengageSubject(type, lang = 'uz', opts = {}) {
  const s = {
    re_engage_7: {
      uz: 'Sizni kutib qolamiz, {name}!',
      'uz-cyrl': 'Сизни кутиб қоламиз, {name}!',
      ru: 'Ждём вас, {name}!',
      en: 'We miss you, {name}!',
    },
    re_engage_14: {
      uz: 'Qaytish rejangiz tayyor, {name}',
      'uz-cyrl': 'Қайтиш режингиз тайёр, {name}',
      ru: 'Ваш план возвращения готов, {name}',
      en: 'Your return plan is ready, {name}',
    },
  };
  const tpl = s[type]?.[lang] || s[type]?.uz;
  return tpl.replace('{name}', opts?.username || '');
}

function reengageBody(type, lang = 'uz', ctx = {}) {
  const name = ctx.username || 'talaba';
  const subject = ctx.subject || '';
  const lapsed = ctx.segment === 'lapsed';
  const map = {
    re_engage_7: {
      uz: `Salom, ${name}! ${subject ? `"${subject}" bo'yicha ` : ''}so'nggi natijalaringiz va yangi materiallar tayyor. Qaytganingizda qayerdan davom etganingizni bilasiz — 10 daqiqa yetarli.`,
      'uz-cyrl': `Салом, ${name}! ${subject ? `"${subject}" бўйича ` : ''}сўнгги натижаларингиз ва янги материаллар тайёр. Қайтганингизда қаердан давом этганингизни биласиз — 10 дақиқа етарли.`,
      ru: `Привет, ${name}! ${subject ? `По теме "${subject}" ` : ''}готовы ваши последние результаты и новые материалы. Вы легко продолжите с того места, где остановились — хватит 10 минут.`,
      en: `Hi ${name}! ${subject ? `On "${subject}" ` : ''}your latest results and new materials are ready. Pick up right where you left off — 10 minutes is enough.`,
    },
    re_engage_14: {
      uz: `${name}, 14 kun bo'ldi — sizni qaytarish uchun 3 kunlik reja tuzdik: 1-kun 5 daqiqa amaliyot, 2-kun natijalarni ko'rib chiqish, 3-kun yangi test. ${lapsed ? 'Maqsadingiz hali ham o\'sha yerda — davom etamiz.' : ''}`,
      'uz-cyrl': `${name}, 14 кун бўлди — сизни қайтариш учун 3 кунлик режим туздик: 1-кун 5 дақиқа амалиёт, 2-кун натижаларни кўриб чиқиш, 3-кун янги тест.`,
      ru: `${name}, прошло 14 дней — мы подготовили 3-дневный план возвращения: день 1 — 5 минут практики, день 2 — обзор результатов, день 3 — новый тест. ${lapsed ? 'Ваша цель всё ещё там — продолжим.' : ''}`,
      en: `${name}, it's been 14 days — here's a 3-day return plan: day 1 — 5 min practice, day 2 — review results, day 3 — new quiz. ${lapsed ? 'Your goal is still there — let\'s continue.' : ''}`,
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
 * Marketing ruxsati: email kanal opt-in bo'lishi shart (B-21 default false —
 * privacy-first). Security xabarlar bu tekshiruvdan o'tmaydi (forced).
 */
function isMarketingAllowed(user) {
  if (!user) return false;
  if (user.notif_prefs?.marketing_disabled === true) return false;
  return user.notif_prefs?.channels?.email === true;
}

const BOUNCE_SUPPRESS_PATH = 'email_suppressed';

/** Email suppress index'ida bormi? (email_suppressed/{email}) */
async function emailIsSuppressed(email) {
  if (!email) return true;
  try {
    const snap = await fb.get(`${BOUNCE_SUPPRESS_PATH}/${safeKey(email.toLowerCase())}`);
    return snap.exists();
  } catch (_) {
    return false;
  }
}

/**
 * Harakatsiz userlar uchun 7/14-kun re-engagement xabarlarini yuboradi.
 * Idempotent: `onboarding/{key}/reengageSent` — { r7: ts, r14: ts }.
 * @param {{ now?: number, deps?: object }} opts
 */
export async function runReEngagementSequence({ now = Date.now(), deps = {} } = {}) {
  const send = deps.sendEmail || ((msg) => sendEmail(msg).catch(() => ({ ok: false })));
  const tzNow = tashkentNow(now);
  const result = { sent: 0, skippedOptOut: 0, skippedSuppressed: 0, skippedActive: 0, total: 0 };

  let usersSnap;
  try {
    usersSnap = await fb.get('users');
  } catch (_) {
    return result; // §25 fail-open — keyingi run'da qayta
  }
  if (!usersSnap || !usersSnap.exists()) return result;

  const users = usersSnap.val();
  result.total = Object.keys(users).length;

  for (const [userKey, u] of Object.entries(users)) {
    if (result.sent >= MAX_PER_RUN) break;
    if (!u) continue;

    const email = u.email || u.username_email || null;
    if (!email) continue;

    const onboardingSnap = await fb.get(`onboarding/${safeKey(userKey)}`).catch(() => null);
    if (!onboardingSnap || !onboardingSnap.exists()) continue;
    const ob = onboardingSnap.val();
    // Faqat onboarding'ni boshlagan (orient/first-win) userlar
    if (!ob?.orient && !ob?.firstWin?.startedAt) continue;

    // Faollik yoshi — Asia/Tashkent chegarasi bo'yicha
    const lastActive = u.last_active || u.last_login || u.lastSeen || 0;
    const inactiveMs = lastActive ? tzNow - lastActive : Infinity;
    const inactiveDays = Math.floor(inactiveMs / 86400000);

    const sentMap = ob?.reengageSent && typeof ob.reengageSent === 'object' ? ob.reengageSent : {};
    const lang = resolveLang({ settings: u.settings });
    const ctx = {
      username: u.username || userKey,
      subject: ob?.orient?.subject || ob?.firstWin?.subject || '',
      segment: userSegment(u), // B-32 qayta ishlatiladi (§11)
    };

    for (const step of REENGAGE_STEPS) {
      if (sentMap[step.key]) continue; // §25: har step bir marta
      if (inactiveDays < step.minInactiveDays) continue; // hali harakatsiz emas / qaytib kelgan

      // §14 Opt-out — marketing xabari faqat email opt-in bo'lsa
      if (!isMarketingAllowed(u)) {
        result.skippedOptOut++;
        recordMetric('reengage.opted_out', 1, { type: 'counter' })?.catch?.(() => {});
        logAuthEvent({
          action: AUDIT_ACTIONS.REENGAGE_OPTED_OUT,
          outcome: 'skipped',
          method: 'job',
          actorId: userKey,
          details: { step: step.key, reason: 'marketing_off' },
        }).catch(() => {});
        continue;
      }

      // §15 Suppress — bounce/complaint'dagi email'ga yuborilmaydi
      if (u.email_status === 'bounced' || (await emailIsSuppressed(email))) {
        result.skippedSuppressed++;
        continue;
      }

      const sent = await send({
        to: email,
        subject: reengageSubject(step.type, lang, { username: u.username || userKey }),
        html: `<div style="font-family:Arial,sans-serif;color:#1a1a1a;background:#ffffff;max-width:520px;margin:0 auto;padding:24px"><h1 style="font-size:20px;line-height:1.3;margin:0 0 12px;color:#111111">${reengageSubject(step.type, lang, { username: u.username || userKey })}</h1><p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#1a1a1a">${reengageBody(step.type, lang, ctx)}</p><a href="https://deborah.uz/user/panel" style="display:inline-block;background:#1463ff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600">${lang === 'ru' ? 'Перейти в панель' : lang === 'en' ? 'Go to panel' : lang === 'uz-cyrl' ? 'Панелга ўтиш' : 'Panelga o\'tish'}</a></div>`,
        text: `${reengageSubject(step.type, lang, { username: u.username || userKey })}\n\n${reengageBody(step.type, lang, ctx)}\n\nhttps://deborah.uz/user/panel`,
        tag: `reengage-${step.key}`,
      }).catch(() => ({ ok: false }));

      if (!sent || sent.ok === false) continue; // §25: fail → keyingi run'da qayta

      const next = { ...sentMap, [step.key]: Date.now() };
      await fb.set(`onboarding/${safeKey(userKey)}/reengageSent`, next).catch(() => {});
      await logAuthEvent({
        action: AUDIT_ACTIONS.REENGAGE_SENT,
        outcome: 'success',
        method: 'job',
        actorId: userKey,
        details: { step: step.key, day: step.minInactiveDays, segment: ctx.segment, channel: 'email' },
      }).catch(() => {});
      recordMetric('deborah_onboarding_reengage_sent_total', 1);
      result.sent++;
      break; // §10: har run'da bitta day — chastota cap
    }
  }

  return result;
}
