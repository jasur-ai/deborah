/**
 * AUTH A-23 — Email template'lar (transactional, 4 til)
 * -------------------------------------------------
 * Template'lar: verify (6-kod), reset (token havola), welcome,
 * teacher_approved, teacher_rejected. Har biri HTML + plain-text.
 *
 * SPAM qoidalari (A-23 §14):
 *   - ALL CAPS yo'q (preheader/subject'da ham)
 *   - "FREE", "!!!", "URGENT", "100%", "$", "!" spam trigger'lar yo'q
 *   - Rasmlar yo'q (faqat text + inline SVG'lar emas — pure text)
 *   - Preheader (email client preview) har template'da
 *   - Plain-text versiya har doim mavjud
 *
 * 4 til: uz (default), uz-cyrl, ru, en — AUTH_LANGS bilan mos.
 */

import { AUTH_LANGS, DEFAULT_AUTH_LANG } from '../../../data/auth-i18n.js';

const BRAND = 'Edikit';

/** Har bir til uchun UI matnlar (spam-free, qisqa). */
const T = {
  uz: {
    hello: 'Salom',
    verifyTitle: 'Email tasdiqlash kodi',
    verifyBody: "Email manzilingizni tasdiqlash uchun quyidagi 6 xonali kodni kiriting:",
    resetTitle: 'Parolni tiklash',
    resetBody: "Parolingizni tiklash uchun quyidagi tugmani bosing. Havola 15 daqiqa amal qiladi.",
    resetBtn: 'Parolni tiklash',
    welcomeTitle: 'Xush kelibsiz',
    welcomeBody: "Edikit hisobingiz muvaffaqiyatli yaratildi. Tizimdan kirishingiz mumkin.",
    teacherApprovedTitle: "O‘qituvchi arizasi qabul qilindi",
    teacherApprovedBody: "O‘qituvchi arizangiz tasdiqlandi. Endi darslarni boshqarishingiz mumkin.",
    teacherApprovedCta: 'Birinchi testingizni yarating',
    teacherRejectedTitle: "O‘qituvchi arizasi rad etildi",
    teacherRejectedBody: "O‘qituvchi arizangiz rad etildi. Savollaringiz bo‘lsa, administrator bilan bog‘laning.",
    inviteTitle: 'Sinflarga taklif',
    inviteBody: "Siz Edikit platformasiga taklif qilindingiz. Ro‘yxatdan o‘tish uchun quyidagi tugmani bosing. Havola 7 kun amal qiladi.",
    inviteBtn: 'Taklifni qabul qilish',
    inviteGroup: 'Guruh',
    welcomeBtn: 'Birinchi amaliyotni boshlang',
    rejectedReason: 'Sabab',
    securityPasswordTitle: 'Parol o‘zgartirildi',
    securityPasswordBody: 'Hisobingiz paroli o‘zgartirildi. Agar bu amalni siz bajarmagan bo‘lsangiz, darhol parolni qayta o‘zgartiring va administratorga murojaat qiling.',
    securityEmailTitle: 'Email manzili o‘zgartirildi',
    securityEmailBody: 'Hisobingiz email manzili o‘zgartirildi. Agar bu amalni siz bajarmagan bo‘lsangiz, administratorga murojaat qiling.',
    securityNewDeviceTitle: 'Yangi qurilmadan kirish',
    securityNewDeviceBody: 'Hisobingizga yangi qurilmadan kirish qayd etildi. Agar bu siz bo‘lsangiz, hech narsa qilish shart emas.',
    securitySuspiciousTitle: 'Shubhali kirish aniqlandi',
    securitySuspiciousBody: 'Hisobingizga shubhali kirish aniqlandi. Parolni o‘zgartirib, ikki bosqichli himoyani yoqishni tavsiya qilamiz.',
    securityDevice: 'Qurilma',
    securityCity: 'Shahar',
    securityTime: 'Vaqt',
    securityAction: 'Xavfsizlik bo‘limiga o‘tish',
    breachTitle: 'Parolingiz xavfsizlik buzilishida topildi',
    breachBody: 'Sizning parolingiz ma’lum xavfsizlik buzilishida (breach) topildi. Xavfsizligingiz uchun parolni darhol o‘zgartiring.',
    breachBtn: 'Parolni o‘zgartirish',
    footer: 'Bu xat avtomatik yuborildi. Iltimos, javob bermang.',
    ignore: "Agar siz bu amalni bajargan bo‘lmasangiz, xatni e'tiborsiz qoldiring.",
    codeLabel: 'Tasdiqlash kodi',    codeLabel: 'Tasdiqlash kodi',
    emailChangeTitle: 'Email manzilni o\u2018zgartirish',
    emailChangeNewBody: 'Yangi email manzilingizni tasdiqlash uchun quyidagi 6 xonali kodni kiriting:',
    emailChangeOldBody: 'Hisobingiz email manzili o\u2018zgartirilmoqda. Agar bu amalni SIZ bajargan bo\u2018lsangiz, quyidagi token bilan tasdiqlang:',
    emailChangeOldBtn: 'O\u2018zgartirishni tasdiqlash',
    emailChangeOldCancel: 'Bekor qilish',
    emailChangeNew: 'Yangi email',
    emailChangeOld: 'Eski email',
    emailChangeConfirm: 'Tasdiqlash kodi',
    emailChangedTitle: 'Email manzil o\u2018zgartirildi',
    emailChangedBody: 'Hisobingiz email manzili muvaffaqiyatli o\u2018zgartirildi.',

  },
  'uz-cyrl': {
    hello: 'Салом',
    verifyTitle: 'Электрон почтани тасдиқлаш коди',
    verifyBody: "Электрон почта манзилингизни тасдиқлаш учун қуйидаги 6 хонали кодни киритинг:",
    resetTitle: 'Паролни тиклаш',
    resetBody: "Паролингизни тиклаш учун қуйидаги тугмани босинг. Ҳаvolа 15 дақиқа амал қилади.",
    resetBtn: 'Паролни тиклаш',
    welcomeTitle: 'Хуш келибсиз',
    welcomeBody: "Edikit ҳисобингиз муваффақиятли яратилди. Тизимга киришингиз мумкин.",
    teacherApprovedTitle: "Ўқитувчи аризаси қабул қилинди",
    teacherApprovedBody: "Ўқитувчи аризангиз тасдиқланди. Энди дарсларни бошқаришингиз мумкин.",
    teacherApprovedCta: 'Биринчи тестингизни яратинг',
    teacherRejectedTitle: "Ўқитувчи аризаси рад этилди",
    teacherRejectedBody: "Ўқитувчи аризангиз рад этилди. Саволларингиз бўлса, администратор билан боғланинг.",
    inviteTitle: 'Синфларга таклиф',
    inviteBody: "Сиз Edikit платформасига таклиф қилиндингиз. Рўйхатдан ўтиш учун қуйидаги тугмани босинг. Ҳаvolа 7 кун амал қилади.",
    inviteBtn: 'Таклифни қабул қилиш',
    inviteGroup: 'Гуруҳ',
    welcomeBtn: 'Биринчи амалиётни бошланг',
    rejectedReason: 'Сабаб',
    securityPasswordTitle: 'Парол ўзгартирилди',
    securityPasswordBody: 'Ҳисобингиз пароли ўзгартирилди. Агар бу амални сиз бажармаган бўлсангиз, дарҳол паролни қайта ўзгартиринг ва администраторга мурожаат қилинг.',
    securityEmailTitle: 'Email манзили ўзгартирилди',
    securityEmailBody: 'Ҳисобингиз email манзили ўзгартирилди. Агар бу амални сиз бажармаган бўлсангиз, администраторга мурожаат қилинг.',
    securityNewDeviceTitle: 'Янги қурилмадан кириш',
    securityNewDeviceBody: 'Ҳисобингизга янги қурилмадан кириш қайд этилди. Агар бу сиз бўлсангиз, ҳеч нарса қилиш шарт эмас.',
    securitySuspiciousTitle: 'Шубҳали кириш аниқланди',
    securitySuspiciousBody: 'Ҳисобингизга шубҳали кириш аниқланди. Паролни ўзгартириб, икки босқичли ҳимояни ёқишни тавсия қиламиз.',
    securityDevice: 'Қурилма',
    securityCity: 'Шаҳар',
    securityTime: 'Вақт',
    securityAction: 'Хавфсизлик бўлимига ўтиш',
    breachTitle: 'Паролингиз хавфсизлик бузилишида топилди',
    breachBody: 'Сизнинг паролингиз маълум хавфсизлик бузилишида (breach) топилди. Хавфсизлигингиз учун паролни дарҳол ўзгартиринг.',
    breachBtn: 'Паролни ўзгартириш',
    footer: 'Бу хат автоматик юборилди. Илтимос, жавоб берманг.',
    ignore: "Агар сиз бу амални бажармаган бўлсангиз, хатни эътиборсиз қолдиринг.",
    codeLabel: 'Тасдиқлаш коди',    codeLabel: 'Тасдиқлаш коди',
    emailChangeTitle: 'Электрон почта манзилини ўзгартириш',
    emailChangeNewBody: 'Янги электрон почта манзилингизни тасдиқлаш учун қуйидаги 6 хонали кодни киритинг:',
    emailChangeOldBody: 'Ҳисобингиз электрон почта манзили ўзгартирилмоқда. Агар бу амални СИЗ бажарган бўлсангиз, қуйидаги токен билан тасдиқланг:',
    emailChangeOldBtn: 'Ўзгартиришни тасдиқлаш',
    emailChangeOldCancel: 'Бекор қилиш',
    emailChangeNew: 'Янги электрон почта',
    emailChangeOld: 'Эски электрон почта',
    emailChangeConfirm: 'Тасдиқлаш коди',
    emailChangedTitle: 'Электрон почта манзили ўзгартирилди',
    emailChangedBody: 'Ҳисобингиз электрон почта манзили муваффақиятли ўзгартирилди.',

  },
  ru: {
    hello: 'Здравствуйте',
    verifyTitle: 'Код подтверждения email',
    verifyBody: 'Введите 6-значный код ниже, чтобы подтвердить ваш email:',
    resetTitle: 'Сброс пароля',
    resetBody: 'Нажмите кнопку ниже, чтобы сбросить пароль. Ссылка действительна 15 минут.',
    resetBtn: 'Сбросить пароль',
    welcomeTitle: 'Добро пожаловать',
    welcomeBody: 'Ваш аккаунт Edikit успешно создан. Вы можете войти в систему.',
    teacherApprovedTitle: 'Заявка учителя одобрена',
    teacherApprovedBody: 'Ваша заявка учителя одобрена. Теперь вы можете управлять занятиями.',
    teacherApprovedCta: 'Создать первый тест',
    teacherRejectedTitle: 'Заявка учителя отклонена',
    teacherRejectedBody: 'Ваша заявка учителя отклонена. При вопросах обратитесь к администратору.',
    inviteTitle: 'Приглашение в классы',
    inviteBody: 'Вас пригласили на платформу Edikit. Нажмите кнопку ниже, чтобы зарегистрироваться. Ссылка действительна 7 дней.',
    inviteBtn: 'Принять приглашение',
    inviteGroup: 'Группа',
    welcomeBtn: 'Начать первую тренировку',
    rejectedReason: 'Причина',
    securityPasswordTitle: 'Пароль изменён',
    securityPasswordBody: 'Пароль вашего аккаунта был изменён. Если это сделали не вы, немедленно смените пароль и обратитесь к администратору.',
    securityEmailTitle: 'Email изменён',
    securityEmailBody: 'Email вашего аккаунта был изменён. Если это сделали не вы, обратитесь к администратору.',
    securityNewDeviceTitle: 'Вход с нового устройства',
    securityNewDeviceBody: 'Зафиксирован вход в ваш аккаунт с нового устройства. Если это были вы, ничего делать не нужно.',
    securitySuspiciousTitle: 'Обнаружен подозрительный вход',
    securitySuspiciousBody: 'Обнаружен подозрительный вход в ваш аккаунт. Рекомендуем сменить пароль и включить двухфакторную защиту.',
    securityDevice: 'Устройство',
    securityCity: 'Город',
    securityTime: 'Время',
    securityAction: 'Перейти в раздел безопасности',
    breachTitle: 'Ваш пароль найден в утечке данных',
    breachBody: 'Ваш пароль найден в известной утечке данных (breach). Для вашей безопасности немедленно смените пароль.',
    breachBtn: 'Сменить пароль',
    footer: 'Это письмо отправлено автоматически. Не отвечайте на него.',
    ignore: 'Если вы не выполняли это действие, проигнорируйте письмо.',
    codeLabel: 'Код подтверждения',    codeLabel: 'Код подтверждения',
    emailChangeTitle: 'Изменение email-адреса',
    emailChangeNewBody: 'Введите 6-значный код для подтверждения нового email-адреса:',
    emailChangeOldBody: 'Email-адрес вашего аккаунта меняется. Если это сделали ВЫ, подтвердите с помощью токена:',
    emailChangeOldBtn: 'Подтвердить изменение',
    emailChangeOldCancel: 'Отменить',
    emailChangeNew: 'Новый email',
    emailChangeOld: 'Старый email',
    emailChangeConfirm: 'Код подтверждения',
    emailChangedTitle: 'Email-адрес изменён',
    emailChangedBody: 'Email-адрес вашего аккаунта успешно изменён.',

  },
  en: {
    hello: 'Hello',
    verifyTitle: 'Email verification code',
    verifyBody: 'Enter the 6-digit code below to verify your email address:',
    resetTitle: 'Reset your password',
    resetBody: 'Click the button below to reset your password. The link is valid for 15 minutes.',
    resetBtn: 'Reset password',
    welcomeTitle: 'Welcome',
    welcomeBody: 'Your Edikit account has been created. You can now sign in.',
    teacherApprovedTitle: 'Teacher application approved',
    teacherApprovedBody: 'Your teacher application has been approved. You can now manage classes.',
    teacherApprovedCta: 'Create your first test',
    teacherRejectedTitle: 'Teacher application declined',
    teacherRejectedBody: 'Your teacher application was declined. Contact an administrator if you have questions.',
    inviteTitle: 'Class invitation',
    inviteBody: 'You have been invited to the Edikit platform. Click the button below to sign up. The link is valid for 7 days.',
    inviteBtn: 'Accept invitation',
    inviteGroup: 'Group',
    welcomeBtn: 'Start your first practice',
    rejectedReason: 'Reason',
    securityPasswordTitle: 'Password changed',
    securityPasswordBody: 'Your account password was changed. If you did not do this, change your password immediately and contact an administrator.',
    securityEmailTitle: 'Email changed',
    securityEmailBody: 'Your account email was changed. If you did not do this, contact an administrator.',
    securityNewDeviceTitle: 'New device sign-in',
    securityNewDeviceBody: 'A new device signed in to your account. If this was you, no action is needed.',
    securitySuspiciousTitle: 'Suspicious sign-in detected',
    securitySuspiciousBody: 'A suspicious sign-in to your account was detected. We recommend changing your password and enabling two-factor protection.',
    securityDevice: 'Device',
    securityCity: 'City',
    securityTime: 'Time',
    securityAction: 'Go to security settings',
    breachTitle: 'Your password was found in a data breach',
    breachBody: 'Your password was found in a known data breach. For your security, change your password immediately.',
    breachBtn: 'Change password',
    footer: 'This email was sent automatically. Please do not reply.',
    ignore: 'If you did not perform this action, you can safely ignore this email.',
    codeLabel: 'Verification code',    codeLabel: 'Verification code',
    emailChangeTitle: 'Change email address',
    emailChangeNewBody: 'Enter the 6-digit code to confirm your new email address:',
    emailChangeOldBody: 'Your account email is being changed. If YOU did this, confirm with the token below:',
    emailChangeOldBtn: 'Confirm change',
    emailChangeOldCancel: 'Cancel',
    emailChangeNew: 'New email',
    emailChangeOld: 'Old email',
    emailChangeConfirm: 'Verification code',
    emailChangedTitle: 'Email address changed',
    emailChangedBody: 'Your account email address has been changed successfully.',

  },
};

export const EMAIL_TEMPLATES = ['verify', 'reset', 'welcome', 'invite', 'teacher_approved', 'teacher_rejected', 'security', 'breach'];

/**
 * AUTH B-11 — Roster invite template (email yetkazish).
 * "Taklif: Fizika 2-guruh — [Havola]" — CTA havola, 7 kun amal qiladi.
 */
export function renderInvite({ inviteUrl, courseCode, groupCode, lang }) {
  const t = T[resolveTemplateLang(lang)];
  const groupLabel = groupCode ? `${t.inviteGroup}: ${esc(groupCode)}` : (courseCode ? esc(courseCode) : '');
  const preheader = t.inviteTitle;
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${t.inviteTitle}</h1>
     ${groupLabel ? `<p style="font-size:14px;color:#64748b;margin:0 0 12px">${groupLabel}</p>` : ''}
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 4px">${t.inviteBody}</p>`,
    { href: esc(inviteUrl), label: t.inviteBtn },
  );
  const text = `${t.hello}!\n\n${t.inviteTitle}${groupLabel ? `\n${groupLabel}` : ''}\n\n${t.inviteBody}\n\n${t.inviteBtn}: ${inviteUrl}\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${t.inviteTitle}${groupCode ? ` — ${esc(groupCode)}` : ''}`, html, text, preheader };
}

/**
 * AUTH A-23 review fix: HTML/header injection himoyasi.
 * Foydalanuvchi kiritgan qiymatlar (username, resetUrl) hech qachon
 * raw interpolatsiya qilinmaydi — avval escapelanadi.
 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/[\r\n]+/g, ' '); // header/body injection'ga qarshi
}

/** Tilni normalize qiladi (noma'lum → default). */
export function resolveTemplateLang(lang) {
  return AUTH_LANGS.includes(lang) ? lang : DEFAULT_AUTH_LANG;
}

function layout(t, preheader, innerHtml, ctaHtml) {
  const cta = ctaHtml
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="border-radius:8px;background:#1d4ed8;padding:0"><a href="${ctaHtml.href}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:8px">${ctaHtml.label}</a></td></tr></table>`
    : '';
  return `<!DOCTYPE html>
<html lang="${t === 'uz-cyrl' ? 'uz' : t}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${preheader}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<div style="display:none;max-height:0;overflow:hidden">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 16px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <tr><td style="padding:28px 32px 8px">
      <div style="font-size:18px;font-weight:700;color:#0f172a">${BRAND}</div>
    </td></tr>
    <tr><td style="padding:8px 32px 20px">
      ${innerHtml}
      ${cta}
      <p style="font-size:13px;color:#64748b;line-height:1.5;margin:16px 0 4px">${t.footer}</p>
      <p style="font-size:13px;color:#94a3b8;line-height:1.5;margin:4px 0 0">${t.ignore}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** 6-kodli verify template. */
export function renderVerify({ code, lang }) {
  const t = T[resolveTemplateLang(lang)];
  const preheader = `${t.verifyTitle}: ${code}`;
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${t.verifyTitle}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px">${t.verifyBody}</p>
     <p style="font-size:14px;color:#64748b;margin:0 0 8px">${t.codeLabel}:</p>
     <div style="font-size:30px;font-weight:700;letter-spacing:6px;color:#1d4ed8;padding:10px 16px;background:#eff6ff;border-radius:8px;display:inline-block">${code}</div>`,
    null,
  );
  const text = `${t.hello}!\n\n${t.verifyTitle}\n\n${t.verifyBody}\n\n${t.codeLabel}: ${code}\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${t.verifyTitle} — ${BRAND}`, html, text, preheader };
}

/** AUTH B-24: Email change — yangi email (code) yoki eski email (token) xabari. */
export function renderEmailChange({ code, kind = 'new', newEmailMasked, lang }) {
  const t = T[resolveTemplateLang(lang)];
  const isNew = kind === 'new';
  const title = t.emailChangeTitle;
  const body = isNew ? t.emailChangeNewBody : t.emailChangeOldBody;
  const preheader = `${title}: ${isNew ? t.emailChangeNew : t.emailChangeOld}`;
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${title}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 12px">${body}</p>
     ${newEmailMasked ? `<p style="font-size:14px;color:#64748b;margin:0 0 8px">${t.emailChangeNew}: <strong>${esc(newEmailMasked)}</strong></p>` : ''}
     <p style="font-size:14px;color:#64748b;margin:0 0 8px">${isNew ? t.codeLabel : t.emailChangeConfirm}:</p>
     <div style="font-size:24px;font-weight:700;letter-spacing:3px;color:#1d4ed8;padding:10px 16px;background:#eff6ff;border-radius:8px;display:inline-block;word-break:break-all">${isNew ? code : esc(code)}</div>`,
    null,
  );
  const text = `${t.hello}!\n\n${title}\n\n${body}\n\n${isNew ? t.codeLabel : t.emailChangeConfirm}: ${code}\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${title} — ${BRAND}`, html, text, preheader };
}

/** AUTH B-24: Email o'zgartirilgani haqida eski email'ga xabar. */
export function renderEmailChanged({ lang }) {
  const t = T[resolveTemplateLang(lang)];
  const title = t.emailChangedTitle;
  const html = layout(
    t,
    title,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${title}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 12px">${t.emailChangedBody}</p>`,
    null,
  );
  const text = `${t.hello}!\n\n${title}\n\n${t.emailChangedBody}\n\n${t.footer}`;
  return { subject: `${title} — ${BRAND}`, html, text, preheader: title };
}

/** Reset token havolali template. */
export function renderReset({ resetUrl, lang }) {
  const t = T[resolveTemplateLang(lang)];
  const preheader = t.resetTitle;
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${t.resetTitle}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 4px">${t.resetBody}</p>`,
    { href: esc(resetUrl), label: t.resetBtn },
  );
  const text = `${t.hello}!\n\n${t.resetTitle}\n\n${t.resetBody}\n\n${t.resetBtn}: ${resetUrl}\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${t.resetTitle} — ${BRAND}`, html, text, preheader };
}

/** Welcome (register muvaffaqiyat) — B-20: CTA “Birinchi amaliyotni boshlang”. */
export function renderWelcome({ username, lang }) {
  const t = T[resolveTemplateLang(lang)];
  const preheader = t.welcomeTitle;
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${t.welcomeTitle}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 4px">${t.welcomeBody}</p>`,
    { href: 'https://edikit.uz/user/onboarding', label: t.welcomeBtn },
  );
  const text = `${t.hello}${username ? `, ${esc(username)}` : ''}!\n\n${t.welcomeTitle}\n\n${t.welcomeBody}\n\n${t.welcomeBtn}: https://edikit.uz/user/onboarding\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${t.welcomeTitle} — ${BRAND}`, html, text, preheader };
}

/** Teacher tasdiqlandi. */
export function renderTeacherApproved({ username, lang }) {
  const t = T[resolveTemplateLang(lang)];
  const preheader = t.teacherApprovedTitle;
  const base = process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const teacherUrl = `${base.replace(/\/$/, '')}/teacher`;
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${t.teacherApprovedTitle}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 4px">${t.teacherApprovedBody}</p>`,
    { href: teacherUrl, label: t.teacherApprovedCta || t.panelBtn || 'Open' },
  );
  const text = `${t.hello}${username ? `, ${esc(username)}` : ''}!\n\n${t.teacherApprovedTitle}\n\n${t.teacherApprovedBody}\n\n${t.teacherApprovedCta || 'Open'}: ${teacherUrl}\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${t.teacherApprovedTitle} — ${BRAND}`, html, text, preheader };
}

/** Teacher rad etildi — B-20: sabab (reason) ko‘rsatiladi. */
export function renderTeacherRejected({ username, lang, reason }) {
  const t = T[resolveTemplateLang(lang)];
  const preheader = t.teacherRejectedTitle;
  const reasonBlock = reason
    ? `<p style="font-size:14px;line-height:1.6;color:#b45309;background:#fffbeb;border-radius:8px;padding:10px 14px;margin:12px 0 0">${t.rejectedReason}: ${esc(reason)}</p>`
    : '';
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${t.teacherRejectedTitle}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0">${t.teacherRejectedBody}</p>
     ${reasonBlock}`,
    null,
  );
  const text = `${t.hello}${username ? `, ${esc(username)}` : ''}!\n\n${t.teacherRejectedTitle}\n\n${t.teacherRejectedBody}${reason ? `\n\n${t.rejectedReason}: ${esc(reason)}` : ''}\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${t.teacherRejectedTitle} — ${BRAND}`, html, text, preheader };
}

/**
 * AUTH B-20 — Security template (4 variant):
 *   password_changed | email_changed | new_device | suspicious
 * Ma‘lumot: vaqt, qurilma, shahar (agregat — raw IP/UA hech qachon).
 * @param {{type?: string, username?: string, device?: string, browser?: string,
 *          city?: string, time?: string, lang?: string}} params
 */
export function renderSecurity({ type = 'new_device', username, device, browser, city, time, lang }) {
  const t = T[resolveTemplateLang(lang)];
  const key = ['password_changed', 'email_changed', 'suspicious'].includes(type) ? type : 'new_device';
  const titleKey = {
    password_changed: 'securityPasswordTitle',
    email_changed: 'securityEmailTitle',
    new_device: 'securityNewDeviceTitle',
    suspicious: 'securitySuspiciousTitle',
  }[key];
  const bodyKey = {
    password_changed: 'securityPasswordBody',
    email_changed: 'securityEmailBody',
    new_device: 'securityNewDeviceBody',
    suspicious: 'securitySuspiciousBody',
  }[key];
  const title = t[titleKey];
  const details = [
    device || browser ? `${t.securityDevice}: ${[device, browser].filter(Boolean).join(' / ')}` : '',
    city ? `${t.securityCity}: ${city}` : '',
    time ? `${t.securityTime}: ${time}` : '',
  ].filter(Boolean).map((l) => `<p style="font-size:14px;color:#334155;margin:4px 0">${esc(l)}</p>`).join('');
  const preheader = title;
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${title}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 12px">${t[bodyKey]}</p>
     ${details}`,
    { href: 'https://edikit.uz/user/panel#security', label: t.securityAction },
  );
  const textDetails = [
    device || browser ? `${t.securityDevice}: ${esc([device, browser].filter(Boolean).join(' / '))}` : '',
    city ? `${t.securityCity}: ${esc(city)}` : '',
    time ? `${t.securityTime}: ${esc(time)}` : '',
  ].filter(Boolean).join('\n');
  const text = `${t.hello}${username ? `, ${esc(username)}` : ''}!\n\n${title}\n\n${t[bodyKey]}${textDetails ? `\n\n${textDetails}` : ''}\n\n${t.securityAction}: https://edikit.uz/user/panel#security\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${title} — ${BRAND}`, html, text, preheader };
}

/** AUTH B-20 — Breach template (P1): parol breach'da topildi. */
export function renderBreach({ username, lang }) {
  const t = T[resolveTemplateLang(lang)];
  const preheader = t.breachTitle;
  const html = layout(
    t,
    preheader,
    `<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a">${t.breachTitle}</h1>
     <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 4px">${t.breachBody}</p>`,
    { href: 'https://edikit.uz/user/panel#security', label: t.breachBtn },
  );
  const text = `${t.hello}${username ? `, ${esc(username)}` : ''}!\n\n${t.breachTitle}\n\n${t.breachBody}\n\n${t.breachBtn}: https://edikit.uz/user/panel#security\n\n${t.ignore}\n${t.footer}`;
  return { subject: `${t.breachTitle} — ${BRAND}`, html, text, preheader };
}

export function renderTemplate(name, data) {
  switch (name) {
    case 'verify': return renderVerify(data);
    case 'reset': return renderReset(data);
    case 'welcome': return renderWelcome(data);
    case 'teacher_approved': return renderTeacherApproved(data);
    case 'teacher_rejected': return renderTeacherRejected(data);
    case 'invite': return renderInvite(data);
    case 'security': return renderSecurity(data);
    case 'breach': return renderBreach(data);
    default: throw new Error(`unknown template: ${name}`);
  }
}

// ── SPAM-trigger skaner (A-23 §14 + §22 e2e) ──

const SPAM_PATTERNS = [
  /\bFREE\b/i,
  /\bURGENT\b/i,
  /\bACT NOW\b/i,
  /\bCLICK HERE\b/i,
  /\b100%\b/,
  /\$\d/,
  /!!!+/,
  /\bWINNER\b/i,
  /\bGUARANTEE\b/i,
];

/**
 * Template spam-trigger'ga qarshi tekshiradi (test'da ham ishlatiladi).
 * @returns {{ok: boolean, triggers: string[]}}
 */
export function scanSpamTriggers({ subject, html, text }) {
  const haystack = `${subject || ''} ${html || ''} ${text || ''}`;
  const triggers = SPAM_PATTERNS.filter((re) => re.test(haystack)).map((re) => re.source);
  return { ok: triggers.length === 0, triggers };
}
