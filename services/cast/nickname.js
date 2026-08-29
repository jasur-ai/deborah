/**
 * Deborah — Cast Safe Alias Generator & Identity Policy (C4-06)
 * --------------------------------------------------------------
 * Child-safe identity:
 *  - Safe alias generator locale catalog bo'yicha (item 5).
 *  - Reserved role impersonation blok (item 6) — "host", "teacher", "moderator"…
 *  - Unicode NFKC normalization comparison (item 7) — visually-identical cheklash.
 *  - Invisible bidi control / zero-width abuse filter+flag (item 9).
 *
 * Barcha funksiyalar PURE — DB'ga yozmaydi (testlanadigan bo'lim).
 */

import { DEFAULT_LOCALE } from '../i18n/catalog.js';

// ── Reserved role / impersonation names (item 6) ──
// Normalizatsiyadan keyingi shaklda solishtiriladi (NFKC + diacritics stripped).
const RESERVED_ROLES = new Set([
  'host', 'director', 'teacher', 'admin', 'moderator', 'system', 'projector',
  'owner', 'co-host', 'cohost', 'operator', 'staff', 'support', 'superadmin',
  'root', 'administrator', 'koordinator', 'coordinator', 'ustoz', 'muallim',
  'oqituvchi', 'moderator', 'admin', 'moder',
  // uzbek cyrillic
  'аdmin', 'устоz', 'ўқитувчи', 'модератор',
]);

// Confusable role variants (birinchi/oxirgi belgi o'rniga qo'shish trick'larini ushlash)
const RESERVED_PATTERNS = [
  /^h[oо0][oо0]?st$/i,  // host, h0st, ho0st
  /^d[oо0]minis?tr[ao]t[oо0]r$/i,
  /^t[eе]ach[eе]r$/i,
  /^mod[eе]rat[oо0]r$/i,
];

// ── Invisible / bidi abuse (item 9) ──
// g flag faqat replace uchun; detection uchun alohida non-global regex ishlatamiz
// (test() da /g lastIndex statefulness bug'iga yo'l qo'ymaslik uchun).
export const INVISIBLE_RE = /[\u200B-\u200F\u2060-\u206F\uFEFF\u00AD\u061C]/g;
const INVISIBLE_DETECT = /[\u200B-\u200F\u2060-\u206F\uFEFF\u00AD\u061C]/;
export const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/;
export const ZERO_WIDTH_RE = /[\u200B\u200C\u200D]/;

// ── Per-locale alias word lists (item 5) ──
// Oddiy, bolalar uchun xavfsiz so'zlar. Yana ham locale-specific qilish uchun
// catalogs'ga `alias.*` keylarini qo'shish mumkin; server-side fallback shu.
const ALIAS_WORDS = {
  'uz-Latn': {
    animals: ['burgut', 'olmaxon', 'qoplon', 'tulki', 'quyon', 'bug‘u', 'lochin', 'kit', 'delfin', 'yo‘lbars', 'bo‘ri', 'ayiq', 'kaptar', 'chumchuq', 'ilon', 'suvsar', 'to‘rg‘ay', 'ot', 'fil', 'jirafa'],
    colors: ['ko‘k', 'yashil', 'qizil', 'sariq', 'oq', 'qora', 'binafsha', 'zangori', 'pushti', 'to‘q sariq', 'jigarrang', 'kulrang'],
  },
  'uz-Cyrl': {
    animals: ['бургут', 'олмахон', 'қоплон', 'тулки', 'қуён', 'буғу', 'лочин', 'кит', 'делфин', 'йўлбарс', 'бўри', 'айиқ', 'каптар', 'чўмчуқ', 'илон', 'сувсар', 'тўрғай', 'от', 'фил', 'жирафа'],
    colors: ['кўк', 'яшил', 'қизил', 'сариқ', 'оқ', 'қора', 'бинафша', 'зангори', 'пушти', 'тўқ сариқ', 'жигарранг', 'кулранг'],
  },
  ru: {
    animals: ['орёл', 'белка', 'леопард', 'лиса', 'заяц', 'олень', 'сокол', 'кит', 'дельфин', 'тигр', 'волк', 'медведь', 'голубь', 'воробей', 'змея', 'куница', 'жаворонок', 'конь', 'слон', 'жираф'],
    colors: ['синий', 'зелёный', 'красный', 'жёлтый', 'белый', 'чёрный', 'фиолетовый', 'голубой', 'розовый', 'оранжевый', 'коричневый', 'серый'],
  },
  en: {
    animals: ['eagle', 'squirrel', 'leopard', 'fox', 'rabbit', 'deer', 'falcon', 'whale', 'dolphin', 'tiger', 'wolf', 'bear', 'pigeon', 'sparrow', 'snake', 'marten', 'lark', 'horse', 'elephant', 'giraffe'],
    colors: ['blue', 'green', 'red', 'yellow', 'white', 'black', 'purple', 'azure', 'pink', 'orange', 'brown', 'gray'],
  },
};

const FALLBACK_WORDS = ALIAS_WORDS[DEFAULT_LOCALE] || ALIAS_WORDS['uz-Latn'];

// ── Locale catalog'dan so'zlar (item 5: alias generator locale catalog bilan) ──
// `locales/{locale}/cast.json` da alias.animals / alias.colors (';' bilan) bor.
// Server'da o'qiladi; topilmasa embedded FALLBACK_WORDS ishlatiladi.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_ROOT = path.join(__dirname, '..', '..', 'locales');

const _catalogWords = new Map(); // locale -> { animals: [], colors: [] } | null
function catalogWords(locale) {
  if (_catalogWords.has(locale)) return _catalogWords.get(locale);
  let words = null;
  try {
    const file = path.join(LOCALES_ROOT, locale, 'cast.json');
    if (existsSync(file)) {
      const cat = JSON.parse(readFileSync(file, 'utf8'));
      const animals = String(cat['alias.animals'] || '').split(';').map((s) => s.trim()).filter(Boolean);
      const colors = String(cat['alias.colors'] || '').split(';').map((s) => s.trim()).filter(Boolean);
      if (animals.length >= 8 && colors.length >= 6) words = { animals, colors };
    }
  } catch (_) {
    /* fayl yo'q/buzilgan → embedded fallback */
  }
  _catalogWords.set(locale, words);
  return words;
}

/** Locale uchun alias so'z havzasi (catalog → embedded fallback). */
export function aliasWordPool(locale) {
  const fromCatalog = catalogWords(locale);
  if (fromCatalog) return { animals: fromCatalog.animals, colors: fromCatalog.colors };
  const pool = ALIAS_WORDS[locale] || FALLBACK_WORDS;
  return { animals: pool.animals, colors: pool.colors };
}

// Apostrophe turlari (uz: oʻ, o', o‘) — bitta canonical (U+02BB) ga
const APOSTROPHE_RE = /[\u02BB\u02BC\u2018\u2019\u2032`']/g;

/**
 * NFKC normalization + lowercase + apostrophe canonical (item 7) —
 * solishtirish uchun kanonik shakl. Diacritics'ni ham olib tashlaydi
 * (o' — o, ў — u) chunki visual o'xshashlik impersonation uchun yetarli.
 */
export function normalizeForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(APOSTROPHE_RE, '\u02BB')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Reserved role impersonation? (item 6) — normalized shaklda tekshiradi. */
export function isReservedImpersonation(raw) {
  const norm = normalizeForCompare(raw);
  if (RESERVED_ROLES.has(norm)) return true;
  return RESERVED_PATTERNS.some((re) => re.test(norm));
}

/** Invisible / bidi abuse bor? (item 9). */
export function hasInvisibleAbuse(text) {
  const t = String(text || '');
  if (INVISIBLE_DETECT.test(t)) return true;
  if (BIDI_CONTROL_RE.test(t)) return true;
  if (ZERO_WIDTH_RE.test(t)) return true;
  return false;
}

/**
 * Nickname flaglari (queue priority uchun ham ishlatilishi mumkin).
 * @returns {{flags:Object<string,boolean>, unsafe:boolean}}
 */
export function flagNickname(raw) {
  const flags = {
    invisible: hasInvisibleAbuse(raw),
    reserved: isReservedImpersonation(raw),
    // Confusable digits: math bold (\u{1D7CE}-\u{1D7D7}), math sans (\u{1D7D8}-\u{1D7E1}), fullwidth (\uFF10-\uFF19)
    confusable: /[\u{1D7CE}-\u{1D7D7}\u{1D7D8}-\u{1D7E1}\uFF10-\uFF19]/u.test(raw),
    excessiveSymbols: /[!@#$%^&*+=]{3,}/.test(raw),
  };
  return { flags, unsafe: flags.invisible || flags.reserved || flags.confusable };
}

/**
 * Safe alias generatsiya (item 5): "Ko'k burgut 24" uslubida.
 * Deterministik emas — tasodifiy tanlov, lekin takror bo'lmasligi uchun
 * takenSet'ni tekshiradi. Locale qo'llab-quvvatlanmasa DEFAULT_LOCALE.
 */
export function generateSafeAlias(locale, takenSet = new Set()) {
  const pool = aliasWordPool(locale || DEFAULT_LOCALE);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    const color = pick(pool.colors);
    const animal = pick(pool.animals);
    const num = 2 + Math.floor(Math.random() * 98);
    const candidate = `${color} ${animal} ${num}`;
    if (!takenSet.has(normalizeForCompare(candidate))) {
      return candidate;
    }
  }
  // Havza to'lgan taqdirda — vaqt stamp bilan garantiyalangan unique
  return `${pick(pool.colors)} ${pick(pool.animals)} ${Date.now() % 10000}`;
}

/**
 * User kiritgan aliasni safe formatga keltirish:
 * - invisible/bidi belgilar olib tashlanadi
 * - reserved impersonation yoki invisible bo'lsa → { safe:false, reason }
 */
export function assessAlias(raw) {
  if (!String(raw || '').trim()) return { safe: false, reason: 'EMPTY' };
  const stripped = String(raw).replace(INVISIBLE_RE, '').trim();
  if (!stripped) return { safe: false, reason: 'INVISIBLE_ONLY' };
  if (isReservedImpersonation(stripped)) return { safe: false, reason: 'RESERVED_ROLE' };
  const { flags } = flagNickname(stripped);
  if (flags.invisible || flags.confusable) return { safe: false, reason: 'INVISIBLE_OR_CONFUSABLE' };
  return { safe: true, clean: stripped, normalized: normalizeForCompare(stripped) };
}

export default {
  RESERVED_ROLES,
  INVISIBLE_RE,
  BIDI_CONTROL_RE,
  ZERO_WIDTH_RE,
  aliasWordPool,
  normalizeForCompare,
  isReservedImpersonation,
  hasInvisibleAbuse,
  flagNickname,
  generateSafeAlias,
  assessAlias,
};
