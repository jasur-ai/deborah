/**
 * Edikit — Premium Theme Switcher v3.3
 * Dark/Light toggle — ICON ONLY, 900ms transitions via data-theme-transition
 */
(function() {
  'use strict';
  var STORAGE_KEY = 'edikit-theme';
  var ATTR = 'data-theme';
  var TRANS_ATTR = 'data-theme-transition';

  function apply(theme) {
    var isLight = theme === 'light';
    var next = isLight ? 'light' : 'dark';
    var root = document.documentElement;

    // Step 1: Remove no-transition class FIRST (prevents flash)
    root.classList.remove('no-transition');
    if (document.body) document.body.classList.remove('no-transition');

    // Step 2: Add data-theme-transition to enable 900ms CSS transitions on ALL themed elements
    root.setAttribute(TRANS_ATTR, '');

    // Step 3: After a minimal delay, change the theme attribute
    setTimeout(function() {
      root.setAttribute(ATTR, next);
      if (document.body) {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(isLight ? 'theme-light' : 'theme-dark');
      }
      try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}

      // Update toggle buttons: ICON ONLY (no text)
      var iconFn = window.svgIcon;
      document.querySelectorAll('[data-theme-toggle]').forEach(function(btn) {
        if (iconFn) {
          btn.innerHTML = isLight ? iconFn('moon', 16) : iconFn('sun', 16);
        } else {
          btn.textContent = isLight ? '\u{1F319}' : '\u{2600}\u{FE0F}';
        }
        btn.setAttribute('title', isLight ? 'Dark mode' : 'Light mode');
      });

      // Update theme-color meta tag for mobile status bar
      var mc = document.getElementById('meta-theme-color');
      if (mc) mc.setAttribute('content', isLight ? '#DEE1ED' : '#080C1A');

      // Dispatch custom event for other scripts
      document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));

      // Step 4: Remove the transition attribute after animations complete (~1050ms)
      setTimeout(function() {
        document.documentElement.removeAttribute(TRANS_ATTR);
      }, 1050);
    }, 20);
  }

  function toggle() {
    var cur = document.documentElement.getAttribute(ATTR) || 'dark';
    apply(cur === 'dark' ? 'light' : 'dark');
  }

  window.EdikitTheme = {
    apply: apply,
    toggle: toggle,
    isLight: function() { return document.documentElement.getAttribute(ATTR) === 'light'; }
  };

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-theme-toggle]');
    if (btn) { e.preventDefault(); window.EdikitTheme.toggle(); }
  });
})();
