/**
 * Cast C4-05 — Client i18n
 * -------------------------
 * `window.CastI18n` — translation bootstrap.
 * - Catalogs `/locales/{locale}/cast.json` dan fetch qilinadi (fallback chain).
 * - `t(key, vars)` — lookupKey/interpolate (services/i18n/catalog.js bilan mos).
 * - Document `lang`/`dir` o'rnatish + RTL class (item 10).
 * - `dirAuto`/`bdi` — user text bidi isolation (item 8/9/13).
 * - Apostrophe input normalization (item 14).
 */
(function () {
  'use strict';

  const DEFAULT_LOCALE = 'uz-Latn';
  // BCP-47 registry (services/i18n/catalog.js bilan mos)
  const LOCALES = {
    'uz-Latn': { base: null, rtl: false },
    'uz-Cyrl': { base: 'uz-Latn', rtl: false },
    ru: { base: 'uz-Latn', rtl: false },
    en: { base: 'uz-Latn', rtl: false },
    ar: { base: 'en', rtl: true },
    'fa-IR': { base: 'en', rtl: true },
  };

  const catalogs = {}; // { locale: { key: value } }
  let currentLocale = DEFAULT_LOCALE;
  let readyPromise = null;

  function canonicalLocale(input) {
    if (!input) return null;
    const s = String(input).trim().replace(/_/g, '-');
    if (LOCALES[s]) return s;
    const lower = s.toLowerCase();
    const hit = Object.keys(LOCALES).find((k) => k.toLowerCase() === lower);
    if (hit) return hit;
    if (s.split('-')[0].toLowerCase() === 'uz') return 'uz-Latn';
    return null;
  }

  function chain(locale) {
    const out = [];
    let cur = canonicalLocale(locale) || DEFAULT_LOCALE;
    while (cur) {
      out.push(cur);
      cur = LOCALES[cur].base;
    }
    if (!out.includes(DEFAULT_LOCALE)) out.push(DEFAULT_LOCALE);
    return out;
  }

  async function loadCatalog(locale) {
    if (catalogs[locale]) return catalogs[locale];
    try {
      const res = await fetch(`/locales/${locale}/cast.json`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      catalogs[locale] = await res.json();
    } catch (_) {
      catalogs[locale] = {};
    }
    return catalogs[locale];
  }

  function interpolate(template, vars) {
    if (!template || !vars) return template || '';
    return String(template).replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] === undefined || vars[k] === null ? `{${k}}` : String(vars[k])
    );
  }

  function t(key, vars) {
    for (const l of chain(currentLocale)) {
      const cat = catalogs[l];
      if (cat && Object.prototype.hasOwnProperty.call(cat, key) && cat[key] != null) {
        return interpolate(cat[key], vars);
      }
    }
    // C4-05 (item 19): missing key telemetry — client-side silent, key qaytariladi
    try {
      window.localStorage.setItem('castI18nMissing', key);
    } catch (_) { /* ignore */ }
    return interpolate(key, vars);
  }

  function applyDocument(locale) {
    const canonical = canonicalLocale(locale) || DEFAULT_LOCALE;
    const doc = document.documentElement;
    doc.setAttribute('lang', canonical);
    doc.setAttribute('dir', LOCALES[canonical].rtl ? 'rtl' : 'ltr');
    document.body.classList.toggle('cast-rtl', !!LOCALES[canonical].rtl);
    // C4-05 (item 18): pseudo-locale (debug ?pseudo=1)
    try {
      if (new URLSearchParams(location.search).has('pseudo')) {
        document.body.classList.add('cast-pseudo');
      }
    } catch (_) { /* ignore */ }
  }

  /**
   * init — catalogs'ni yuklab, document'ni sozlaydi.
   * @param {{ locale?: string }} opts
   * @returns {Promise<{t: Function}>}
   */
  function init(opts) {
    opts = opts || {};
    const requested = canonicalLocale(opts.locale) || DEFAULT_LOCALE;
    currentLocale = requested;
    applyDocument(requested);
    readyPromise = (async () => {
      // C4-05 (review fix #3): uz-Latn bazasi birinchi yuklanadi — async race'da
      // ham t() default locale'da ishlaydi (status'lar raw key ko'rsatmaydi).
      if (requested !== DEFAULT_LOCALE && !catalogs[DEFAULT_LOCALE]) {
        await loadCatalog(DEFAULT_LOCALE);
      }
      await Promise.all(chain(requested).map(loadCatalog));
      // C4-05: statik ejs stringlar — data-i18n atributi orqali translate
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        const val = t(key);
        if (val !== key) {
          if (el.hasAttribute('placeholder')) el.setAttribute('placeholder', val);
          else el.textContent = val;
        }
      });
      // C4-05 (item 8): user text inputlari dir=auto
      document.querySelectorAll('input[type=text], input:not([type]), textarea').forEach((el) => {
        el.setAttribute('dir', 'auto');
      });
      return { t, locale: currentLocale, isRtl: !!LOCALES[requested].rtl };
    })();
    return readyPromise;
  }

  // ── Bidi helpers (item 8/9/13) ──
  const BIDI_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u05D0-\u05EA\u0600-\u06FF\u0591-\u05FF]/;
  function hasBidi(text) {
    return BIDI_RE.test(String(text || ''));
  }
  /** Elementga dir="auto" o'rnatadi (user text uchun). */
  function dirAuto(el) {
    if (el) el.setAttribute('dir', 'auto');
    return el;
  }
  /** Textni <bdi> ichiga oladi — dynamic alias/nickname isolation (item 9). */
  function bdi(text) {
    const span = document.createElement('bdi');
    span.textContent = text;
    return span;
  }

  // ── Apostrophe normalization (item 14) ──
  const APOS_RE = /[\u02BB\u02BC\u2018\u2019\u2032`']/g;
  function normalizeApostrophes(text) {
    if (text == null) return text;
    return String(text).replace(APOS_RE, '\u02BB');
  }

  window.CastI18n = {
    init,
    t,
    chain,
    canonicalLocale,
    hasBidi,
    dirAuto,
    bdi,
    normalizeApostrophes,
    currentLocale: () => currentLocale,
    setLocale(locale) {
      const c = canonicalLocale(locale);
      if (!c) return;
      currentLocale = c;
      applyDocument(c);
      return Promise.all(chain(c).map(loadCatalog));
    },
  };
})();
