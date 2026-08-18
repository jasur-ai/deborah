/**
 * Deborah — Auth client validation (AUTH D-29 §06/§26/§27/§28)
 * ---------------------------------------------------------------------------
 * Qoidalar MANBAYI: GET /api/auth/validation-rules — contracts.js'dagi SHARED
 * Zod schemas'dan toJSONSchema() orqali chiqariladi. Klient qoidani qo'lda
 * takrorlamaydi (duplicate yo'q); server yagona truth.
 *
 *  - validate(form, field, value) → { ok, error }  (rule-based)
 *  - Blur'da tekshiradi (login — §28 xato kam), change'da (register — §28)
 *  - aria-invalid + aria-describedby (mavjud data-inline-error elementiga)
 *  - Fail-soft: qoidalar yuklanmasa/network xatosi bo'lsa hech narsa bloklamaydi
 *    (server double validation — client UX, server security).
 */
(function () {
  'use strict';

  var rules = null;
  var rulesVersion = null;
  var loaded = false;

  // login formadagi `username` → contracts loginSchema.identifier (D-30 kontrakt)
  var FIELD_MAP = {
    login: { username: 'identifier', password: 'password' },
    register: { username: 'username', email: 'email', password: 'password', name: 'name' },
  };

  function loadRules() {
    if (loaded) return Promise.resolve(rules);
    loaded = true;
    return fetch('/api/auth/validation-rules', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok) { rules = j.forms || {}; rulesVersion = j.version || null; }
        return rules;
      })
      .catch(function () { rules = null; return null; });
  }

  function fieldRules(form, field) {
    if (!rules || !rules[form]) return null;
    var mapped = (FIELD_MAP[form] && FIELD_MAP[form][field]) || field;
    return rules[form][mapped] || null;
  }

  /** Qoida bo'yicha tekshirish. @returns {{ok: boolean, error: string|null}} */
  function validate(form, field, value) {
    var r = fieldRules(form, field);
    if (!r) return { ok: true, error: null }; // noma'lum maydon — server hal qiladi
    if (r.required && (value === undefined || value === null || value === '')) {
      return { ok: false, error: 'required' };
    }
    if (value === undefined || value === null || value === '') {
      return { ok: true, error: null }; // ixtiyoriy bo'sh
    }
    var s = String(value);
    if (r.minLength && s.length < r.minLength) return { ok: false, error: 'minLength' };
    if (r.maxLength && s.length > r.maxLength) return { ok: false, error: 'maxLength' };
    if (r.pattern) {
      var re;
      try { re = new RegExp(r.pattern); } catch (_) { return { ok: true, error: null }; }
      if (!re.test(s)) return { ok: false, error: 'pattern' };
    }
    if (r.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
      return { ok: false, error: 'email' };
    }
    return { ok: true, error: null };
  }

  /** Input'ga aria-invalid + inline xato elementini boshqaradi. */
  function applyToInput(input, form, field, eventName) {
    input.addEventListener(eventName, function () {
      if (!rules) return; // hali yuklanmagan — tekshirmaymiz (server qiladi)
      var v = input.value;
      var res = validate(form, field, v);
      input.setAttribute('aria-invalid', res.ok ? 'false' : 'true');
      var errEl = document.getElementById(input.getAttribute('data-inline-error') || '');
      if (errEl) {
        if (!res.ok) {
          errEl.textContent = res.error; // i18n server tomonda; client error kod
          errEl.style.display = 'block';
        } else {
          errEl.style.display = 'none';
        }
      }
    });
  }

  function init() {
    loadRules();

    // Login (blur — §28) / Register (change — §28)
    var loginUsername = document.getElementById('login-username');
    var loginPassword = document.getElementById('login-password');
    if (loginUsername) applyToInput(loginUsername, 'login', 'username', 'blur');
    if (loginPassword) applyToInput(loginPassword, 'login', 'password', 'blur');

    var regUsername = document.getElementById('reg-username');
    var regEmail = document.getElementById('reg-email');
    var regPassword = document.getElementById('reg-password');
    if (regUsername) applyToInput(regUsername, 'register', 'username', 'change');
    if (regEmail) applyToInput(regEmail, 'register', 'email', 'change');
    if (regPassword) applyToInput(regPassword, 'register', 'password', 'change');
  }

  window.DeborahValidation = {
    loadRules: loadRules,
    validate: validate,
    getRules: function () { return rules; },
    getVersion: function () { return rulesVersion; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
