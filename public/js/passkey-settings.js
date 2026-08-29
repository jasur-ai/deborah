/**
 * Deborah — Passkey settings client (AUTH A-27)
 *
 * Security profile sahifasidagi Passkeylar bo'limi:
 *   - ro'yxat (deviceName, lastUsed, backedUp)
 *   - Yangi qo'shish — native WebAuthn create → server verify
 *   - O'chirish — owner-only, reauth-gated
 *   - 403 reauth_required → inline parol tasdiqlash (POST /api/auth/reauth) →
 *     keyingi urinish avtomatik qayta ishga tushadi.
 *
 * Serverdan JSON options keladi (simplewebauthn v13); native API uchun
 * base64url → ArrayBuffer konvertatsiyasi qilinadi. Raw biometric serverga
 * yuborilmaydi — faqat attestation/assertion ob'ektlari.
 */
(function () {
  'use strict';

  if (!window.PublicKeyCredential) return;

  var listEl = document.getElementById('passkey-list');
  var addBtn = document.getElementById('passkey-add-btn');
  var errEl = document.getElementById('passkey-err');
  var reauthBox = document.getElementById('passkey-reauth');
  var reauthPw = document.getElementById('passkey-reauth-pw');
  var reauthBtn = document.getElementById('passkey-reauth-btn');
  var reauthErr = document.getElementById('passkey-reauth-err');

  var pendingAction = null; // reauth'dan keyin qayta ishga tushadigan action

  // AUTH D-08 §15: i18n copy — security-profile.ejs `#passkey-card[data-copy]`
  // dan keladi (4 til). Fallback'lar default (uz) matnda.
  var card = document.getElementById('passkey-card');
  var copy = {};
  try { copy = JSON.parse((card && card.getAttribute('data-copy')) || '{}'); } catch (_) {}
  function t(key, fallback) { return (copy && copy[key]) || fallback; }

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

  // v13 server options to'g'ridan-to'g'ri qaytaradi ({ publicKey } wrapper'siz)
  function prepCreateOptions(opts) {
    opts.challenge = b64urlToBuf(opts.challenge);
    opts.user.id = b64urlToBuf(opts.user.id);
    if (opts.excludeCredentials && opts.excludeCredentials.length) {
      opts.excludeCredentials.forEach(function (c) { c.id = b64urlToBuf(c.id); });
    }
    return opts;
  }

  function regToJSON(cred) {
    var transports = [];
    try { transports = cred.response.getTransports ? cred.response.getTransports() : []; } catch (_) {}
    return {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        attestationObject: bufToB64url(cred.response.attestationObject),
        transports: transports,
      },
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    };
  }

  // ── UI helpers ──
  function showErr(msg) { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } }
  function hideErr() { if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; } }
  // XSS: faqat STATIK matn bilan chaqiriladi (dinamik qiymatlar hech qachon
  // XSS: textContent — HTML qabul qilinmaydi (innerHTML ishlatilmaydi)
  function setLoading(msg) {
    if (!listEl) return;
    listEl.textContent = msg || '';
    listEl.style.opacity = msg ? '0.55' : '';
  }

  function renderList(passkeys, max) {
    if (!listEl) return;
    if (!passkeys || !passkeys.length) {
      // XSS: textContent — innerHTML emas
      listEl.textContent = t('empty', "Hozircha passkey qo'shilmagan. Biometrik yoki security key bilan tezroq kirish uchun qo'shing.");
      return;
    }
    var removeLabel = t('remove', "O'chirish");
    var renameLabel = t('rename', 'Nomi');
    var rows = passkeys.map(function (p) {
      var used = p.lastUsedAt ? new Date(p.lastUsedAt).toLocaleDateString() : '—';
      var deviceLabel = t('device', 'Qurilma');
      var chip = p.backedUp
        ? '<span style="display:inline-flex;align-items:center;gap:4px;font-size:.66rem;font-weight:700;background:rgba(0,229,160,.1);color:var(--green);border:1px solid rgba(0,229,160,.3);border-radius:6px;padding:2px 7px">● ' + t('sync', 'Sync') + '</span>'
        : '<span style="display:inline-flex;align-items:center;gap:4px;font-size:.66rem;font-weight:700;background:rgba(59,130,246,.1);color:var(--blue);border:1px solid rgba(59,130,246,.3);border-radius:6px;padding:2px 7px">● ' + deviceLabel + '</span>';
      var deviceName = p.deviceName || deviceLabel;
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--deborah-semantic-color-border-default)">'
        + '<div style="min-width:0">'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:.82rem;font-weight:700">' + escapeAttr(deviceName) + '</span>' + chip + '</div>'
        + '<div style="font-size:.68rem;color:var(--deborah-semantic-color-text-muted);font-weight:600;margin-top:3px">' + t('lastUsed', 'Oxirgi kirish') + ': ' + used + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
        + '<button type="button" class="verify-btn" data-rename="' + p.id + '" data-name="' + escapeAttr(deviceName) + '" aria-label="' + renameLabel + ': ' + escapeAttr(deviceName) + '" style="background:linear-gradient(135deg,#2563eb,#1e40af);padding:7px 12px;font-size:.74rem;white-space:nowrap;min-height:44px">' + renameLabel + '</button>'
        + '<button type="button" class="verify-btn" data-remove="' + p.id + '" aria-label="' + removeLabel + ': ' + escapeAttr(deviceName) + '" style="background:linear-gradient(135deg,#dc2626,#991b1b);padding:7px 12px;font-size:.74rem;white-space:nowrap;min-height:44px">' + removeLabel + '</button>'
        + '</div>'
        + '</div>';
    }).join('');
    listEl.innerHTML = rows;
    listEl.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () { removePasskey(b.getAttribute('data-remove')); });
    });
    listEl.querySelectorAll('[data-rename]').forEach(function (b) {
      b.addEventListener('click', function () { startRename(b.getAttribute('data-rename'), b.getAttribute('data-name')); });
    });
  }

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // E-05: multi-device boshqaruv — inline rename (XSS: nom server'da ham tekshiriladi)
  function startRename(credentialId, currentName) {
    hideErr();
    var renamePrompt = t('renamePrompt', 'Qurilma nomini kiriting (maks. 50 belgi)');
    var saveLabel = t('renameSave', 'Saqlash');
    var cancelLabel = t('renameCancel', 'Bekor qilish');
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 50;
    input.value = currentName || '';
    input.setAttribute('aria-label', renamePrompt);
    input.style.cssText = 'flex:1;min-width:140px;padding:8px 10px;border-radius:8px;border:1px solid var(--deborah-semantic-color-border-default);background:var(--deborah-semantic-color-surface-input);color:var(--deborah-semantic-color-text-primary);font-size:.8rem';

    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'verify-btn';
    save.textContent = saveLabel;
    save.style.cssText = 'min-height:44px';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'verify-btn';
    cancel.textContent = cancelLabel;
    cancel.style.cssText = 'min-height:44px;background:linear-gradient(135deg,#4b5563,#374151)';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0';
    row.appendChild(input);
    row.appendChild(save);
    row.appendChild(cancel);

    var btn = listEl.querySelector('[data-rename="' + credentialId + '"]');
    if (btn && btn.parentElement) btn.parentElement.replaceWith(row);
    input.focus();
    input.select();

    var done = function () { loadStatus(); };
    var doSave = async function () {
      var name = input.value.trim();
      if (!name) { showErr(t('renamePrompt', 'Qurilma nomini kiriting (maks. 50 belgi)')); return; }
      save.disabled = true;
      var r = await apiPost('/api/passkey/rename', { credentialId: credentialId, name: name });
      if (r.status === 403 && r.data && r.data.error === 'reauth_required') {
        requireReauth(function () { return renamePasskey(credentialId, name); });
        return;
      }
      if (!r.data.ok) {
        save.disabled = false;
        showErr((r.data && r.data.message) || t('renamePrompt', 'Qurilma nomini kiriting (maks. 50 belgi)'));
        return;
      }
      done();
    };
    save.addEventListener('click', doSave);
    cancel.addEventListener('click', done);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') done(); });
  }

  // ── Reauth (A-27 §13) ──
  function requireReauth(action) {
    pendingAction = action;
    reauthBox.style.display = 'block';
    reauthErr.style.display = 'none';
    if (reauthPw) reauthPw.focus();
  }

  async function doReauth() {
    var password = reauthPw ? reauthPw.value : '';
    if (!password) { reauthErr.textContent = t('reauthRequired', 'Parolni kiriting'); reauthErr.style.display = 'block'; return; }
    reauthBtn.disabled = true;
    try {
      var r = await fetch('/api/auth/reauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password }),
      });
      var d = await r.json().catch(function () { return {}; });
      if (r.status === 403 && d.error === 'rate-limited') {
        reauthErr.textContent = t('reauthRate', "Ko'p urinish — biroz kuting");
        reauthErr.style.display = 'block';
        return;
      }
      if (!r.ok) { reauthErr.textContent = t('reauthWrong', "Parol noto'g'ri"); reauthErr.style.display = 'block'; return; }
      reauthBox.style.display = 'none';
      if (reauthPw) reauthPw.value = '';
      var action = pendingAction;
      pendingAction = null;
      if (action) await action();
    } finally {
      reauthBtn.disabled = false;
    }
  }

  if (reauthBtn) reauthBtn.addEventListener('click', doReauth);
  if (reauthPw) reauthPw.addEventListener('keydown', function (e) { if (e.key === 'Enter') doReauth(); });

  // ── API ──
  async function apiPost(path, body) {
    var r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    var d = await r.json().catch(function () { return {}; });
    return { status: r.status, data: d };
  }

  async function loadStatus() {
    hideErr();
    try {
      var r = await fetch('/api/passkey/status');
      var d = await r.json().catch(function () { return {}; });
      if (d.ok) renderList(d.passkeys || [], d.max);
      else setLoading(t('loadFail', "Yuklab bo'lmadi"));
    } catch (_) {
      setLoading(t('loadFail', "Yuklab bo'lmadi"));
    }
  }

  // ── Add ──
  async function addPasskey() {
    hideErr();
    addBtn.disabled = true;
    try {
      var o = await apiPost('/api/passkey/register/options', {});
      if (o.status === 403 && o.data && o.data.error === 'reauth_required') {
        requireReauth(addPasskey);
        return;
      }
      if (!o.data.ok || !o.data.options) { showErr((o.data && o.data.message) || t('startFail', 'Boshlashda xatolik')); return; }

      var publicKey = prepCreateOptions(o.data.options);
      var cred = await navigator.credentials.create({ publicKey: publicKey });
      if (!cred) return;

      var v = await apiPost('/api/passkey/register/verify', { response: regToJSON(cred) });
      if (v.status === 403 && v.data && v.data.error === 'reauth_required') {
        requireReauth(addPasskey);
        return;
      }
      if (!v.data.ok) { showErr((v.data && v.data.message) || t('verifyFail', "Ro'yxatdan o'tkazib bo'lmadi")); return; }
      await loadStatus();
    } catch (e) {
      if (!(e && (e.name === 'NotAllowedError' || e.name === 'AbortError'))) {
        showErr(t('addFail', "Passkey qo'shishda xatolik"));
      }
    } finally {
      addBtn.disabled = false;
    }
  }

  // ── Rename (E-05: multi-device boshqaruv) ──
  async function renamePasskey(credentialId, name) {
    hideErr();
    var r = await apiPost('/api/passkey/rename', { credentialId: credentialId, name: name });
    if (r.status === 403 && r.data && r.data.error === 'reauth_required') {
      requireReauth(function () { return renamePasskey(credentialId, name); });
      return;
    }
    if (!r.data.ok) { showErr((r.data && r.data.message) || t('renamePrompt', 'Qurilma nomini kiriting (maks. 50 belgi)')); return; }
    await loadStatus();
  }

  // ── Remove ──
  async function removePasskey(credentialId) {
    hideErr();
    var r = await apiPost('/api/passkey/remove', { credentialId: credentialId });      if (r.status === 403 && r.data && r.data.error === 'reauth_required') {
        requireReauth(function () { return removePasskey(credentialId); });
        return;
      }
      if (!r.data.ok) { showErr((r.data && r.data.message) || t('removeFail', "O'chirib bo'lmadi")); return; }
    await loadStatus();
  }

  if (addBtn) addBtn.addEventListener('click', addPasskey);

  loadStatus();
})();
