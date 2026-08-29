/**
 * Deborah — Teacher Workspace UX (STYLE STEP 25)
 * ----------------------------------------------
 * - S25.08: density preference (localStorage, critical widgets yashirilmaydi)
 * - S25.08: saved search (oxirgi qidiruv saqlanadi — filter emas, xavfsiz)
 * - S25.11: live region flood yo'q (ws-live faqat qisqa status yozadi)
 *
 * Progressive enhancement: JS yo'q bo'lsa server-render to'liq ishlaydi.
 */
(function () {
  'use strict';
  var DENSITY_KEY = 'deborah-ws-density';
  var SEARCH_KEY = 'deborah-ws-search';

  document.addEventListener('DOMContentLoaded', function () {
    initDensity();
    initSavedSearch();
  });

  // ── S25.08: density preference (compact/default) ──
  function initDensity() {
    var saved = null;
    try { saved = localStorage.getItem(DENSITY_KEY); } catch (_) { /* private mode */ }
    if (saved === 'compact') document.body.setAttribute('data-ws-density', 'compact');

    // Toolbar tugmasi — shell-account emas, faqat workspace'da
    var btn = document.querySelector('[data-ws-density-toggle]');
    if (!btn) return;
    btn.setAttribute('aria-pressed', saved === 'compact' ? 'true' : 'false');
    btn.addEventListener('click', function () {
      var next = document.body.getAttribute('data-ws-density') === 'compact' ? 'default' : 'compact';
      document.body.setAttribute('data-ws-density', next === 'compact' ? 'compact' : '');
      btn.setAttribute('aria-pressed', next === 'compact' ? 'true' : 'false');
      try {
        if (next === 'compact') localStorage.setItem(DENSITY_KEY, 'compact');
        else localStorage.removeItem(DENSITY_KEY);
      } catch (_) { /* private mode */ }
    });
  }

  // ── S25.08: saved search — oxirgi qidiruv input'ga to'ldiriladi ──
  function initSavedSearch() {
    var inp = document.getElementById('search-inp');
    if (!inp) return;
    var saved = null;
    try { saved = localStorage.getItem(SEARCH_KEY); } catch (_) { /* private mode */ }
    if (saved && !inp.value) {
      inp.value = saved;
      inp.setAttribute('data-saved-search', '1');
    }
    var timer = null;
    inp.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        try { localStorage.setItem(SEARCH_KEY, inp.value); } catch (_) { /* private mode */ }
      }, 400);
    });
  }
})();
