/* ═══════════════════════════════════════════════════════════════
   STEP 17 — Navigation / wayfinding JS
   S17.06/07: unified shell drawer — focus trap, Escape, overlay
   close, trigger focus restore (old per-view inline scripts
   replaced — S17.06 was duplicated in 5 role views).
   S17.11: account menu (theme/accessibility/logout grouped).
   S17.02: public nav drawer (nav.ejs).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /* ── S17.06/07: Shell drawer ──
     Open: burger → body.shell-open, aria-expanded=true, focus trap,
     focus first focusable. Close: X / overlay / Escape / route →
     trigger focus restore. */
  function initShellDrawer() {
    var burger = document.querySelector('[data-shell-open]');
    if (!burger) return;

    var sidebar = document.getElementById('shell-sidebar') || burger.closest('.shell-sidebar') || document.querySelector('.shell-sidebar');
    var overlay = document.querySelector('.shell-overlay[data-shell-close], [data-shell-overlay]');
    var prevFocus = null;

    function isOpen() { return document.body.classList.contains('shell-open'); }

    function open() {
      if (isOpen()) return;
      prevFocus = document.activeElement;
      document.body.classList.add('shell-open');
      burger.setAttribute('aria-expanded', 'true');
      if (sidebar) {
        var first = sidebar.querySelector(FOCUSABLE);
        if (first) { first.focus(); }
        else { sidebar.focus && sidebar.focus(); }
      }
    }

    function close() {
      if (!isOpen()) return;
      document.body.classList.remove('shell-open');
      burger.setAttribute('aria-expanded', 'false');
      if (prevFocus && prevFocus.focus) { prevFocus.focus(); }
    }

    burger.addEventListener('click', function () {
      if (isOpen()) { close(); } else { open(); }
    });

    // Close buttons + overlay
    var closers = document.querySelectorAll('[data-shell-close]');
    for (var i = 0; i < closers.length; i++) {
      closers[i].addEventListener('click', close);
    }

    // Escape closes (S17.07)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { close(); }
    });

    // Focus trap while open (S17.07)
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || !isOpen() || !sidebar) return;
      var focusables = sidebar.querySelectorAll(FOCUSABLE);
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sidebar)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });

    // Hash change / route navigation → auto-close (SPA-style anchor nav)
    window.addEventListener('hashchange', close);
  }

  /* ── S17.11: Account menu ── */
  function initAccountMenu() {
    var btn = document.querySelector('.shell-account-btn');
    var root = document.querySelector('.shell-account');
    if (!btn || !root) return;

    function isOpen() { return root.classList.contains('open'); }
    function open() {
      root.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      var first = root.querySelector('.shell-account-menu a, .shell-account-menu button');
      if (first) first.focus();
    }
    function close() {
      root.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) { close(); } else { open(); }
    });

    document.addEventListener('click', function (e) {
      if (isOpen() && !root.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { close(); btn.focus(); }
    });
  }

  /* ── S17.02: Public nav (nav.ejs) drawer ──
     S17.07: shell drawer bilan bir xil — focus trap, Escape, link click close. */
  function initPublicNav() {
    var burger = document.querySelector('.nav-burger');
    if (!burger) return;
    var links = document.querySelector('.nav-links');
    if (!links) return;
    var prevFocus = null;

    function isOpen() { return document.body.classList.contains('nav-open'); }
    function open() {
      prevFocus = document.activeElement;
      document.body.classList.add('nav-open');
      burger.setAttribute('aria-expanded', 'true');
      var first = links.querySelector(FOCUSABLE);
      if (first) first.focus();
    }
    function close() {
      document.body.classList.remove('nav-open');
      burger.setAttribute('aria-expanded', 'false');
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }

    burger.addEventListener('click', function () {
      if (isOpen()) { close(); } else { open(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { close(); }
      if (e.key === 'Tab' && isOpen()) {
        var focusables = links.querySelectorAll(FOCUSABLE);
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    // Drawer ichidagi link click → close
    links.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initShellDrawer(); initAccountMenu(); initPublicNav();
    });
  } else {
    initShellDrawer(); initAccountMenu(); initPublicNav();
  }
})();
