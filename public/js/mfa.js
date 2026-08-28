/**
 * Deborah — MFA login step (D-08 §08)
 * ====================================
 * views/user/mfa.ejs uchun client UX:
 *   - 6 ta single-digit TOTP input (avto-fokus, o'ng/backspace navigatsiya,
 *     paste orqali to'liq kod, OTP autofill autocomplete="one-time-code")
 *   - backup code toggle ("boshqa usul" — 10 xonali)
 *   - resend: challenge qayta yuborish (server /api/mfa/resend) + countdown
 *   - rate limit: 429 locked → qolgan vaqt xabari + input blok
 *   - submit: faqat to'liq kod bo'lsa; dublikat submit blok; spinner
 *
 * Progressive enhancement: no-JS holatda forma (bitta input) to'liq ishlaydi
 * — bu fayl faqat single-digit UX'ni qo'shadi.
 *
 * Xavfsizlik: kod hech qachon localStorage/JS global'da qolmaydi (faqat
 * fetch body'da); CSRF header `x-csrf-token`.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('mfa-form');
    if (!form) return;

    var inputs = Array.prototype.slice.call(form.querySelectorAll('input[data-digit]'));
    var singleDigits = inputs.length > 0; // single-digit UX aktiv
    var useBackupMode = false; // backup toggle ishlatilganmi
    var backupField = document.getElementById('mfa-backup-input');
    var useBackupBtn = document.getElementById('mfa-use-backup');
    var useTotpBtn = document.getElementById('mfa-use-totp');
    var submitBtn = document.getElementById('mfa-submit');
    var errBox = document.getElementById('mfa-error');
    var lockBox = document.getElementById('mfa-locked');
    var resendBtn = document.getElementById('mfa-resend');
    var challengeId = form.getAttribute('data-challenge-id') || '';
    var csrf = window.__CSRF_TOKEN || '';
    var submitting = false;

    // ── Single-digit navigation (D-08) ──────────────────────────────────
    function focusDigit(i) {
      if (i >= 0 && i < inputs.length) inputs[i].focus();
    }

    function digitValue() {
      return inputs.map(function (el) { return el.value || ''; }).join('');
    }

    inputs.forEach(function (inp, i) {
      inp.addEventListener('input', function () {
        var v = inp.value.replace(/\D/g, ''); // faqat raqam
        inp.value = v.slice(0, 1);
        if (v.length >= 1 && i < inputs.length - 1) focusDigit(i + 1);
        else if (digitValue().length === inputs.length) submitBtn && submitBtn.focus();
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !inp.value && i > 0) { focusDigit(i - 1); return; }
        if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); focusDigit(i - 1); }
        if (e.key === 'ArrowRight' && i < inputs.length - 1) { e.preventDefault(); focusDigit(i + 1); }
      });
      inp.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (!text) return;
        var start = i;
        for (var j = 0; j < text.length && start + j < inputs.length; j++) {
          inputs[start + j].value = text[j];
        }
        if (start + text.length >= inputs.length) submitBtn && submitBtn.focus();
        else focusDigit(start + text.length);
      });
    });

    // ── Backup toggle (D-08) ─────────────────────────────────────────────
    function showBackup(on) {
      if (!backupField) return;
      useBackupMode = on;
      if (on) {
        inputs.forEach(function (el) { el.hidden = true; el.disabled = true; });
        backupField.hidden = false;
        backupField.disabled = false;
        if (useTotpBtn) useTotpBtn.hidden = false;
        if (useBackupBtn) useBackupBtn.hidden = true;
        backupField.focus();
      } else {
        inputs.forEach(function (el) { el.hidden = false; el.disabled = false; });
        backupField.hidden = true;
        backupField.disabled = true;
        if (useTotpBtn) useTotpBtn.hidden = true;
        if (useBackupBtn) useBackupBtn.hidden = false;
        focusDigit(0);
      }
    }
    if (useBackupBtn) useBackupBtn.addEventListener('click', function () { showBackup(true); });
    if (useTotpBtn) useTotpBtn.addEventListener('click', function () { showBackup(false); });

    // ── Error/lock display ───────────────────────────────────────────────
    function showErr(msg) {
      if (!errBox) return;
      errBox.textContent = msg;
      errBox.hidden = false;
    }
    function hideErr() { if (errBox) errBox.hidden = true; }

    function lockUI(retrySeconds) {
      if (!lockBox) return;
      var mins = Math.ceil(retrySeconds / 60);
      var msg = form.getAttribute('data-locked-tpl') || '';
      msg = msg.replace('__m__', String(mins));
      lockBox.textContent = msg;
      lockBox.hidden = false;
      form.querySelectorAll('button, input').forEach(function (el) { el.disabled = true; });
    }

    // ── Submit ───────────────────────────────────────────────────────────
    function submit() {
      if (submitting) return;
      var code = useBackupMode ? (backupField ? backupField.value.trim() : '') : digitValue();
      if (code.length < 6) { showErr(form.getAttribute('data-code-short') || 'Enter the full code'); return; }

      submitting = true;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('is-pending'); }
      hideErr();

      fetch('/api/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ code: code, challengeId: challengeId }),
      })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
        .then(function (res) {
          var data = res.data || {};
          if (res.status === 200 && data.ok) {
            window.location.href = data.redirectTo || '/user/panel';
            return;
          }
          if (data.error === 'locked') {
            lockUI(Number(data.retryAfterSeconds) || 900);
            return;
          }
          // BUG-015: aniq, amalga yo'naltirilgan xabarlar (xom kod emas)
          if (data.error === 'no_pending_challenge' || res.status === 401) {
            showErr(form.getAttribute('data-expired') || 'The code request expired — please sign in again.');
            setTimeout(function () { window.location.href = '/user/login'; }, 2200);
            return;
          }
          showErr(data.error === 'invalid_code' || data.error === 'challenge_invalid'
            ? (form.getAttribute('data-invalid-code') || 'Invalid code')
            : (data.error === 'no_pending_challenge' ? (form.getAttribute('data-expired') || 'Expired') : (data.error || 'error')));
          if (singleDigits) focusDigit(0);
        })
        .catch(function () { showErr(form.getAttribute('data-network') || 'Connection error'); })
        .finally(function () {
          submitting = false;
          if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('is-pending'); }
        });
    }

    if (submitBtn) submitBtn.addEventListener('click', submit);
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

    // ── Resend (D-08) ────────────────────────────────────────────────────
    if (resendBtn) {
      var resendTimer = null;
      function startResendCountdown(seconds) {
        var tpl = resendBtn.getAttribute('data-resend-tpl') || '';
        resendBtn.disabled = true;
        var left = seconds;
        var tick = function () {
          if (left <= 0) {
            resendBtn.disabled = false;
            resendBtn.textContent = resendBtn.getAttribute('data-resend-label') || '';
            return;
          }
          resendBtn.textContent = tpl.replace('__s__', String(left));
          left -= 1;
          resendTimer = setTimeout(tick, 1000);
        };
        tick();
      }
      resendBtn.addEventListener('click', function () {
        if (resendBtn.disabled) return;
        fetch('/api/mfa/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ challengeId: challengeId }),
        })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (data) {
            if (data && data.ok) {
              // D-08: yangi challenge (TTL yangilandi) — form attribute'ni yangilaymiz
              if (data.challengeId) {
                challengeId = data.challengeId;
                form.setAttribute('data-challenge-id', challengeId);
              }
              hideErr();
              startResendCountdown(60);
            }
            else showErr(data && data.error === 'locked'
              ? (form.getAttribute('data-locked-tpl') || '')
              : (form.getAttribute('data-network') || 'Connection error'));
          })
          .catch(function () { showErr(form.getAttribute('data-network') || 'Connection error'); });
      });
    }
  });
})();
