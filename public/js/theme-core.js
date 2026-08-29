/**
 * Deborah — Theme Core (STYLE STEP 07 / S07.01)
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

  var STORAGE_KEY = 'deborah-theme-state';
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
      // BUG-077: to'liq hc token sheeti yo'q — hc holatlari bazaviy temaga graceful resolve
      // qilinadi (state saqlanadi; sheet qo'shilganda shu joyda almashtiriladi)
      return { state: s, resolved: 'light', colorScheme: 'light', canvas: '#F5F7FB' };
    }
    if (s === 'hc-dark') {
      return { state: s, resolved: 'dark', colorScheme: 'dark', canvas: '#080C1A' };
    }
    // system — OS preferencelar (S07.08: user override yo'q)
    if (prefersHC) {
      // BUG-077: OS 'prefers-contrast: more' mavjud temani buzmasin — bazaviy resolve
      return { state: s, resolved: prefersLight ? 'light' : 'dark', colorScheme: prefersLight ? 'light' : 'dark', canvas: prefersLight ? '#F5F7FB' : '#080C1A' };
    }
    return {
      state: s,
      resolved: prefersLight ? 'light' : 'dark',
      colorScheme: prefersLight ? 'light' : 'dark',
      canvas: prefersLight ? '#F5F7FB' : '#080C1A',
    };
  }

  root.DeborahThemeCore = {
    STORAGE_KEY: STORAGE_KEY,
    STATES: STATES,
    resolveState: resolveState,
  };

  // Node/ESM export (unit test uchun)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { STORAGE_KEY, STATES, resolveState };
  }
})(typeof window !== 'undefined' ? window : globalThis);
