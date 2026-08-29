/**
 * Deborah — Passkey login client (AUTH A-27)
 *
 * Ikkala usul (reddit PSA):
 *   1. Conditional UI — `autocomplete="username webauthn"` + page-load init
 *      (mediation: 'conditional'), user hech narsa bosmaydi.
 *   2. Modal tugma "Passkey bilan kirish" — platform authenticator
 *      (YubiKey / boshqa qurilma / cross-device) uchun.
 *
 * Feature detection:
 *   - isConditionalMediationAvailable() → Conditional UI
 *   - isUserVerifyingPlatformAuthenticatorAvailable() → modal tugma
 *
 * Server JSON options ishlatiladi (simplewebauthn v13 formati); native
 * WebAuthn API base64url → ArrayBuffer konvertatsiyasini talab qiladi.
 * Raw biometric serverga YUBORILMAYDI (WebAuthn spec — faqat signaturа).
 */
(function () {
  'use strict';

  if (!window.PublicKeyCredential) return;

  var container = document.getElementById('passkey-login');
  var btn = document.getElementById('passkey-login-btn');
  var hint = document.getElementById('passkey-login-hint');
  var formLogin = document.getElementById('form-login');
  var tabLogin = document.getElementById('tab-login');
  var tabReg = document.getElementById('tab-reg');

  var csrfEl = document.querySelector('#form-login [name="_csrf"]');
  var csrf = csrfEl ? csrfEl.value : '';

  // i18n xabarlar (EJS JSON.stringify orqali beriladi)
  var copy = {};
  try { copy = JSON.parse(container.getAttribute('data-copy') || '{}'); } catch (_) {}
  copy.error = copy.error || 'Kirishda xatolik. Parol bilan urinib ko\'ring.';
  copy.rate = copy.rate || 'Ko\'p urinishlar — biroz kuting.';

  var inFlight = false;

  // ── base64url <-> ArrayBuffer (native WebAuthn konvertatsiyasi) ──
  function b64urlToBuf(s) {
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function bufToB64url(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // v13 server options to'g'ridan-to'g'ri qaytaradi ({ publicKey } wrapper'siz)
  function prepGetOptions(opts) {
    opts.challenge = b64urlToBuf(opts.challenge);
    if (opts.allowCredentials && opts.allowCredentials.length) {
      opts.allowCredentials.forEach(function (c) { c.id = b64urlToBuf(c.id); });
    }
    return opts;
  }

  function authToJSON(cred) {
    return {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        authenticatorData: bufToB64url(cred.response.authenticatorData),
        signature: bufToB64url(cred.response.signature),
        userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : undefined,
      },
      clientExtensionResults: cred.getClientExtensionResults
        ? cred.getClientExtensionResults()
        : {},
    };
  }

  function isLoginTabActive() {
    return formLogin && formLogin.classList.contains('is-active');
  }

  function syncVisibility() {
    if (!container) return;
    if (isLoginTabActive()) container.hidden = false;
    else container.hidden = true;
  }

  function msg(text) { if (hint) hint.textContent = text; }

  async function passkeyAuth(conditional) {
    if (inFlight) return;
    inFlight = true;
    if (btn) btn.disabled = true;
    msg('');
    try {
      var o = await fetch('/api/passkey/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: '{}',
      });
      if (o.status === 429) { msg(copy.rate); return; }
      var data = await o.json().catch(function () { return {}; });
      if (!data.ok || !data.options) { msg(copy.error); return; }

      var publicKey = prepGetOptions(data.options);
      var cred = await navigator.credentials.get({
        publicKey: publicKey,
        mediation: conditional ? 'conditional' : undefined,
      });
      if (!cred) return; // user bekor qildi — jim

      var v = await fetch('/api/passkey/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ response: authToJSON(cred) }),
      });
      var vd = await v.json().catch(function () { return {}; });
      if (v.ok && vd.ok) { window.location.href = vd.redirect || '/user/panel'; return; }
      msg((vd && vd.message) || copy.error);
    } catch (e) {
      // AbortError = user autofill'da bekor qildi — jim o'tamiz
      if (!(e && (e.name === 'AbortError' || e.name === 'NotAllowedError'))) {
        msg(copy.error);
      }
    } finally {
      inFlight = false;
      if (btn) btn.disabled = false;
      syncVisibility();
    }
  }

  if (btn) btn.addEventListener('click', function () { passkeyAuth(false); });
  if (tabLogin) tabLogin.addEventListener('click', function () {
    syncVisibility();
    setTimeout(function () { if (!inFlight && isLoginTabActive()) passkeyAuth(true); }, 60);
  });
  if (tabReg) tabReg.addEventListener('click', syncVisibility);

  // ── Feature detection + init ──
  (async function init() {
    var conditionalSupported = false;
    try {
      if (window.PublicKeyCredential.isConditionalMediationAvailable) {
        conditionalSupported = await window.PublicKeyCredential.isConditionalMediationAvailable();
      }
    } catch (_) { /* ignore */ }

    if (conditionalSupported) {
      // Login tab faol bo'lsa darhol Conditional UI ishga tushadi
      if (isLoginTabActive()) passkeyAuth(true);
      else syncVisibility();
      return;
    }

    // Modal tugma — platform authenticator (biometrik / YubiKey) bormi
    try {
      if (window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        var avail = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (avail && isLoginTabActive()) container.hidden = false;
      }
    } catch (_) { /* ignore */ }
  })();
})();
