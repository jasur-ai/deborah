/* ─────────────────────────────────────────────────────────────────────
   Deborah — Term utils (STYLE S35.03/04/05)
   - `window.DeborahTerms`: TERMS/JARGON (data/term-registry.js bilan mos)
   - Apostrophe normalization: Uzbek o' g' ь variantlari -> U+02BB canonical
   - `dirAuto` / `bdi` yordamchilari: user-generated text bidi isolation
   - `approveJargon`: eski jargon'ni approved label bilan almashtirish
   ───────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ── S35.05: Uzbek apostrophe variants -> canonical U+02BB ──
  var APOSTROPHE_RE = /[\u02BB\u02BC\u2018\u2019\u2032`']/g;
  var G_Y_RE = /[gG][\u02BB\u02BC\u2018\u2019\u2032`']?/g; // gʻ / g' / g‘

  /**
   * Hamma apostrophe variantlarni canonical (U+02BB) ga keltiradi.
   * Display'da asl matn saqlanadi; qidiruv/solishtirishda canonical ishlatiladi.
   */
  function normalizeApostrophes(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(APOSTROPHE_RE, '\u02BB');
  }

  /** S35.05 — Qidiruv uchun: kichik harf + apostrophe canonical + bo'shliq normalizatsiya. */
  function searchNormalize(text) {
    return normalizeApostrophes(text).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // ── S35.07: Bidi isolation ──
  var BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/;

  function hasBidiControl(text) {
    return BIDI_CONTROL_RE.test(String(text || ''));
  }

  /** User text uchun dir="auto" qiymati (sanitized: 'ltr'|'rtl'|'auto'). */
  function dirAuto(text) {
    if (hasBidiControl(text)) return 'ltr'; // bidi control'lar xavfsiz emas
    var t = String(text || '');
    // Arab/ivrit/forс RTL block'lari
    if (/[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(t)) return 'rtl';
    return 'auto';
  }

  /** `<bdi>` uchun xavfsiz attribute qiymati (hech qachon raw user input). */
  function bdi(text) {
    return {
      text: String(text || ''),
      dir: dirAuto(text),
    };
  }

  // ── S35.03/04: Term registry (client nusxasi) ──
  var TERMS = {
    teacher: { label: 'O\u02BBqituvchi', plural: 'O\u02BBqituvchilar' },
    student: { label: 'Ishtirokchi', plural: 'Ishtirokchilar' },
    test: { label: 'Test', plural: 'Testlar' },
    readyTest: { label: 'Tayyor test', plural: 'Tayyor testlar' },
    sampleTest: { label: 'Namuna test', plural: 'Namuna testlar' },
    session: { label: 'Jonli sessiya', plural: 'Jonli sessiyalar' },
    question: { label: 'Savol', plural: 'Savollar' },
    result: { label: 'Natija', plural: 'Natijalar' },
    score: { label: 'Ball', plural: 'Ballar' },
    settings: { label: 'Sozlamalar' },
    leaderboard: { label: 'Reyting', plural: 'Reytinglar' },
    invite: { label: 'Taklif', plural: 'Takliflar' },
    timer: { label: 'Vaqt' },
    grading: { label: 'Baholash' },
  };

  var JARGON = {
    mock: { label: 'Namuna fanlar', jargon: ['Mock', 'Mock Fanlar', 'MOCK'] },
    pre: { label: 'Tayyor testlar', jargon: ['PRE', 'PRE Testlar', 'PRE Test'] },
    characters: { label: 'Qahramonlar', jargon: ['Characters', 'Character'] },
    realtime: { label: 'Jonli o\u02BByin', jargon: ['Real-time Multiplayer', 'Realtime'] },
    cast: { label: 'Jonli sessiya', jargon: ['Cast', 'CAST'] },
  };

  function termLabel(key) {
    var t = TERMS[key] || JARGON[key];
    return t ? t.label : key;
  }

  function approveJargon(text) {
    if (!text) return text;
    var out = String(text);
    // Eng uzun jargon birinchi almashtiriladi ("Mock Fanlar" -> "Mock" ichida qolmaydi).
    var all = [];
    Object.keys(JARGON).forEach(function (key) {
      JARGON[key].jargon.forEach(function (j) { all.push({ j: j, label: JARGON[key].label }); });
    });
    all.sort(function (a, b) { return b.j.length - a.j.length; });
    all.forEach(function (item) {
      var esc = item.j.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.split(new RegExp('\\b' + esc + '\\b', 'g')).join(item.label);
    });
    return out;
  }

  window.DeborahTerms = {
    TERMS: TERMS,
    JARGON: JARGON,
    termLabel: termLabel,
    approveJargon: approveJargon,
    normalizeApostrophes: normalizeApostrophes,
    searchNormalize: searchNormalize,
    hasBidiControl: hasBidiControl,
    dirAuto: dirAuto,
    bdi: bdi,
  };
})();
