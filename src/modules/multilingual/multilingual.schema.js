/**
 * Edikit — Uzbek Latin/Cyrillic & Terminology Layer (pure logic)
 *
 * Prompt 63 — uz-Latn, uz-Cyrl, ru va en content/version/search'ni
 * birinchi-class qilish (research.md §58). This module is PURE (no I/O):
 *
 *   - BCP-47/script constants.
 *   - transliterateUz: deterministic Latin ↔ Cyrillic (Uzbek official
 *     orthography; longest-match rules; original text ALWAYS preserved by
 *     caller).
 *   - detectScript: latn / cyrl detection.
 *   - normalizeUzName: apostrophe variants (', ʻ, ʼ, ’) → canonical,
 *     name normalization.
 *   - highlightAmbiguousTokens: ambiguous tokens (o'/g' vs standalone ',
 *     e/э) flag.
 *   - buildSearchKey: cross-script search normalization (Latn canonical
 *     base — both scripts' query finds same content).
 *   - assertNoPsychometricEquivalence: transliteration ≠ translation /
 *     psychometric equivalence (§58.4).
 *   - assertOriginalPreserved: original text saqlanishi majburiy.
 *   - assertIdentityNameIsolation: identity name content transliterator
 *     bilan ko'r-ko'rona o'zgartirilmaydi (§58.2).
 *   - buildGlossaryInjection: AI prompt/contentga glossary injection.
 *
 * SECURITY / DATA GUARD (Prompt 63 §15, §58.2/58.4):
 *   - Transliteration translation yoki psychometric equivalence emas;
 *     original text doim saqlanadi; identity name alohida.
 */

// ═══════════════════════════════════════════════════════════════════
// BCP-47 / SCRIPT CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const SUPPORTED_LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'];
export const TRANSLITERABLE_SCRIPTS = ['uz-Latn', 'uz-Cyrl'];

export const TERMINOLOGY_VERSION_STATUS = { DRAFT: 'draft', REVIEW: 'review', PUBLISHED: 'published', RETIRED: 'retired' };

export const TRANSLATION_STATUS = { DRAFT: 'draft', REVIEWED: 'reviewed', APPROVED: 'approved' };

export const EQUIVALENCE_STATUS = {
  UNEVALUATED: 'unevaluated',
  CONSTRUCT_EQUIVALENT: 'construct_equivalent',
  NEEDS_REVIEW: 'needs_review',
  NOT_EQUIVALENT: 'not_equivalent',
};

// ═══════════════════════════════════════════════════════════════════
// TRANSLITERATION — deterministic Uzbek Latin ↔ Cyrillic
// ═══════════════════════════════════════════════════════════════════

/**
 * Official Uzbek orthography mapping (longest match first).
 * Latin digraphs (sh, ch, ng, o', g') before single letters.
 */
const LATN_TO_CYRL = [
  ['oʻ', 'ў'], ['o‘', 'ў'], ["o'", 'ў'], ['ng', 'нг'],
  ['sh', 'ш'], ['ch', 'ч'], ["g'", 'ғ'], ['gʻ', 'ғ'], ['g‘', 'ғ'],
  // Semivowel y + vowel digraphs — official Uzbek Cyrillic uses Я/Ё/Ю
  // (yangi→янги, yosh→ёш, yulduz→юлдуз), NOT йа/йо/йу.
  ['ya', 'я'], ['yo', 'ё'], ['yu', 'ю'],
  ['a', 'а'], ['b', 'б'], ['d', 'д'], ['e', 'е'], ['f', 'ф'],
  ['g', 'г'], ['h', 'ҳ'], ['i', 'и'], ['j', 'ж'], ['k', 'к'],
  ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'],
  ['q', 'қ'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'],
  ['v', 'в'], ['x', 'х'], ['y', 'й'], ['z', 'з'], ['A', 'А'],
  ['B', 'Б'], ['D', 'Д'], ['E', 'Е'], ['F', 'Ф'], ['G', 'Г'],
  ['H', 'Ҳ'], ['I', 'И'], ['J', 'Ж'], ['K', 'К'], ['L', 'Л'],
  ['M', 'М'], ['N', 'Н'], ['O', 'О'], ['P', 'П'], ['Q', 'Қ'],
  ['R', 'Р'], ['S', 'С'], ['T', 'Т'], ['U', 'У'], ['V', 'В'],
  ['X', 'Х'], ['Y', 'Й'], ['Z', 'З'],
];

const CYRL_TO_LATN = [
  ['нг', 'ng'], ['ш', 'sh'], ['ч', 'ch'], ['ў', "o'"], ['ғ', "g'"],
  ['я', 'ya'], ['ю', 'yu'], ['ё', 'yo'], ['э', 'e'], ['ц', 'ts'],
  ['щ', 'shch'], ['ы', 'i'], ['ь', ''], ['ъ', "'"],
  ['а', 'a'], ['б', 'b'], ['в', 'v'], ['г', 'g'], ['д', 'd'],
  ['е', 'e'], ['ж', 'j'], ['з', 'z'], ['и', 'i'], ['й', 'y'],
  ['к', 'k'], ['л', 'l'], ['м', 'm'], ['н', 'n'], ['о', 'o'],
  ['п', 'p'], ['р', 'r'], ['с', 's'], ['т', 't'], ['у', 'u'],
  ['ф', 'f'], ['х', 'x'], ['ц', 'ts'], ['ч', 'ch'], ['ш', 'sh'],
  ['щ', 'shch'], ['ы', 'i'], ['ь', ''], ['э', 'e'], ['ю', 'yu'],
  ['я', 'ya'], ['қ', 'q'], ['ҳ', 'h'], ['А', 'A'], ['Б', 'B'],
  ['В', 'V'], ['Г', 'G'], ['Д', 'D'], ['Е', 'E'], ['Ё', 'Yo'],
  ['Ж', 'J'], ['З', 'Z'], ['И', 'I'], ['Й', 'Y'], ['К', 'K'],
  ['Л', 'L'], ['М', 'M'], ['Н', 'N'], ['О', 'O'], ['П', 'P'],
  ['Р', 'R'], ['С', 'S'], ['Т', 'T'], ['У', 'U'], ['Ф', 'F'],
  ['Х', 'X'], ['Ц', 'Ts'], ['Ч', 'Ch'], ['Ш', 'Sh'], ['Щ', 'Shch'],
  ['Ы', 'I'], ['Ь', ''], ['Э', 'E'], ['Ю', 'Yu'], ['Я', 'Ya'],
  ['Қ', 'Q'], ['Ҳ', 'H'], ['Ў', "O'"], ['Ғ', "G'"],
];

function applyMapping(text, mapping) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    let matched = false;
    // Longest match (4 → 1 chars)
    for (let len = 4; len >= 1; len--) {
      if (i + len <= text.length) {
        const chunk = text.slice(i, i + len);
        const entry = mapping.find(([from]) => from === chunk);
        if (entry) {
          out += entry[1];
          i += len;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/** Latin → Cyrillic (deterministic, official Uzbek). */
export function latnToCyrl(text = '') {
  if (!text) return '';
  return applyMapping(text, LATN_TO_CYRL);
}

/** Cyrillic → Latin (deterministic, official Uzbek). */
export function cyrlToLatn(text = '') {
  if (!text) return '';
  return applyMapping(text, CYRL_TO_LATN);
}

/** Script-agnostic Uzbek transliteration (auto-detect target). */
export function transliterateUz({ text = '', from = '', to = 'uz-Cyrl' } = {}) {
  if (!text) return { ok: true, text: '', from, to, ambiguous: [] };
  const source = from || (detectScript(text) === 'cyrl' ? 'uz-Cyrl' : 'uz-Latn');
  let result;
  if (source === 'uz-Latn' && to === 'uz-Cyrl') result = latnToCyrl(text);
  else if (source === 'uz-Cyrl' && to === 'uz-Latn') result = cyrlToLatn(text);
  else if (source === to) result = text;
  else return { ok: false, error: `unsupported transliteration ${source} -> ${to}` };
  return { ok: true, text: result, from: source, to, ambiguous: highlightAmbiguousTokens(text).ambiguous };
}

/** Detect script: cyrl if any Cyrillic char present, else latn. */
export function detectScript(text = '') {
  const cyrlChars = /[а-яА-ЯўғқҳЎҒҚҲ]/;
  return cyrlChars.test(text) ? 'cyrl' : 'latn';
}

// ═══════════════════════════════════════════════════════════════════
// NAME / APOSTROPHE NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

/** Canonicalize apostrophe variants (', ʻ, ʼ, ‘, ’, `, ´) to a single '. */
export function normalizeApostrophe(text = '') {
  return String(text).replace(/[ʻʼ’‘`´]/g, "'");
}

/** Normalize a user/student name (Uzbek): trim, collapse spaces, apostrophe canonical. */
export function normalizeUzName(name = '') {
  const t = normalizeApostrophe(name).replace(/\s+/g, ' ').trim();
  return t;
}

// ═══════════════════════════════════════════════════════════════════
// AMBIGUOUS TOKENS
// ═══════════════════════════════════════════════════════════════════

/**
 * Ambiguous tokens — transliteration paytida ikki xil talqin bo'lishi
 * mumkin bo'lgan joylar:
 *   - o'/g' — ў/ғ yoki o+ъ bo'lishi mumkin;
 *   - standalone ' — ъ (apostrophe);
 *   - Latn 'e' — е yoki э bo'lishi mumkin (ko'rinish).
 * Highlight qilinadi, inson review talab qilinadi.
 */
export function highlightAmbiguousTokens(text = '') {
  const ambiguous = [];
  const t = normalizeApostrophe(text);
  const re = /(o'|g'|'(?!\w)|(?<![a-z])e(?![a-z]))/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    ambiguous.push({ token: m[0], index: m.index, hint: m[0] === 'e' ? 'e may be е or э' : `' may be ъ or part of o'/g'` });
  }
  return { ambiguous };
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-SCRIPT SEARCH NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Cross-script search key: query (har qanday scriptda) → canonical Latn
 * base. "ўқувчи" va "o'quvchi" bir xil key beradi → search ikkala
 * scriptni topadi. Lowercase, digraphs canonical (sh/ch/o'/g'), apostrophe
 * stripped.
 */
export function buildSearchKey(text = '') {
  if (!text) return '';
  let t = String(text).toLowerCase();
  // Transliterate FIRST — cyrlToLatn produces o'/g' apostrophes for ў/ғ.
  // If we stripped apostrophes before, Cyrillic input would keep o' while
  // Latin input loses it → keys diverge ('ўқувчи' ≠ 'o'quvchi').
  if (detectScript(t) === 'cyrl') t = cyrlToLatn(t);
  // Apostrophe variants → canonical, then drop for search (after
  // transliteration so both scripts converge on the same canonical base).
  t = normalizeApostrophe(t).replace(/[']/g, '');
  // Canonical digraphs (sh, ch, ng already Latn from transliteration)
  t = t
    .replace(/[ё]/g, 'yo').replace(/[я]/g, 'ya').replace(/[ю]/g, 'yu')
    .replace(/[й]/g, 'y');
  return t.trim();
}

// ═══════════════════════════════════════════════════════════════════
// SECURITY / DATA GUARDS (§15, §58.2/58.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Guard: transliteration translation yoki psychometric equivalence emas.
 * Bir til variantining score'i boshqasiga tenglashtirilishi psychometric
 * evidence talab qiladi (§58.4). Har qanday auto-link reject qilinadi.
 */
export function assertNoPsychometricEquivalence({ psychometricLinked = false, equivalenceStatus = EQUIVALENCE_STATUS.UNEVALUATED } = {}) {
  if (psychometricLinked === true) {
    return { ok: false, reason: 'transliteration/translation cannot auto-link scores — psychometric equivalence evidence required (§58.4)' };
  }
  if (equivalenceStatus === EQUIVALENCE_STATUS.CONSTRUCT_EQUIVALENT && !psychometricLinked) {
    // Construct equivalent faqat inson review'dan keyin (service tomonidan) qo'yiladi;
    // schema darajasida bu bayroqcha o'zi xavfsiz.
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Guard: original text doim saqlanadi. Transliterated/translated result
 * original'siz hech qachon qabul qilinmaydi — content hech qachon
 * yo'qolmaydi (§58.2).
 */
export function assertOriginalPreserved({ original = '', result = '' } = {}) {
  if (!original) return { ok: false, reason: 'original text is required — never transliterate without preserving source' };
  if (result === '' && original !== '') return { ok: false, reason: 'result cannot be empty when original exists' };
  return { ok: true };
}

/**
 * Guard: identity name content transliterator bilan ko'r-ko'rona
 * o'zgartirilmaydi. Student ism-sharifi identity hujjati va institution
 * canonical name alohida fieldlarda (§58.2). Content transliteration
 * identity name'ni hech qachon o'zgartirmaydi.
 */
export function assertIdentityNameIsolation({ isIdentity = false, allowTransliteration = false } = {}) {
  if (isIdentity && !allowTransliteration) {
    return { ok: false, reason: 'identity proper names require canonical field + human confirmation — never blind-transliterate (§58.2)' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// GLOSSARY INJECTION (AI prompts/content)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a glossary injection block for AI prompts/content from
 * terminology terms. "Momentum" bir deckda bir xil, testda boshqa
 * tarjima bo'lib qolmaydi (§58.3).
 */
export function buildGlossaryInjection({ terms = [], targetLang = 'uz-Latn' } = {}) {
  if (!Array.isArray(terms) || terms.length === 0) return { ok: true, injection: '', termCount: 0 };
  const lines = terms.map((t) => {
    const target = targetLang === 'uz-Cyrl' ? (t.uz_cyrl || t.uz_latn) : (t.uz_latn || t.uz_cyrl);
    return `- ${t.canonical_term} → ${target}${t.definition ? ` (${t.definition})` : ''}`;
  });
  return {
    ok: true,
    injection: `Use the following approved terminology (do not vary):\n${lines.join('\n')}`,
    termCount: terms.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// VERSION / VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Validate BCP-47 locale is supported. */
export function assertSupportedLocale({ lang = '' } = {}) {
  if (!SUPPORTED_LOCALES.includes(lang)) {
    return { ok: false, reason: `unsupported locale: ${lang} (expected ${SUPPORTED_LOCALES.join(', ')})` };
  }
  return { ok: true };
}
