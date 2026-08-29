/**
 * Deborah — Theme Engine v4 (STYLE STEP 07)
 * ----------------------------------------
 * S07.01  States: system|light|dark|hc-light|hc-dark → data-resolved-theme
 * S07.02  Head'dagi tiny sync boot (head.ejs) — FOUC yo'q
 * S07.03  Yagona attribute model: html[data-theme] + data-resolved-theme
 * S07.04  color-scheme resolved theme bilan (native form controls)
 * S07.05  meta-theme-color real canvas token bilan (#F5F7FB/#080C1A/#FFFFFF)
 * S07.06  900ms universal transition yo'q — root 150ms crossfade (theme.css)
 * S07.07  Reduced motion → instant
 * S07.08  System preference runtime'da — faqat user override yo'q bo'lsa
 * S07.09  Segmented control: System/Light/Dark ([data-theme-state-btn])
 * S07.10  Projector/data-cast-theme sahifalarida engine o'chadi
 * S07.11  Print: theme.css @media print (light tokens)
 */
(function () {
  'use strict';

  var core = window.DeborahThemeCore || { STATES: ['system', 'light', 'dark', 'hc-light', 'hc-dark'], resolveState: function () {} };
  var STORAGE_KEY = core.STORAGE_KEY || 'deborah-theme-state';
  var LEGACY_KEY = 'deborah-theme'; // eski dark/light toggle key (migration)

  var mqLight = null;
  var mqContrast = null;
  var mqReduced = null;

  // S07.08 FIX: prefers() birinchi chaqiruvda lazy-init qiladi —
  // apply() DOMContentLoaded'da wireListeners()dan OLDIN ishlasa ham
  // (eski e'lon tartibi tufayli) media query'lar tayyor bo'ladi.
  function prefers() {
    if (!mqLight && window.matchMedia) {
      mqLight = matchMedia('(prefers-color-scheme: light)');
      mqContrast = matchMedia('(prefers-contrast: more)');
      mqReduced = matchMedia('(prefers-reduced-motion: reduce)');
    }
    var light = !!(mqLight && mqLight.matches);
    var hc = !!(mqContrast && mqContrast.matches);
    return { light: light, hc: hc };
  }

  function readState() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) {}
    // Legacy migration (S07.03): eski deborah-theme='light'|'dark' → state
    if (!raw) {
      try {
        var legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy === 'light' || legacy === 'dark') {
          raw = legacy;
          // Migratsiyani bir marta persist qilamiz — har yuklashda takror
          // o'qilmasligi uchun (reviewer fix).
          try { localStorage.setItem(STORAGE_KEY, raw); } catch (_) {}
        }
      } catch (_) {}
    }
    return core.STATES.indexOf(raw) >= 0 ? raw : 'system';
  }

  /** Projektor/classroom sahifalari — OS'dan mustaqil (S07.10) */
  function isIndependentThemePage() {
    if (document.body && document.body.hasAttribute('data-cast-theme')) return true;
    if (document.documentElement.hasAttribute('data-cast-theme')) return true;
    return false;
  }

  function apply() {
    if (isIndependentThemePage()) return; // S07.10 — cast/classroom o'z themesini boshqaradi
    var state = readState();
    var p = prefers();
    var r = core.resolveState(state, p.light, p.hc);
    var root = document.documentElement;

    root.setAttribute('data-theme', r.resolved);          // yagona attribute model (S07.03)
    root.setAttribute('data-resolved-theme', r.resolved); // S07.01
    root.setAttribute('data-theme-state', r.state);       // S07.01
    root.style.colorScheme = r.colorScheme;               // S07.04 (fallback inline)

    // S07.05 — meta-theme-color real canvas bilan
    var mc = document.getElementById('meta-theme-color');
    if (mc) mc.setAttribute('content', r.canvas);

    document.dispatchEvent(new CustomEvent('themechange', {
      detail: { state: r.state, resolved: r.resolved, colorScheme: r.colorScheme },
    }));
    return r;
  }

  /** User explicit override (S07.08): localStorage + re-apply */
  function setState(state) {
    if (core.STATES.indexOf(state) < 0) return;
    try { localStorage.setItem(STORAGE_KEY, state); } catch (_) {}
    apply();
  }

  /** Eski data-theme-toggle (icon-only) tugmalar — davomiy compat: dark↔light aylantirish */
  function toggle() {
    var cur = readState();
    var next = cur === 'light' || cur === 'hc-light' ? 'dark' : 'light';
    setState(next);
  }

  // ── System preference runtime (S07.08) ──
  var listenersWired = false;
  function wireListeners() {
    if (listenersWired) return;
    function onSystemChange() {
      var state = readState();
      if (state === 'system') apply(); // faqat user override bo'lmaganda
    }
    prefers(); // mqLight/mqContrast/mqReduced tayyor (agar hali yo'q bo'lsa)
    if (window.matchMedia) {
      mqLight.addEventListener('change', onSystemChange);
      mqContrast.addEventListener('change', onSystemChange);
      // S07.07: prefers-reduced-motion CSS'da (theme.css @media) ishlanadi —
      // JS listener kerak emas (reviewer fix: dead no-op olib tashlandi).
    }
    listenersWired = true;
  }

  // ── S07.09: Segmented control (System / Light / Dark) ──
  function wireControls() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-theme-state-btn]');
      if (btn) {
        e.preventDefault();
        setState(btn.getAttribute('data-theme-state-btn'));
        return;
      }
      var old = e.target.closest('[data-theme-toggle]');
      if (old) {
        e.preventDefault();
        toggle();
      }
    });
    // Bosilgan holatni markalash
    document.addEventListener('themechange', function (e) {
      var state = e.detail && e.detail.state;
      document.querySelectorAll('[data-theme-state-btn]').forEach(function (b) {
        var on = b.getAttribute('data-theme-state-btn') === state;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('is-active', on);
      });
    });
  }

  window.DeborahTheme = {
    apply: apply,
    setState: setState,
    toggle: toggle,
    isLight: function () { return document.documentElement.getAttribute('data-resolved-theme') === 'light'; },
    getState: readState,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(); wireListeners(); wireControls(); });
  } else {
    apply(); wireListeners(); wireControls();
  }
})();
