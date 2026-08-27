/**
 * Deborah — MFA/TOTP Settings client (AUTH A-26)
 *
 * Handles the MFA panel on the security profile page:
 *   - load status (none/pending/active)
 *   - setup: secret + QR from server
 *   - enable: first code → backup codes (acknowledge required)
 *   - manage: backup codes remaining, rotate, disable (reauth-gated)
 *
 * Security: secret arrives only in the setup response and is never stored
 * by the client; backup codes shown once and cleared after acknowledge.
 */
(function () {
  'use strict';

  var csrf = (window.__CSRF_TOKEN || '');

  // AUTH D-08 §15: i18n copy — security-profile.ejs `#mfa-card[data-copy]`
  var card = document.getElementById('mfa-card');
  // BUG-011: MFA bloki render qilinmagan sahifada (student/VIP) jim no-op —
  // aks holda pastdagi element ref'lari null bo'lib IIFE TypeError bilan o'lardi.
  if (!card) return;
  var copy = {};
  try { copy = JSON.parse((card && card.getAttribute('data-copy')) || '{}'); } catch (_) {}
  function t(key, fallback) { return (copy && copy[key]) || fallback; }

  var statusEl = document.getElementById('mfa-status');
  var setupEl = document.getElementById('mfa-setup');
  var backupEl = document.getElementById('mfa-backup');
  var manageEl = document.getElementById('mfa-manage');

  var qrEl = document.getElementById('mfa-qr');
  var secretEl = document.getElementById('mfa-secret');
  var tokenEl = document.getElementById('mfa-token');
  var enableBtn = document.getElementById('mfa-enable-btn');
  var setupErr = document.getElementById('mfa-setup-err');

  var codesEl = document.getElementById('mfa-backup-codes');
  var dlBtn = document.getElementById('mfa-backup-download');
  var printBtn = document.getElementById('mfa-backup-print');
  var ackChk = document.getElementById('mfa-backup-ack');
  var doneBtn = document.getElementById('mfa-backup-done');

  var manageStatus = document.getElementById('mfa-manage-status');
  var remainingEl = document.getElementById('mfa-backup-remaining');
  var rotateBtn = document.getElementById('mfa-rotate-btn');
  var disableBtn = document.getElementById('mfa-disable-btn');
  var manageErr = document.getElementById('mfa-manage-err');

  var pendingBackupCodes = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function show(el) { el.style.display = 'block'; }
  function hide(el) { el.style.display = 'none'; }
  function errBox(el, msg) { el.textContent = msg; el.style.display = 'block'; }
  function clearErr(el) { el.style.display = 'none'; el.textContent = ''; }

  async function api(path, body) {
    var res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body || {}),
    });
    var data = await res.json().catch(function () { return {}; });
    return { status: res.status, data: data };
  }

  async function loadStatus() {
    try {
      var res = await fetch('/api/mfa/status', {
        headers: { 'Accept': 'application/json', 'X-CSRF-Token': csrf },
      });
      var data = await res.json().catch(function () { return {}; });
      renderStatus(data);
    } catch (e) {
      statusEl.textContent = t('statusLoadFail', 'MFA holatini yuklab bo\u2019lmadi.');
    }
  }

  function renderStatus(data) {
    hide(setupEl); hide(backupEl); hide(manageEl);
    statusEl.innerHTML = '';
    if (data && data.ok) {
      if (data.status === 'active') {
        show(manageEl);
        remainingEl.textContent = t('remaining', 'Qolgan backup kodlar: __n__ / 10').replace('__n__', String(data.backupCodesRemaining ?? 0));
      } else if (data.status === 'pending') {
        statusEl.innerHTML = '<div class="verdict" style="color:var(--deborah-semantic-color-status-warning,var(--gold));border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.07)">' + esc(t('setupPending', 'Setup boshlangan — kodni tasdiqlab tugating.')) + '</div>';
        // Pending bo'lsa setup UI ko'rsatilmaydi; qayta setup boshlanadi
        show(setupEl);
        startSetup();
      } else {
        show(setupEl);
        startSetup();
      }
    } else {
      statusEl.textContent = t('statusLoadFail', 'MFA holatini yuklab bo\u2019lmadi.');
    }
  }

  async function startSetup() {
    try {
      var r = await api('/api/mfa/totp/setup', {});
      if (r.status === 409) {
        // already active — reload
        loadStatus();
        return;
      }
      if (!r.data.ok) { errBox(setupErr, t('setupFail', 'Setup xatoligi: __err__').replace('__err__', esc(r.data.error || 'server'))); return; }
      secretEl.value = r.data.secret;
      if (r.data.qr) { qrEl.src = r.data.qr; show(qrEl); } else { hide(qrEl); }
    } catch (e) {
      errBox(setupErr, t('network', 'Server bilan bog\u2019lanishda xatolik.'));
    }
  }

  enableBtn.addEventListener('click', async function () {
    var token = tokenEl.value.trim();
    if (token.length !== 6) { errBox(setupErr, t('codeShort', '6 xonali kod kiriting')); return; }
    clearErr(setupErr);
    enableBtn.disabled = true;
    try {
      var r = await api('/api/mfa/totp/enable', { token: token });
      if (r.data.ok) {
        pendingBackupCodes = r.data.backupCodes || [];
        showBackupCodes(pendingBackupCodes);
      } else {
        errBox(setupErr, r.data.error === 'invalid_code' ? t('invalidCode', 'Kod noto\u2019g\u2019ri. Qayta urinib ko\u2019ring.') : t('errPrefix', 'Xatolik: __err__').replace('__err__', esc(r.data.error || 'server')));
      }
    } catch (e) {
      errBox(setupErr, t('network', 'Server bilan bog\u2019lanishda xatolik.'));
    } finally {
      enableBtn.disabled = false;
    }
  });

  function showBackupCodes(codes) {
    hide(setupEl); show(backupEl);
    codesEl.innerHTML = codes.map(function (c) {
      return '<span style="background:var(--deborah-semantic-color-surface-input);border:1px solid var(--deborah-semantic-color-border-default);border-radius:8px;padding:6px 8px;text-align:center">' + esc(c) + '</span>';
    }).join('');
  }

  dlBtn.addEventListener('click', function () {
    if (!pendingBackupCodes) return;
    var blob = new Blob([pendingBackupCodes.join('\n')], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'deborah-mfa-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // D-08 §07: [Print] — backup kodlarni chop etish (faqat bir marta ko'rsatiladi)
  if (printBtn) {
    printBtn.addEventListener('click', function () {
      if (!pendingBackupCodes) return;
      var w = window.open('', '_blank', 'width=420,height=520');
      if (!w) return;
      w.document.write(
        '<html><head><title>Deborah MFA Backup Codes</title>' +
        '<style>body{font-family:monospace;padding:24px}h1{font-size:16px}' +
        '.code{display:block;padding:6px;font-size:14px;letter-spacing:1px}' +
        '@media print{button{display:none}}</style></head><body>' +
        '<h1>Deborah — MFA Backup Codes</h1>' +
        pendingBackupCodes.map(function (c) { return '<span class="code">' + esc(c) + '</span>'; }).join('') +
        '<button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print</button>' +
        '</body></html>'
      );
      w.document.close();
    });
  }

  // D-08 §07: "Men saqladim" checkbox majburiy — tanlanmasa done blok
  if (ackChk && doneBtn) {
    ackChk.addEventListener('change', function () {
      var on = ackChk.checked;
      doneBtn.disabled = !on;
      doneBtn.style.opacity = on ? '1' : '.5';
    });
  }

  if (doneBtn) doneBtn.addEventListener('click', function () {
    if (ackChk && !ackChk.checked) return; // D-08 §07: majburiy ack
    pendingBackupCodes = null;
    hide(backupEl); show(manageEl);
    loadStatus();
  });

  rotateBtn.addEventListener('click', async function () {
    clearErr(manageErr);
    rotateBtn.disabled = true;
    try {
      var r = await api('/api/mfa/totp/backup/rotate', {});
      if (r.data.ok) {
        pendingBackupCodes = r.data.backupCodes || [];
        showBackupCodes(pendingBackupCodes);
        hide(manageEl);
      } else if (r.status === 403 && r.data.error === 'reauth_required') {
        errBox(manageErr, t('reauth', 'Xavfsizlik uchun avval parolingizni qayta tasdiqlang (sozlamalar → Sessiyalar → Parolni tasdiqlash).'));
      } else {
        errBox(manageErr, t('errPrefix', 'Xatolik: __err__').replace('__err__', esc(r.data.error || 'server')));
      }
    } catch (e) {
      errBox(manageErr, t('network', 'Server bilan bog\u2019lanishda xatolik.'));
    } finally {
      rotateBtn.disabled = false;
    }
  });

  disableBtn.addEventListener('click', async function () {
    clearErr(manageErr);
    if (!window.confirm(t('disableConfirm', 'MFA o\u2019chirilsinmi? Bu xavfsizlikni pasaytiradi.'))) return;
    disableBtn.disabled = true;
    try {
      var r = await api('/api/mfa/totp/disable', {});
      if (r.data.ok) {
        loadStatus();
      } else if (r.status === 403 && r.data.error === 'reauth_required') {
        errBox(manageErr, t('reauthShort', 'Xavfsizlik uchun avval parolingizni qayta tasdiqlang.'));
      } else {
        errBox(manageErr, t('errPrefix', 'Xatolik: __err__').replace('__err__', esc(r.data.error || 'server')));
      }
    } catch (e) {
      errBox(manageErr, t('network', 'Server bilan bog\u2019lanishda xatolik.'));
    } finally {
      disableBtn.disabled = false;
    }
  });

  loadStatus();
})();
