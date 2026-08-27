/**
 * Deborah — Register sahifasi (AUTH B-03)
 * ---------------------------------------
 * auth.js bilan birga yuklanadi (tablar, parol toggle, caps-lock, strength
 * meter, submit lock, lockout countdown — hammasi auth.js'da). Bu fayl
 * register sahifasiga xos bo'lganlarni bajaradi:
 *   - rol kartalari (talaba/teacher) → teacher note ko'rsatish
 *   - invite kod maydonini ochish/yopish (aria-expanded)
 *   - inline error'lar — auth.js faqat username/password'ni ko'rsatadi;
 *     name/email/invite maydonlarini shu yerda field'ga qarab ko'rsatamiz
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    // ── Rol kartalari → teacher note + application form (A-19/B-29) ──
    var roleInputs = document.querySelectorAll('.role-card input[name="role"]');
    var teacherNote = document.getElementById('teacher-note');
    var teacherFields = document.getElementById('teacher-app-fields');
    var roleWasTeacher = false;
    function syncRoleNote() {
      if (!teacherNote) return;
      var checked = document.querySelector('.role-card input[name="role"]:checked');
      var isTeacher = !!(checked && checked.value === 'teacher');
      teacherNote.hidden = !isTeacher;
      // B-29: teacher → application maydonlari ko'rinadi; student'da yashirin
      if (teacherFields) teacherFields.hidden = !isTeacher;
      if (isTeacher && !roleWasTeacher) {
        // Rol endi teacher — maydonlarni required qilamiz (universitet majburiy)
        var u = document.getElementById('reg-university');
        if (u) { u.required = true; u.setAttribute('aria-required', 'true'); }
      } else if (!isTeacher && roleWasTeacher) {
        var u2 = document.getElementById('reg-university');
        if (u2) { u2.required = false; u2.setAttribute('aria-required', 'false'); }
      }
      roleWasTeacher = isTeacher;
    }
    roleInputs.forEach(function (r) {
      r.addEventListener('change', syncRoleNote);
    });
    syncRoleNote();

    // ── Invite toggle (yig'iladigan maydon) ──
    var inviteBtn = document.getElementById('invite-toggle');
    var inviteFields = document.getElementById('invite-fields');
    if (inviteBtn && inviteFields) {
      inviteBtn.addEventListener('click', function () {
        var open = inviteFields.hidden;
        inviteFields.hidden = !open;
        inviteBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          var input = document.getElementById('reg-invite');
          if (input) input.focus();
        }
      });
      // Server xatosi invite'da bo'lsa — maydonni avtomatik ochamiz
      var alertEl = document.getElementById('auth-alert');
      if (alertEl && alertEl.getAttribute('data-field') === 'invite') {
        inviteFields.hidden = false;
        inviteBtn.setAttribute('aria-expanded', 'true');
      }
    }

    // ── AUTH B-05: email real-time validatsiya (blur) ──
    // POST /api/validate/email (backend tekshiradi — client off → server check).
    // Typo suggestion: 'gmial.com o\'rniga gmail.com demoqchimisiz?' (bosilsa
    // domen tuzatiladi); disposable: inline xato ko'rsatiladi (hard block).
    var emailInput = document.getElementById('reg-email');
    if (emailInput) {
      var suggestBox = document.getElementById('email-suggest');
      var suggestBtn = document.getElementById('email-suggest-btn');
      var suggestSpan = suggestBtn ? suggestBtn.querySelector('span') : null;
      var emailErr = document.getElementById('err-reg-email');
      var emailErrSpan = emailErr ? emailErr.querySelector('span') : null;
      var typoTpl = suggestBox ? (suggestBox.getAttribute('data-typo-tpl') || 'Did you mean %s?') : '';
      var disposableMsg = emailInput.getAttribute('data-disposable') || '';
      var checkingMsg = emailInput.getAttribute('data-checking') || '';
      var availableMsg = emailInput.getAttribute('data-available') || '';
      var emailStatus = document.getElementById('email-status');
      var debounceTimer = null;
      var lastEmailCheck = 0;
      var lastCheckedEmail = '';

      function showEmailStatus(text) {
        if (!emailStatus) return;
        if (text) {
          emailStatus.textContent = text;
          emailStatus.hidden = false;
        } else {
          emailStatus.hidden = true;
          emailStatus.textContent = '';
        }
      }

      function clearEmailErrors() {
        if (emailErr) {
          emailErr.style.display = 'none';
          emailInput.classList.remove('inp-error');
          emailInput.setAttribute('aria-invalid', 'false');
        }
        if (suggestBox) suggestBox.hidden = true;
      }

      function runEmailCheck() {
        var v = emailInput.value.trim();
        if (v !== lastCheckedEmail) clearEmailErrors();
        if (v.length < 3 || v.indexOf('@') === -1) return;
        if (v === lastCheckedEmail) return;
        lastCheckedEmail = v;
        showEmailStatus(checkingMsg);

        fetch('/api/validate/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN || '',
          },
          body: JSON.stringify({ email: v }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (emailInput.value.trim() !== v) return; // eskirgan javob
            showEmailStatus('');
            if (!data || typeof data.ok === 'undefined') return;
            // Disposable → hard block xabari (emailDisposable)
            if (data.reason === 'disposable' && emailErr && emailErrSpan && disposableMsg) {
              emailErrSpan.textContent = disposableMsg;
              emailErr.style.display = 'flex';
              emailInput.classList.add('inp-error');
              emailInput.setAttribute('aria-invalid', 'true');
            } else if (data.ok && availableMsg && !data.suggestion) {
              // D-07: yaxshi email → mavjud ✓ (typo taklifi yo'q bo'lsa)
              showEmailStatus(availableMsg);
            }
            // Typo → taklif ko'rsatish (bosilsa domen tuzatiladi)
            if (data.suggestion && suggestBox && suggestSpan) {
              suggestSpan.textContent = typoTpl.replace('%s', data.suggestion);
              suggestBox.hidden = false;
              if (suggestBtn) {
                suggestBtn.onclick = function () {
                  var at = emailInput.value.lastIndexOf('@');
                  if (at > -1) {
                    emailInput.value = emailInput.value.slice(0, at + 1) + data.suggestion;
                    emailInput.setCustomValidity('');
                    emailInput.classList.remove('inp-error');
                    emailInput.setAttribute('aria-invalid', 'false');
                    if (emailErr) emailErr.style.display = 'none';
                    suggestBox.hidden = true;
                    showEmailStatus('');
                    lastCheckedEmail = ''; // tuzatilgan qiymatni qayta tekshiramiz
                    scheduleEmailCheck();
                    emailInput.focus();
                  }
                };
              }
            }
          })
          .catch(function () {
            if (emailInput.value.trim() !== v) return;
            showEmailStatus(''); // fail-soft: tekshiruv UI buzmaydi
          });
      }

      function scheduleEmailCheck() {
        // D-07: 300ms debounce — har input'da timer qayta o'rnatiladi,
        // yozish to'xtagach bitta so'rov yuboriladi.
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runEmailCheck, 300);
      }

      emailInput.addEventListener('input', scheduleEmailCheck);
      emailInput.addEventListener('blur', function () {
        // Blur'da darhol yakuniy tekshiruv (debounce'ni kutmaymiz)
        clearTimeout(debounceTimer);
        runEmailCheck();
      });
    }

    // ── B-27 + D-07: password strength meter (zxcvbn) ──
    // NIST SHALL NOT: composition qoidalari YO'Q (katta+kichik+raqam majburiy emas),
    // periodic rotation yo'q. Baholash zxcvbn orqali 0-4 ball — server bilan bir xil
    // (password-policy.evaluatePassword). Client ball faqat UX; server yagona truth.
    // (Eslatma: auth.js'dagi eski initStrengthMeter wsl tomonidan olib tashlanadi —
    //  strength meter endi register.js'da, D-07 bo'linishi bo'yicha.)
    var pwInput2 = document.getElementById('reg-password');
    var pwBar = document.getElementById('pw-strength-bar');
    var pwHint = document.getElementById('pw-strength-hint');
    if (pwInput2 && pwBar && pwHint && !pwBar.dataset.strengthInit) {
      pwBar.dataset.strengthInit = '1'; // idempotent — ikki marta init bo'lmasin
      var strengthLabels = [];
      try {
        strengthLabels = JSON.parse(pwHint.getAttribute('data-labels') || '[]');
      } catch (_) { /* keep empty */ }
      var requireStrong = !!document.querySelector('.role-card input[name="role"]:checked');
      var roleInputs2 = document.querySelectorAll('.role-card input[name="role"]');

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

      function updateStrength() {
        var v = pwInput2.value;
        var score = scoreOf(v);
        var need = requireStrong ? 4 : 3;
        var pct = Math.min(100, Math.round((score + 1) * 20));
        pwBar.style.width = pct + '%';
        pwBar.style.background = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'][score] || '#22c55e';
        var label = strengthLabels[score] || '';
        pwHint.textContent = label;
        pwHint.style.color = score >= need ? 'var(--deborah-semantic-color-status-success, #22c55e)' : 'var(--deborah-semantic-color-text-muted, #94a3b8)';
        // Live invalid: NIST min uzunlik (15) — server yagona manba
        var ok = v.length >= 15 && v.length <= 128;
        pwInput2.setCustomValidity(ok ? '' : ' ');
      }

      pwInput2.addEventListener('input', updateStrength);
      roleInputs2.forEach(function (r) { r.addEventListener('change', updateStrength); });
    }

    // ── AUTH A-21 + D-07: honeypot guard (submit'da) ──
    // #reg-website honeypot — CSS'da ko'rinmaydi, bot'lar to'ldiradi.
    // Bot bo'lsa submit'ni bloklaymiz (server ham tekshiradi — double guard).
    var formReg = document.getElementById('form-reg');
    var honeyInput = document.getElementById('reg-website');
    if (formReg && honeyInput) {
      formReg.addEventListener('submit', function (ev) {
        if (honeyInput.value && honeyInput.value.trim() !== '') {
          ev.preventDefault();
          ev.stopImmediatePropagation();
        }
      });
    }

    // ── B-27: inline HIBP breach check (NIST) ──
    // Parol yuborilmaydi — client SHA-1 hash'ini hisoblaydi (Web Crypto),
    // server HIBP'ga faqat prefix'ni so'raydi. Breach bo'lsa inline xato +
    // submit blok; HIBP offline bo'lsa yumshoq o'tish (blok emas).
    var pwInput = document.getElementById('reg-password');
    var pwErr = document.getElementById('err-reg-password');
    var breachChecked = false;
    if (pwInput && pwErr && window.__CSRF_TOKEN && window.crypto && window.crypto.subtle) {
      var breachDebounce = null;
      var breachPending = false;
      var lastBreachSha = '';
      var breachMsg = pwErr.getAttribute('data-breach-msg') || '';

      function sha1Hex(str) {
        // Web Crypto SHA-1 — parol hech qachon tarmoqqa chiqmaydi
        var data = new TextEncoder().encode(str);
        return window.crypto.subtle.digest('SHA-1', data).then(function (buf) {
          var hex = '';
          var bytes = new Uint8Array(buf);
          for (var i = 0; i < bytes.length; i++) {
            hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
          }
          return hex.toUpperCase();
        });
      }

      function markBreach(sha1) {
        breachChecked = true;
        lastBreachSha = sha1;
        pwInput.classList.add('inp-error');
        pwInput.setAttribute('aria-invalid', 'true');
        pwInput.setAttribute('aria-describedby', (pwInput.getAttribute('aria-describedby') || '') + ' err-reg-password');
        var span = pwErr.querySelector('span');
        if (span && breachMsg) span.textContent = breachMsg;
        pwErr.style.display = 'flex';
        pwErr.setAttribute('role', 'alert');
      }

      function clearBreach(sha1) {
        if (lastBreachSha === sha1) {
          pwInput.classList.remove('inp-error');
          pwInput.setAttribute('aria-invalid', 'false');
          pwErr.style.display = 'none';
        }
      }

      pwInput.addEventListener('input', function () {
        var v = pwInput.value;
        clearTimeout(breachDebounce);
        // Parol o'zgarganda eski breach holatini tozalaymiz
        if (lastBreachSha && v) {
          sha1Hex(v).then(function (h) {
            if (h !== lastBreachSha) {
              pwInput.classList.remove('inp-error');
              pwInput.setAttribute('aria-invalid', 'false');
              pwErr.style.display = 'none';
            }
          });
        }
        // Yozish to'xtagandan keyin tekshiramiz (debounce 700ms)
        breachDebounce = setTimeout(function () {
          if (!v || v.length < 8 || breachPending) return;
          breachPending = true;
          sha1Hex(v).then(function (sha) {
            if (sha === lastBreachSha) { breachPending = false; return; }
            return fetch('/api/validate/password-breach', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': window.__CSRF_TOKEN,
              },
              body: JSON.stringify({ sha1: sha }),
            })
              .then(function (r) { return r.json(); })
              .then(function (data) {
                if (data && data.breached) markBreach(sha);
                else clearBreach(sha);
              })
              .catch(function () { /* HIBP offline — fail-open */ })
              .finally(function () { breachPending = false; });
          });
        }, 700);
      });
    }

    // ── Inline error'lar (name/email/invite — auth.js qamrab olmaydi) ──
    var alertEl = document.getElementById('auth-alert');
    var hasServerError = alertEl && alertEl.classList.contains('err');
    if (hasServerError) {
      var field = alertEl.getAttribute('data-field') || 'both';
      var message = (alertEl.textContent || '').trim();

      document.querySelectorAll('.err-text[data-inline-error]').forEach(function (errEl) {
        var inputId = errEl.getAttribute('data-inline-error');
        var input = document.getElementById(inputId);
        if (!input) return;
        // field='both' → hammasi; aks holda input name'iga mos kelishi shart
        var matches = field === 'both' || field === input.name;
        if (!matches) return;
        input.classList.add('inp-error');
        input.setAttribute('aria-invalid', 'true');
        var span = errEl.querySelector('span');
        if (span && message) span.textContent = message;
        errEl.style.display = 'flex';
        errEl.setAttribute('role', 'alert');
      });
    }
  });
})();
