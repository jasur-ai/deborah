/**
 * Deborah — Reset password page client UX (plan_login §5)
 * ------------------------------------------------------
 * - Password show/hide toggle
 * - Strength meter (min 8 + letter + digit)
 * - Inline error reveal on server error
 *
 * Progressive enhancement: no-JS holatda forma to'liq ishlaydi.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    initPasswordToggles();
    initStrengthMeter();
    initInlineErrors();
  });

  // ── Show/hide password ──
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
          var showLabel = btn.getAttribute('data-label-show') || 'Show';
          var hideLabel = btn.getAttribute('data-label-hide') || 'Hide';
          label.textContent = show ? hideLabel : showLabel;
        }
        input.focus();
      });
    });
  }

  // ── Password strength meter ──
  function initStrengthMeter() {
    var input = document.getElementById('reset-password');
    if (!input) return;
    var bar = document.getElementById('pw-strength-bar');
    var hint = document.getElementById('pw-strength-hint');
    if (!bar || !hint) return;

    var labels = [];
    try {
      labels = JSON.parse(hint.getAttribute('data-labels') || '[]');
    } catch (_) { /* keep empty */ }

    input.addEventListener('input', function () {
      var v = input.value;
      var score = 0;
      if (v.length >= 8) score++;
      if (/[a-zA-Z]/.test(v)) score++;
      if (/\d/.test(v)) score++;
      if (v.length >= 12 && /[^a-zA-Z0-9]/.test(v)) score++;

      var pct = Math.min(100, score * 25);
      bar.style.width = pct + '%';
      bar.style.background = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'][score] || '#22c55e';

      var label = labels[score] || '';
      hint.textContent = label;
      hint.style.color = score >= 3 ? 'var(--deborah-semantic-color-status-success, #22c55e)' : 'var(--deborah-semantic-color-text-muted, #94a3b8)';

      var ok = v.length >= 8 && /[a-zA-Z]/.test(v) && /\d/.test(v);
      input.setCustomValidity(ok ? '' : ' ');
    });
  }

  // ── Inline errors ──
  function initInlineErrors() {
    var alertEl = document.getElementById('auth-alert');
    if (!alertEl || !alertEl.classList.contains('err')) return;

    document.querySelectorAll('input[data-inline-error]').forEach(function (el) {
      el.classList.add('inp-error');
      el.setAttribute('aria-invalid', 'true');
    });
    alertEl.setAttribute('role', 'alert');
    alertEl.setAttribute('aria-live', 'assertive');
  }
})();
