/**
 * Deborah — Auth page client UX (AUTH D-07 — modular refactor)
 * ============================================================
 * Login/register sahifalari (login.ejs, register.ejs, invite.ejs,
 * google-setup.ejs, admin/login.ejs) uchun bitta yengil modul.
 *
 * Har bir funksiya alohida `init*` — DOMContentLoaded'da yig'iladi.
 * Progressive enhancement: no-JS holatda forma to'liq ishlaydi;
 * barcha init funksiyalar element topilmasa no-op qiladi.
 *
 * D-07 o'zgarishlari:
 *  - lockout countdown TO'LIQ versiya (matn + vaqt + hint + submit blok) —
 *    login.ejs'dagi inline dublikat script shu yerga ko'chirildi (register.ejs
 *    ham shu funksiya orqali ishlaydi; ikki timer raqobati yo'qoldi)
 *  - inline xato input'ga yozishda tozalanadi (error → yechim UX)
 *  - window.DeborahAuth.csrfToken() — fetch asosidagi oqimlar uchun CSRF helper
 *
 * Registerspesifik (rol kartalari, invite, email live check, HIBP breach) —
 * public/js/register.js'da, alohida faylda (B-03/D-07).
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    initPasswordToggles();
    initStrengthMeter();
    initInlineErrors();
    initInlineErrorClear();
    initLockoutCountdown();
    initCapsLockHints();
    initAuthTabs();
    initSubmitLock();
    initGoogleButton();
  });

  // ── CSRF helper (D-07 §16) ──────────────────────────────────────────────
  // Standart forma POST'lari hidden `_csrf` input orqali ishlaydi; bu helper
  // fetch asosidagi oqimlar (passkey, register live check) uchun bitta manba.
  function csrfToken() {
    var el = document.querySelector('.auth-form [name="_csrf"]');
    return el ? el.value : '';
  }
  if (typeof window !== 'undefined' && window) {
    var DeborahAuth = window.DeborahAuth || (window.DeborahAuth = {});
    DeborahAuth.csrfToken = csrfToken;
  }

  // ── Google tugmasi — ikki marta bosish/navigatsiyani bloklash (A-04) ────
  function initGoogleButton() {
    var btn = document.querySelector('[data-google-btn]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.classList.add('is-pending');
      btn.setAttribute('aria-busy', 'true');
      btn.style.pointerEvents = 'none';
    });
  }

  // ── Tab semantikasi — roving tabindex + arrow keys (S24.02) ─────────────
  function initAuthTabs() {
    var tablist = document.querySelector('.auth-tabs');
    if (!tablist) return;
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    if (tabs.length < 2) return;

    var select = function (tab, focus) {
      var mode = tab.id === 'tab-reg' ? 'reg' : 'login';
      var form = document.getElementById(mode === 'reg' ? 'form-reg' : 'form-login');
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      if (form) {
        var forms = document.querySelectorAll('.auth-form');
        forms.forEach(function (f) { f.classList.remove('is-active'); });
        form.classList.add('is-active');
      }
      var cta = document.getElementById('has-account');
      var noAcc = document.getElementById('no-account');
      if (cta) cta.style.display = mode === 'reg' ? '' : 'none';
      if (noAcc) noAcc.style.display = mode === 'login' ? '' : 'none';
      // URL'ni server-side tab state'ga moslash (history push, reload'da saqlanadi)
      if (window.history && window.history.replaceState) {
        var url = new URL(window.location.href);
        if (mode === 'reg') url.searchParams.set('mode', 'reg');
        else url.searchParams.delete('mode');
        window.history.replaceState({}, '', url.toString());
      }
      if (focus) tab.focus();
    };

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var idx = tabs.indexOf(tab);
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(idx + 1) % tabs.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(idx - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) {
          e.preventDefault();
          select(next, true);
        }
      });
    });
  }

  // ── Submit pending — spinner + duplicate-submit lock (S24.06) ───────────
  function initSubmitLock() {
    document.querySelectorAll('.auth-submit').forEach(function (btn) {
      var form = btn.closest('form');
      if (!form) return;
      form.addEventListener('submit', function (ev) {
        if (form.dataset.submitting === '1') {
          ev.preventDefault();
          return;
        }
        form.dataset.submitting = '1';
        btn.classList.add('is-pending');
        btn.setAttribute('aria-busy', 'true');
      });
      // Form reset (masalan error qaytganda) lock'ni bo'shatish uchun
      form.addEventListener('reset', function () {
        form.dataset.submitting = '0';
        btn.classList.remove('is-pending');
        btn.removeAttribute('aria-busy');
      });
    });
  }

  // ── Caps-lock hint (password inputlarda) (S13.10) ───────────────────────
  function initCapsLockHints() {
    document.querySelectorAll('input[type="password"]').forEach(function (input) {
      var hintId = input.getAttribute('aria-describedby');
      if (!hintId) return;
      var hint = document.getElementById(hintId);
      if (!hint) return;

      var show = function (on) {
        hint.hidden = !on;
        if (on) hint.setAttribute('role', 'status');
        else hint.removeAttribute('role');
      };

      input.addEventListener('keydown', function (e) {
        var caps = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');
        var active = caps && e.key.length === 1 && /[a-zA-Z]/.test(e.key);
        show(active);
      });
      input.addEventListener('blur', function () { show(false); });
    });
  }

  // ── Show/hide password ──────────────────────────────────────────────────
  function initPasswordToggles() {
    document.querySelectorAll('[data-pw-toggle]').forEach(function (btn) {
      var input = document.getElementById(btn.getAttribute('data-pw-toggle'));
      if (!input) return;
      btn.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        var label = btn.querySelector('[data-pw-toggle-label]');
        if (label) {
          var current = btn.getAttribute('data-label-show') || 'Show';
          var next = btn.getAttribute('data-label-hide') || 'Hide';
          label.textContent = show ? next : current;
          label.setAttribute('data-label-show', show ? current : next);
          label.setAttribute('data-label-hide', show ? next : current);
        }
        input.focus();
      });
    });
  }

  // ── Password strength meter (register) — zxcvbn (NIST, B-27 / D-07) ────
  // NIST SHALL NOT: composition qoidalari YO'Q, periodic rotation yo'q.
  // Client ball faqat UX; server (password-policy.evaluatePassword) yagona truth.
  // D-07 (merge): register.js'da ham idempotent strength meter bor — qaysi biri
  // birinchi ishlasa o'sha egalik qiladi (bar.dataset.strengthInit guard).
  // login.ejs'ning reg tab'ida register.js yuklanmaydi — shuning uchun auth.js
  // ham shu guard bilan himoyalangan: ikki marta init bo'lmaydi.
  function initStrengthMeter() {
    var input = document.querySelector('#reg-password');
    if (!input) return;
    var bar = document.getElementById('pw-strength-bar');
    var hint = document.getElementById('pw-strength-hint');
    if (!bar || !hint) return;
    if (bar.dataset.strengthInit === '1') return; // idempotent (register.js bilan)
    bar.dataset.strengthInit = '1';

    var labels = [];
    try {
      labels = JSON.parse(hint.getAttribute('data-labels') || '[]');
    } catch (_) { /* keep empty */ }
    var requireStrong = !!document.querySelector('.role-card input[name="role"]:checked');
    var roleInputs = document.querySelectorAll('.role-card input[name="role"]');

    function scoreOf(v) {
      if (!v) return 0;
      if (typeof window.zxcvbn === 'function') {
        try { return window.zxcvbn(v).score; } catch (_) { /* fallback */ }
      }
      // zxcvbn yuklanmagan bo'lsa — server bilan bir xil heuristic (fail-soft)
      var s = 0;
      if (v.length >= 12) s++;
      if (/[a-zA-Z]/.test(v)) s++;
      if (/\d/.test(v)) s++;
      if (v.length >= 16 && /[^a-zA-Z0-9]/.test(v)) s++;
      return Math.min(4, s);
    }

    function update() {
      var v = input.value;
      var score = scoreOf(v);
      var need = requireStrong ? 4 : 3;

      var pct = Math.min(100, Math.round((score + 1) * 20));
      bar.style.width = pct + '%';
      bar.style.background = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'][score] || '#22c55e';

      var label = labels[score] || '';
      hint.textContent = label;
      hint.style.color = score >= need ? 'var(--deborah-semantic-color-status-success, #22c55e)' : 'var(--deborah-semantic-color-text-muted, #94a3b8)';

      // Live invalid: NIST min uzunlik (8 MFA / 15 oddiy) — server bilan bir xil.
      // Client faqat UX; server (password-policy.evaluatePassword) yagona truth.
      var minLen = 15;
      var ok = v.length >= minLen && v.length <= 128;
      input.setCustomValidity(ok ? '' : ' ');
    }

    input.addEventListener('input', update);
    roleInputs.forEach(function (r) { r.addEventListener('change', update); });
  }

  // ── Inline errors (role=alert) — server xatosi → field-level reveal ────
  // #auth-alert.err mavjud bo'lganda data-field'ga qarab tegishli input'ni
  // qizil qilamiz va err-text div'ini xato matni bilan to'ldiramiz (A-04).
  function initInlineErrors() {
    var alertEl = document.getElementById('auth-alert');
    var hasServerError = alertEl && alertEl.classList.contains('err');
    if (!hasServerError) return;

    var field = alertEl.getAttribute('data-field') || 'both';
    var message = (alertEl.textContent || '').trim();

    var show = function (input) {
      if (!input) return;
      input.classList.add('inp-error');
      input.setAttribute('aria-invalid', 'true');
    };

    document.querySelectorAll('.err-text[data-inline-error]').forEach(function (errEl) {
      var inputId = errEl.getAttribute('data-inline-error');
      var input = document.getElementById(inputId);
      var isUser = inputId.indexOf('username') !== -1;
      var isPw = inputId.indexOf('password') !== -1;
      var matches = field === 'both' || (field === 'username' && isUser) || (field === 'password' && isPw);
      if (!matches) return;
      show(input);
      var span = errEl.querySelector('span');
      if (span && message) span.textContent = message;
      errEl.style.display = 'flex';
      errEl.setAttribute('role', 'alert');
    });

    // Xato matni authoritative: #auth-alert (aria-live).
    alertEl.setAttribute('role', 'alert');
    alertEl.setAttribute('aria-live', 'assertive');
  }

  // ── Inline error clearing (D-07) — yozish boshlanganda xato tozalanadi ──
  // "Error → yechim" UX: input'ga yozish bilan inp-error/aria-invalid
  // o'chadi va err-text yashirinadi (server xatosi shu zahoti o'chmaydi —
  // #auth-alert o'zgarishsiz qoladi, faqat field-level ko'rsatkich tozalanadi).
  function initInlineErrorClear() {
    document.querySelectorAll('.err-text[data-inline-error]').forEach(function (errEl) {
      var inputId = errEl.getAttribute('data-inline-error');
      var input = document.getElementById(inputId);
      if (!input) return;
      input.addEventListener('input', function () {
        if (!input.classList.contains('inp-error')) return;
        input.classList.remove('inp-error');
        input.setAttribute('aria-invalid', 'false');
        errEl.style.display = 'none';
      });
    });
  }

  // ── Lockout countdown (A-03, D-07 — birlashtirilgan) ────────────────────
  // Server `retryAfter`/`lockout` qaytarganda: barcha auth formani bloklaydi,
  // qolgan vaqtni (m:ss) ko'rsatadi, tugagach yana ochadi. Ilgari login.ejs'da
  // inline dublikat script bor edi — ikki timer raqobatlashar edi. Endi bitta
  // funksiya: login.ejs (data-lockout-text/time/hint + data-copy) va
  // register.ejs (soddaroq box — textContent) ikkalasi ham shu bilan ishlaydi.
  function initLockoutCountdown() {
    var el = document.getElementById('lockout-countdown');
    if (!el) return;
    var seconds = parseInt(el.getAttribute('data-seconds') || '0', 10);
    if (seconds <= 0) return;
    if (el.getAttribute('data-countdown-started') === '1') return; // idempotent
    el.setAttribute('data-countdown-started', '1');

    var copy = {};
    try { copy = JSON.parse(el.getAttribute('data-copy') || '{}'); } catch (_) { /* keep {} */ }

    var textEl = el.querySelector('[data-lockout-text]');
    var timeEl = el.querySelector('[data-lockout-time]');
    var hintEl = el.querySelector('[data-lockout-hint]');
    var forms = document.querySelectorAll('.auth-form');
    var controls = document.querySelectorAll('.auth-form button, .auth-form input');
    var buttons = document.querySelectorAll('.auth-submit');

    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function disable(on) {
      controls.forEach(function (f) { f.disabled = on; });
      buttons.forEach(function (b) { b.disabled = on; });
      forms.forEach(function (f) { f.classList.toggle('is-locked', on); });
    }

    function render() {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      var time = m + ':' + pad(s);
      if (timeEl) timeEl.textContent = time;
      if (textEl && copy.locked) textEl.textContent = copy.locked;
      if (hintEl && copy.support) hintEl.textContent = copy.support;
      // register.ejs kabi oddiy box (ichki span'larsiz) — matn+vaqt
      if (!timeEl && !textEl && el.textContent) {
        el.textContent = (copy.locked ? copy.locked + ' ' : '') + time;
      }
    }

    disable(true);
    render();
    var t = setInterval(function () {
      seconds -= 1;
      if (seconds <= 0) {
        clearInterval(t);
        disable(false);
        el.style.display = 'none';
        return;
      }
      render();
    }, 1000);
  }
})();
