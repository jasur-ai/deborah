/**
 * Cast C4-05 — Internationalization core
 * --------------------------------------
 * BCP-47 locale registry, fallback chain (requested → base → uz-Latn),
 * ICU-style plural/select, Intl formatters, missing-key telemetry (PII-siz),
 * pseudo-locale va bidi/apostrophe normalization.
 *
 * Pure logic — unit testlar shu faylni test qiladi (DOM'siz).
 */

// ── BCP-47 canonical locale registry (item 3) ──
export const LOCALES = {
  'uz-Latn': { name: "O'zbekcha (Lotin)", base: null, rtl: false },
  'uz-Cyrl': { name: 'Ўзбекча (Кирил)', base: 'uz-Latn', rtl: false },
  ru: { name: 'Русский', base: 'uz-Latn', rtl: false },
  en: { name: 'English', base: 'uz-Latn', rtl: false },
  ar: { name: 'العربية', base: 'en', rtl: true },
  'fa-IR': { name: 'فارسی', base: 'en', rtl: true },
};

export const DEFAULT_LOCALE = 'uz-Latn';
export const RTL_LOCALES = new Set(Object.keys(LOCALES).filter((l) => LOCALES[l].rtl));

/**
 * BCP-47 canonical: 'uz-latn' → 'uz-Latn', 'uz_Latn' → 'uz-Latn', 'en-US' → 'en'.
 * Tanimagan → null.
 */
export function canonicalLocale(input) {
  if (!input) return null;
  const s = String(input).trim().replace(/_/g, '-');
  if (LOCALES[s]) return s;
  // case-insensitive match
  const lower = s.toLowerCase();
  const hit = Object.keys(LOCALES).find((k) => k.toLowerCase() === lower);
  if (hit) return hit;
  // base: 'uz' → uz-Latn (uz-Cyrl'ga emas)
  const base = s.split('-')[0].toLowerCase();
  if (base === 'uz') return 'uz-Latn';
  return null;
}

/**
 * Fallback chain (item 20): requested → base → uz-Latn.
 * @returns {string[]} locale ketma-ketligi (requested birinchi)
 */
export function localeChain(input) {
  const canonical = canonicalLocale(input);
  if (!canonical) return [DEFAULT_LOCALE];
  const chain = [];
  let cur = canonical;
  while (cur) {
    chain.push(cur);
    cur = LOCALES[cur].base;
  }
  if (!chain.includes(DEFAULT_LOCALE)) chain.push(DEFAULT_LOCALE);
  return chain;
}

// ── Catalog lookup with fallback (item 20) ──
/**
 * @param {Record<string, Record<string, string>>} catalogs { 'uz-Latn': { key: 'matn' } }
 * @param {string} locale
 * @param {string} key
 * @returns {string} topilgan string yoki key (topilmasa)
 */
export function lookupKey(catalogs, locale, key) {
  const chain = localeChain(locale);
  for (const l of chain) {
    const cat = catalogs[l];
    if (cat && Object.prototype.hasOwnProperty.call(cat, key) && cat[key] != null) {
      return cat[key];
    }
  }
  return key;
}

// ── ICU-style plural / select (item 4) ──
/**
 * ICU plural: { 'one': '...', 'other': '...' }.
 * @param {string} locale
 * @param {number} n
 * @param {Record<string,string>} forms
 */
export function plural(locale, n, forms) {
  const abs = Math.abs(n);
  let rule = 'other';
  if (locale.startsWith('uz') || locale.startsWith('ru')) {
    // Russian: 1, 21, 31... → one; 2-4, 22-24 → few; 0, 5-20, 25-30 → many (use other)
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) rule = 'one';
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) rule = 'few';
    else rule = 'other';
  } else {
    // English-style
    rule = n === 1 ? 'one' : 'other';
  }
  return forms[rule] != null ? forms[rule] : forms.other;
}

/**
 * ICU select: { 'male': '...', 'female': '...', 'other': '...' }.
 */
export function select(choice, forms) {
  if (forms[choice] != null) return forms[choice];
  return forms.other != null ? forms.other : '';
}

// ── Intl formatters (item 6) ──
export function formatNumber(locale, n) {
  try {
    return new Intl.NumberFormat(locale === 'uz-Cyrl' ? 'uz-Cyrl-UZ' : locale).format(n);
  } catch (_) {
    return String(n);
  }
}
export function formatPercent(locale, n) {
  try {
    return new Intl.NumberFormat(locale === 'uz-Cyrl' ? 'uz-Cyrl-UZ' : locale, {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(n);
  } catch (_) {
    return Math.round(n * 100) + '%';
  }
}
export function formatList(locale, items) {
  try {
    return new Intl.ListFormat(locale === 'uz-Cyrl' ? 'uz-Cyrl-UZ' : locale, {
      type: 'conjunction',
    }).format(items);
  } catch (_) {
    return items.join(', ');
  }
}
export function formatDate(locale, ts) {
  try {
    return new Intl.DateTimeFormat(locale === 'uz-Cyrl' ? 'uz-Cyrl-UZ' : locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ts));
  } catch (_) {
    return new Date(ts).toLocaleString();
  }
}

// ── Interpolation ──
/**
 * '{name} savol yubordi' — {{name}} orqali interpolatsiya qiladi.
 * XSS uchun escape: opts.escape=true (default false).
 */
export function interpolate(template, vars, escape) {
  if (!template || !vars) return template || '';
  return String(template).replace(/\{(\w+)\}/g, (_, k) => {
    let v = vars[k];
    if (v === undefined || v === null) return `{${k}}`;
    v = String(v);
    return escape ? v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : v;
  });
}

// ── Pseudo-locale (item 17) ──
const PSEUDO_MAP = {
  a: 'á', b: 'ƀ', c: 'ć', d: 'đ', e: 'é', f: 'ƒ', g: 'ǧ', h: 'ħ', i: 'í', j: 'ĵ',
  k: 'ǩ', l: 'ł', m: 'ɱ', n: 'ń', o: 'ó', p: 'ƥ', q: 'ɋ', r: 'ř', s: 'š', t: 'ţ',
  u: 'ú', v: 'ʋ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ć', D: 'Đ', E: 'É', F: 'Ƒ', G: 'Ǧ', H: 'Ħ', I: 'Í', J: 'Ĵ',
  K: 'Ǩ', L: 'Ł', M: 'M', N: 'Ń', O: 'Ó', P: 'Ƥ', Q: 'Q', R: 'Ř', S: 'Š', T: 'Ţ',
  U: 'Ú', V: 'V', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};
/**
 * Pseudo-locale: harflarni aksentli variantga almashtirib, qavslarga oladi.
 * Layout clipping test uchun (item 18).
 */
export function pseudoLocalize(text) {
  return (
    '[Ŀǿřéɱ] ' +
    String(text)
      .split('')
      .map((c) => PSEUDO_MAP[c] || c)
      .join('') +
    ' [íƥśúɱ]'
  );
}

// ── Missing key telemetry (item 19) — PII'siz ──
const missing = new Map(); // key → { firstAt, count }
export function reportMissingKey(key, locale) {
  const rec = missing.get(key) || { firstAt: Date.now(), count: 0, locales: new Set() };
  rec.count += 1;
  rec.locales.add(locale);
  missing.set(key, rec);
}
export function takeMissingKeyStats() {
  const out = [];
  for (const [key, rec] of missing) {
    out.push({ key, count: rec.count, locales: [...rec.locales], firstAt: rec.firstAt });
  }
  missing.clear();
  return out;
}

// ── Apostrophe normalization (item 14) ──
const APOSTROPHE_RE = /[\u02BB\u02BC\u2018\u2019\u2032`']/g;
/**
 * Uzbek apostrophe (oʻ/oʼ/g‘) input normalization — hamma turdagi
 * apostrophlarni bitta canonical (U+02BB) ga keltiradi.
 */
export function normalizeApostrophes(text) {
  if (!text) return text;
  return String(text).replace(APOSTROPHE_RE, '\u02BB');
}

// ── Bidi isolation (item 8/9/13) ──
export const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/;
export function hasBidiControl(text) {
  return BIDI_CONTROL_RE.test(String(text || ''));
}
/**
 * dir="auto" uchun: bidi control belgilari bo'lsa auto qaytaradi.
 */
export function autoDirClass(text) {
  return hasBidiControl(text) ? 'bidi-auto' : '';
}

// ── RTL (item 12/13) ──
export function isRtl(locale) {
  const c = canonicalLocale(locale);
  return c ? RTL_LOCALES.has(c) : false;
}
