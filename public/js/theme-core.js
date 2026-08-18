/**
 * Edikit — Theme Core (STYLE STEP 07 / S07.01)
 * ---------------------------------------------
 * Pure theme state machine. Browser va Node (unit test) da ishlaydi.
 * DOM'ga tegmagan — faqat resolve qiladi.
 *
 * States: system | light | dark | hc-light | hc-dark
 * Resolved: light | dark | high-contrast  (data-resolved-theme)
 * colorScheme: light | dark               (native form controls — S07.04)
 *
 * Qoida (S07.08): system state'da faqat OS preference ishlaydi;
 * user explicit override (light/dark/hc-*) bo'lsa system e'tiborsiz.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'edikit-theme-state';
  var STATES = ['system', 'light', 'dark', 'hc-light', 'hc-dark'];

  /**
   * @param {string} state       — system|light|dark|hc-light|hc-dark
   * @param {boolean} prefersLight — prefers-color-scheme: light
   * @param {boolean} prefersHC    — prefers-contrast: more
   * @returns {{state:string, resolved:string, colorScheme:string, canvas:string}}
   */
  function resolveState(state, prefersLight, prefersHC) {
    var s = STATES.indexOf(state) >= 0 ? state : 'system';
    if (s === 'light') {
      return { state: s, resolved: 'light', colorScheme: 'light', canvas: '#F5F7FB' };
    }
    if (s === 'dark') {
      return { state: s, resolved: 'dark', colorScheme: 'dark', canvas: '#080C1A' };
    }
    if (s === 'hc-light') {
      return { state: s, resolved: 'high-contrast', colorScheme: 'light', canvas: '#FFFFFF' };
    }
    if (s === 'hc-dark') {
      return { state: s, resolved: 'high-contrast', colorScheme: 'dark', canvas: '#FFFFFF' };
    }
    // system — OS preferencelar (S07.08: user override yo'q)
    if (prefersHC) {
      return { state: s, resolved: 'high-contrast', colorScheme: prefersLight ? 'light' : 'dark', canvas: '#FFFFFF' };
    }
    return {
      state: s,
      resolved: prefersLight ? 'light' : 'dark',
      colorScheme: prefersLight ? 'light' : 'dark',
      canvas: prefersLight ? '#F5F7FB' : '#080C1A',
    };
  }

  root.EdikitThemeCore = {
    STORAGE_KEY: STORAGE_KEY,
    STATES: STATES,
    resolveState: resolveState,
  };

  // Node/ESM export (unit test uchun)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { STORAGE_KEY, STATES, resolveState };
  }
})(typeof window !== 'undefined' ? window : globalThis);
