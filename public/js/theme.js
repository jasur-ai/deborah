/**
 * Edikit — Theme Switcher v2.0
 * Dark/Light mode toggle with smooth transitions and localStorage persistence
 * Transitions are 600ms for colors, 400ms for borders — smooth eye-catching effect
 * 
 * Initialization happens inline in <head> to prevent flash.
 * This file handles runtime toggling with transition management.
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'edikit-theme';
  const ATTR = 'data-theme';
  const TRANSITION_DURATION = 600; // ms — must match CSS transition timing

  /**
   * Apply theme with smooth transition
   */
  function apply(theme) {
    const isLight = theme === 'light';
    const nextTheme = isLight ? 'light' : 'dark';
    const root = document.documentElement;

    // Step 1: Remove no-transition (re-enable CSS transitions)
    root.classList.remove('no-transition');
    document.body && document.body.classList.remove('no-transition');

    // Step 2: Update attributes
    root.setAttribute(ATTR, nextTheme);
    if (document.body) {
      document.body.classList.remove('theme-light', 'theme-dark');
      document.body.classList.add(isLight ? 'theme-light' : 'theme-dark');
    }

    // Step 3: Persist
    try { localStorage.setItem(STORAGE_KEY, nextTheme); } catch (_) {}

    // Step 4: Update toggle buttons
    document.querySelectorAll('[data-theme-toggle]').forEach(function(btn) {
      btn.innerHTML = (isLight ? 
        window.svgIcon ? window.svgIcon('moon', 14) + ' Dark' : '🌙 Dark' :
        window.svgIcon ? window.svgIcon('sun', 14) + ' Light' : '☀️ Light');
      btn.setAttribute('title', isLight ? 'Dark mode' : 'Light mode');
    });

    // Step 5: Update theme-color meta for mobile
    var themeColor = document.getElementById('meta-theme-color');
    if (themeColor) {
      themeColor.setAttribute('content', isLight ? '#F4F6FB' : '#0A0F1F');
    }

    // Step 6: Dispatch custom event
    document.dispatchEvent(new CustomEvent('themechange', { 
      detail: { theme: nextTheme } 
    }));
  }

  /**
   * Toggle between dark and light
   */
  function toggle() {
    const current = document.documentElement.getAttribute(ATTR) || 'dark';
    apply(current === 'dark' ? 'light' : 'dark');
  }

  /**
   * Check if current theme is light
   */
  function isLight() {
    return document.documentElement.getAttribute(ATTR) === 'light';
  }

  // Expose globally
  window.EdikitTheme = { apply: apply, toggle: toggle, isLight: isLight };

  // Listen for toggle clicks (delegated)
  document.addEventListener('click', function(e) {
    var toggleBtn = e.target.closest('[data-theme-toggle]');
    if (toggleBtn) {
      e.preventDefault();
      window.EdikitTheme.toggle();
    }
  });
})();
