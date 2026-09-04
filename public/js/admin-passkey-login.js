/**
 * Deborah — Admin Passkey Login client (S35)
 *
 * /admin/login sahifasidan parolsiz "Passkey bilan kirish".
 * - Passkey faqat admin profilida ro'yxatdan o'tkazilgan bo'lsa ko'rsatiladi
 *   (GET /api/admin/passkey/login/status — available).
 * - Oqim: options (allowCredentials = admin passkeylari) → native WebAuthn
 *   navigator.credentials.get (biometriya / YubiKey / boshqa qurilma) → verify
 *   → server admin sessiya grant qiladi → /admin/dashboard.
 * - CSRF: login formasidagi yashirin _csrf inputdan olinadi (global validateCsrf).
 * - Raw biometric hech qachon serverga yuborilmaydi (WebAuthn spec).
 */
(function () {
  'use strict';

  if (!window.PublicKeyCredential) return;

  var container = document.getElementById('admin-passkey-login');
  var btn = document.getElementById('admin-passkey-login-btn');
  var hint = document.getElementById('admin-passkey-login-hint');
  if (!container || !btn) return;

  var csrfEl = document.querySelector('#admin-passkey-login [name="_csrf"]') ||
               document.querySelector('form [name="_csrf"]');
  var csrf = csrfEl ? csrfEl.value : '';

  var copy = {};
  try { copy = JSON.parse(container.getAttribute('data-copy') || '{}'); } catch (_) {}
  copy.error = copy.error || 'Passkey xatosi. Qayta urinib ko\'ring.';
  copy.rate = copy.rate || 'Ko\'p urinishlar — biroz kuting.';
  copy.none = copy.none || 'Bu qurilmada passkey topilmadi yoki bekor qilindi. Parol bilan kirishingiz mumkin.';

  var inFlight = false;
  var shown = false;

  // ── base64url <-> ArrayBuffer ──
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

  function prepOptions(opts) {
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

  function msg(text, sticky) {
    if (!hint) return;
    hint.textContent = text || '';
    if (sticky) return;
    // Yumshoq eslatma — 4 soniyadan so'ng o'chadi (UX toza qoladi)
    setTimeout(function () {
      if (hint.textContent === (text || '')) hint.textContent = '';
    }, 4000);
  }

  async function passkeyAuth() {
    if (inFlight) return;
    inFlight = true;
    btn.disabled = true;
    msg('');
    try {
      var o = await fetch('/api/admin/passkey/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: '{}',
      });
      if (o.status === 429) { msg(copy.rate, true); return; }
      var data = await o.json().catch(function () { return {}; });
      if (!data.ok || !data.options) {
        msg(data.message || (data.error === 'not_setup'
          ? 'Admin passkey o\'rnatilmagan. Profil → Xavfsizlikda qo\'shing.'
          : copy.error), true);
        return;
      }

      var cred = await navigator.credentials.get({ publicKey: prepOptions(data.options) });
      if (!cred) return; // foydalanuvchi bekor qildi — jim

      var v = await fetch('/api/admin/passkey/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ response: authToJSON(cred) }),
      });
      var vd = await v.json().catch(function () { return {}; });
      if (v.ok && vd.ok) { window.location.href = vd.redirect || '/admin/dashboard'; return; }
      msg(vd.message || (vd.error === 'wrong_owner'
        ? 'Bu passkey boshqa hisobga tegishli.'
        : copy.error), true);
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        // Bekor qilindi yoki bu qurilmada passkey yo'q — yumshoq yo'naltiruvchi xabar
        msg(copy.none);
      } else {
        msg(copy.error, true);
      }
    } finally {
      inFlight = false;
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', passkeyAuth);

  // ── Ko'rsatish: faqat admin passkey mavjud bo'lsa ──
  (async function init() {
    try {
      var r = await fetch('/api/admin/passkey/login/status', { credentials: 'same-origin' });
      var d = await r.json().catch(function () { return {}; });
      if (d.ok && d.available) {
        container.hidden = false;
        shown = true;
      }
    } catch (_) { /* tarmoq xatosi — tugma ko'rinmaydi (parol yo'li ochiq) */ }
  })();
})();
