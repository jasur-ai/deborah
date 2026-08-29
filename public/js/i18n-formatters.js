/* ─────────────────────────────────────────────────────────────────────
   Deborah — Locale-aware formatters (STYLE S35.06)
   - Number, percent, date, duration va list formatting `Intl` bilan.
   - `window.DeborahI18nFmt` — barcha sahifalarda foydalanish mumkin.
   - Locale tanlanmagan bo'lsa default (uz-Latn) ishlatiladi.
   ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var DEFAULT_LOCALE = 'uz-Latn';
  var currentLocale = null;

  try {
    currentLocale = (document.documentElement.getAttribute('lang') || '').replace(/_/g, '-') || DEFAULT_LOCALE;
  } catch (_) {
    currentLocale = DEFAULT_LOCALE;
  }

  function locale() {
    return currentLocale || DEFAULT_LOCALE;
  }

  var cache = {};

  function formatter(kind, opts) {
    var key = kind + ':' + JSON.stringify(opts || {});
    if (!cache[key]) {
      cache[key] = new Intl.NumberFormat(locale(), opts || {});
    }
    return cache[key];
  }

  /** S35.06 — Raqam (Intl.NumberFormat, locale-aware). */
  function formatNumber(value, opts) {
    if (value === null || value === undefined || isNaN(Number(value))) return String(value ?? '');
    return formatter('num', opts).format(Number(value));
  }

  /** S35.06 — Foiz: 0.42 -> "42%" (locale separator). */
  function formatPercent(value, opts) {
    if (value === null || value === undefined || isNaN(Number(value))) return String(value ?? '');
    return formatter('pct', Object.assign({ style: 'percent' }, opts || {})).format(Number(value));
  }

  /** S35.06 — Sana (Intl.DateTimeFormat). */
  function formatDate(value, opts) {
    if (!value) return '';
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat(locale(), opts || { dateStyle: 'medium' }).format(d);
  }

  /** S35.06 — Davomiylik: soniya -> "1 daq 05 s" yoki ISO-like. */
  function formatDuration(totalSeconds, opts) {
    var o = opts || {};
    var s = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (o.compact) {
      if (s < 60) return s + ' s';
      var m = Math.floor(s / 60);
      if (m < 60) return m + ' daq';
      var h = Math.floor(m / 60);
      return h + ' soat';
    }
    var mm = Math.floor(s / 60);
    var ss = String(s % 60).padStart(2, '0');
    if (mm < 60) return mm + ' daq ' + ss + ' s';
    var hh = Math.floor(mm / 60);
    mm = mm % 60;
    return hh + ' soat ' + String(mm).padStart(2, '0') + ' daq';
  }

  /** S35.06 — Ro'yxat: ["A","B","C"] -> "A, B va C" (locale conjunction). */
  function formatList(items) {
    var arr = (items || []).filter(Boolean);
    if (!arr.length) return '';
    try {
      return new Intl.ListFormat(locale(), { type: 'conjunction', style: 'long' }).format(arr);
    } catch (_) {
      // Intl.ListFormat yo'q eski brauzerlar uchun fallback
      return arr.length === 1 ? String(arr[0]) : arr.slice(0, -1).join(', ') + ' va ' + arr[arr.length - 1];
    }
  }

  /** Joriy locale'ni o'rnatish (saylangan tildan keyin chaqiriladi). */
  function setLocale(loc) {
    currentLocale = loc || DEFAULT_LOCALE;
    cache = {};
  }

  window.DeborahI18nFmt = {
    locale: locale,
    setLocale: setLocale,
    formatNumber: formatNumber,
    formatPercent: formatPercent,
    formatDate: formatDate,
    formatDuration: formatDuration,
    formatList: formatList,
  };
})();
