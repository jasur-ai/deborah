/**
 * Edikit — Tabs (STYLE STEP 14, S14.07)
 * ----------------------------------------
 * ARIA tabs pattern: role=tablist/tab/tabpanel.
 * - Arrow-key nav (Left/Right, Up/Down), Home/End
 * - Roving tabindex — focus/selection separation (S14.07)
 * - Activation: click / Enter / Space
 * - Auto-rotate YO'Q (S14.08)
 *
 * Ulanish (progressive enhancement): [data-tabs] wrapper ichida
 * [role="tablist"] > [role="tab"][aria-controls] + [role="tabpanel"][id].
 */
(function () {
  'use strict';

  function initTabs(wrapper) {
    var tablist = wrapper.querySelector('[role="tablist"]');
    if (!tablist) return;
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    if (tabs.length === 0) return;

    var panels = {};
    tabs.forEach(function (tab) {
      var id = tab.getAttribute('aria-controls');
      if (id) panels[id] = document.getElementById(id);
    });

    function selectTab(tab, moveFocus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var p = panels[t.getAttribute('aria-controls')];
        if (p) p.hidden = !on;
      });
      if (moveFocus) tab.focus();
    }

    // Roving tabindex — boshlang'ich: selected yagona focusable
    tabs.forEach(function (t, i) {
      var selected = t.getAttribute('aria-selected') === 'true';
      t.tabIndex = selected ? 0 : -1;
      if (selected) selectTab(t, false); // panels sync
      t.addEventListener('click', function () { selectTab(t, false); });

      t.addEventListener('keydown', function (e) {
        var idx = tabs.indexOf(t);
        var next = null;
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            next = tabs[(idx + 1) % tabs.length];
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            next = tabs[(idx - 1 + tabs.length) % tabs.length];
            break;
          case 'Home':
            next = tabs[0];
            break;
          case 'End':
            next = tabs[tabs.length - 1];
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            selectTab(t, false);
            return;
        }
        if (next) {
          e.preventDefault();
          next.focus(); // S14.07: focus moves, selection follows on Enter/Space/click
        }
      });
    });

    // S14.08: selected tab panel ko'rinishi uchun boshlang'ich sync
    var anySelected = tabs.some(function (t) { return t.getAttribute('aria-selected') === 'true'; });
    if (!anySelected && tabs[0]) selectTab(tabs[0], false);
  }

  function init() {
    document.querySelectorAll('[data-tabs]').forEach(function (w) {
      if (!w.__edikitTabs) {
        w.__edikitTabs = true;
        initTabs(w);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
