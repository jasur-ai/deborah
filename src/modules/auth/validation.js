/**
 * Edikit — Auth validation schemas (AUTH A-04)
 * -------------------------------------------------------------------
 * Zod asosidagi login/register validatsiyasi — routes/auth.js'da ishlatiladi.
 *
 * Qoidalar:
 *   - login: username non-empty + format; parol faqat non-empty (legacy
 *     qisqa parolli user'lar login'da bloklanmaydi — rehash A-05'da).
 *   - register: username [a-zA-Z0-9_.-]{2,50} (B-04); parol min 8 + harf + raqam
 *     (plan_login §3.1 — Zod min(8)).
 *
 * parse*() helper'lar xato holatida i18n error key qaytaradi — routes
 * copy.errors[key] orqali 4 tilda xabar render qiladi.
 */
import { z } from 'zod';
// AUTH B-04: username normalizatsiya + rezerv/confusable tekshiruvi
import { normalizeUsername, isReserved, isConfusableReserved } from './username.js';
// AUTH D-24 §10: consent checkbox tekshiruvi (qonuniy talab)
import { isConsentGiven } from '../legal/consent.js';

// ── Schema'lar ──
// Error message'lar i18n error key'lar (string) — Zod shularni issue.message
// qilib qo'yadi, firstErrorKey ularni to'g'ridan-to'g'ri qaytaradi.
export const loginSchema = z.object({
  // AUTH B-04: login ham `.`/`-` qabul qiladi (register'da ruxsat etilgan),
  // max 50 — register max bilan izchil (aks holda 45-belgili user kira olmaydi).
  // Legacy username'lar uchun min 1 (bo'sh → required); format faqat belgi xatosi.
  username: z
    .string()
    .trim()
    .min(1, 'required')
    .max(100, 'usernameChars')
    // AUTH B-09 §06: account username YOKI email — duplicate flow login
    // maydonini email bilan prefill qiladi; '@' va '+ (plus-addressing,
    // Gmail/Google user+tag@gmail.com) shu sababli qabul qilinadi.
    .regex(/^[a-zA-Z0-9_.@+-]+$/, 'usernameChars'),
  // AUTH A-22: login'da eski (legacy) uzun parollar bo'lishi mumkin — 200 qoldiramiz
  password: z
    .string()
    .min(1, 'required')
    .max(200, 'passwordMax'),
});

export const registerSchema = z.object({
  // AUTH B-04 (OWASP): 2–50, `^[a-zA-Z0-9_.-]+$` — login identifier.
  // Kirill/emoji/space format orqali rad etiladi; rezerv/confusable
  // parseRegister'da (normalizatsiyadan keyin) tekshiriladi.
  username: z
    .string()
    .trim()
    .min(2, 'usernameChars')
    .max(50, 'usernameChars')
    .regex(/^[a-zA-Z0-9_.-]{2,50}$/, 'usernameChars'),
  // AUTH A-18 §07: email (parol tiklash uchun asos).
  // Schema'da optional — invite accept (roster'dan kelgan, tashqi manba tasdiqlagan)
  // email'siz ham ishlaydi; odatiy register route'ida parseRegister emailRequired=true.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'emailInvalid')
    .max(120, 'emailInvalid')
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'emailInvalid')
    .optional(),
  // AUTH A-22 (NIST SP 800-63B): complexity talablari YO'Q (SHALL NOT).
  // Min uzunlik dynamic — password-policy.evaluatePassword() da (8 MFA / 15 oddiy).
  // Max 128 — OWASP ASVS bilan yagona manba (password-policy.POLICY_MAX_LENGTH).
  password: z.string().min(1, 'required').max(128, 'passwordMax'),
  // AUTH A-21: honeypot — bot'lar ko'rinmas maydonni to'ldiradi, odamlar yo'q.
  // Schema'da oddiy string; route honeypot to'ldirilganini sezsa user yaratmaydi
  // (silent — bot o'zini muvaffaqiyatli his qiladi, rate bucket'iga ham tegmaydi).
  website: z.string().max(100).optional(),
  // AUTH B-03: ism (2-100, ixtiyoriy) — B-01 users schema'dagi `name`.
  // B-33 (RELEASE) fix pattern: brauzer HAR DOIM bo'sh string yuboradi —
  // `.optional()` bo'sh stringni o'tkazmaydi (too_small → 'required') va
  // student register'i buziladi (supertest maydonlarni yubormagani uchun
  // testlar yashirgan). Bo'sh string → undefined (D-14 e2e topilmasi).
  name: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().min(2, 'nameShort').max(100, 'nameLong').optional()),
  // AUTH B-03: invite kod (ixtiyoriy) — B-01 `invite_code` (B-12 to'liq accept).
  invite: z.string().trim().max(48, 'inviteInvalid').optional(),
  // AUTH D-24 §10: consent checkbox — majburiy (qonuniy talab, UZ shaxsiy
  // ma'lumotlar qonuni). Brauzer 'on'/'true'/true yuboradi; bo'sh string ham
  // kelishi mumkin — parseRegister'da isConsentGiven() orqali tekshiriladi.
  consent: z.union([z.boolean(), z.string()]).optional(),
  // AUTH B-29: teacher application forma (role=teacher bo'lganda majburiy qismi).
  // B-29 §07: university ro'yxatdan (A-13 ochiq data) — 200 belgi; subject 100;
  // experience 0-50 yil; reason 500 belgi. Route'da wantsTeacher bo'lsa tekshiriladi.
  // B-33 (RELEASE) fix: brauzer HAR DOIM barcha forma maydonlarini bo'sh string
  // sifatida yuboradi — `.optional()` bo'sh stringni o'tkazmaydi (too_small →
  // 'required') va student register'i butunlay buzilardi (supertest maydonlarni
  // yubormagani uchun testlar yashirgan). Bo'sh string → undefined (preprocess).
  university: z
    .preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().min(1, 'universityRequired').max(200, 'universityMax').optional()),
  subject: z
    .preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().min(1, 'subjectRequired').max(100, 'subjectMax').optional()),
  experience: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d{1,2}$/.test(v) && Number(v) >= 0 && Number(v) <= 50), 'experienceRange')
    .optional(),
  reason: z.string().trim().max(500, 'reasonMax').optional(),
});

// AUTH A-06: parol tiklash — forgot (request) + reset (complete) schema'lar
// Guide A-06 §17: resetRequestSchema, newPasswordSchema (token 48, parol min 8 regex).

export const resetRequestSchema = z.object({
  // Akkaunt nomi yoki email (email ham username ham safeKey'ga normalizatsiya qilinadi)
  account: z.string().trim().min(1, 'required').max(80, 'usernameChars'),
});

export const resetCompleteSchema = z.object({
  // Token 48 bayt random hex → 96 belgi (guide §6: crypto.randomBytes(48))
  token: z.string().trim().min(48, 'tokenInvalid').max(128, 'tokenInvalid'),
  // AUTH A-22: reset'da ham complexity yo'q — password-policy.evaluatePassword()
  password: z.string().min(1, 'required').max(128, 'passwordMax'),
});

/** Bizning error key'lar ro'yxati (copy.errors'ga mos). */
const ERROR_KEYS = new Set(['required', 'usernameChars', 'usernameReserved', 'usernameConfusable', 'emailInvalid', 'passwordMin', 'passwordWeak', 'passwordMax', 'tokenInvalid', 'nameShort', 'nameLong', 'inviteInvalid', 'consentRequired']);

/** Zod issue'dan i18n error key olish. */
function firstErrorKey(result) {
  const issue = result.error?.issues?.[0];
  if (!issue) return 'required';
  if (typeof issue.message === 'string' && ERROR_KEYS.has(issue.message)) return issue.message;
  // invalid_type (maydon yo'q) yoki boshqa holatlar
  if (issue.code === 'invalid_type' || issue.code === 'too_small') return 'required';
  return 'required';
}

/**
 * Login kiritmasini tekshiradi.
 * @returns {{ ok: true, username: string, password: string } | { ok: false, errorKey: string }}
 */
export function parseLogin(input = {}) {
  // B-04 (review fix): NFKC normalizatsiya schema'dan OLDIN — full-width login
  // ('ｓｍｉｔｈ') ham ishlaydi; regex canonical formni tekshiradi.
  const normalized = { ...input, username: normalizeUsername(input.username) };
  const result = loginSchema.safeParse(normalized);
  if (!result.success) return { ok: false, errorKey: firstErrorKey(result) };
  return { ok: true, username: result.data.username, password: result.data.password };
}

/**
 * Register kiritmasini tekshiradi.
 * @returns {{ ok: true, username: string, email: string, password: string } | { ok: false, errorKey: string }}
 */
export function parseRegister(input = {}, opts = {}) {
  const { emailRequired = true, consentRequired = true } = opts;
  // B-04 (review fix): username normalizatsiya schema'dan OLDIN — full-width
  // 'ａｄｍｉｎ' → 'admin' → usernameReserved (usernameChars emas) chiqadi.
  const normalized = { ...input, username: normalizeUsername(input.username) };
  const result = registerSchema.safeParse(normalized);
  if (!result.success) return { ok: false, errorKey: firstErrorKey(result) };
  // AUTH A-21: honeypot to'ldirilgan bo'lsa — bot ehtimoli; route silent skip qiladi.
  if (result.data.website && String(result.data.website).trim().length > 0) {
    return { ok: false, honeypot: true };
  }
  // AUTH B-04: canonical normalizatsiya (NFKC + trim + lowercase) + rezerv
  // so'zlar va leet/confusable blok. "Smith" → 'smith' saqlanadi.
  const username = normalizeUsername(result.data.username);
  if (isReserved(username)) return { ok: false, errorKey: 'usernameReserved' };
  if (isConfusableReserved(username)) return { ok: false, errorKey: 'usernameConfusable' };
  // A-18: odatiy register email talab qiladi (parol tiklash asosi).
  // Invite accept emailRequired:false — invite.email'dan keladi yoki yo'q bo'lishi mumkin.
  if (emailRequired && !result.data.email) return { ok: false, errorKey: 'emailInvalid' };
  // AUTH B-03: invite format — faqat xavfsiz belgilar (B-12 to'liq tekshiradi).
  const invite = result.data.invite || '';
  const inviteCode = invite ? (/^[A-Za-z0-9-]{6,48}$/.test(invite) ? invite : null) : null;
  if (invite && !inviteCode) return { ok: false, errorKey: 'inviteInvalid' };
  // AUTH D-24 §10: rozilik majburiy (checkbox) — qonuniy talab.
  // isConsentGiven: true / 'true' / 'on' / '1' qabul qiladi (brauzer varianti).
  if (consentRequired && !isConsentGiven(result.data.consent)) {
    return { ok: false, errorKey: 'consentRequired' };
  }
  return {
    ok: true,
    username,
    email: result.data.email || '',
    name: result.data.name || '',
    invite: inviteCode || undefined,
    consent: isConsentGiven(result.data.consent),
    password: result.data.password,
    // AUTH B-29: teacher application forma (route wantsTeacher bo'lsa ishlatadi)
    university: result.data.university || '',
    subject: result.data.subject || '',
    experience: result.data.experience || '',
    reason: result.data.reason || '',
  };
}

/**
 * Parol tiklash so'rovini tekshiradi (AUTH A-06).
 * @returns {{ ok: true, account: string } | { ok: false, errorKey: string }}
 */
export function parseResetRequest(input = {}) {
  const result = resetRequestSchema.safeParse(input);
  if (!result.success) return { ok: false, errorKey: firstErrorKey(result) };
  return { ok: true, account: result.data.account };
}

/**
 * Parol tiklash complete (token + yangi parol) tekshiradi (AUTH A-06).
 * @returns {{ ok: true, token: string, password: string } | { ok: false, errorKey: string }}
 */
export function parseResetComplete(input = {}) {
  const result = resetCompleteSchema.safeParse(input);
  if (!result.success) return { ok: false, errorKey: firstErrorKey(result) };
  return { ok: true, token: result.data.token, password: result.data.password };
}
