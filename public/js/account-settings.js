/**
 * Deborah — Account settings client (AUTH A-29)
 * ---------------------------------------------------------------
 * - Password change: POST /api/password/change (reauth + NIST + revoke)
 * - Email change (double opt-in): request → kod yangi email'ga → verify
 * - Security events feed: GET /api/account/security-events (PII-minimal)
 * CSRF: head.ejs global fetch interceptor X-CSRF-Token avtomatik qo'shadi.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var copy = window.__ACCOUNT_COPY__ || {};
    var EMPTY = '\u2014';

    function showMsg(el, ok, text) {
      el.style.display = '';
      el.className = 'verdict ' + (ok ? 'ok' : 'fail');
      el.textContent = text || '';
    }
    function fmtTime(ts) {
      if (!ts) return EMPTY;
      var d = new Date(ts);
      var p = function (n) { return String(n).padStart(2, '0'); };
      return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    // ── Password change ──
    var pwBtn = document.getElementById('pw-change-btn');
    if (pwBtn) {
      pwBtn.addEventListener('click', function () {
        var msg = document.getElementById('pw-msg');
        var currentPassword = document.getElementById('pw-current').value;
        var newPassword = document.getElementById('pw-new').value;
        if (!currentPassword || !newPassword) {
          showMsg(msg, false, (copy.requiredMsg || "Ikkala maydon ham to'ldirilishi shart"));
          return;
        }
        pwBtn.disabled = true;
        fetch('/api/password/change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword }),
        }).then(function (r) { return r.json(); }).then(function (j) {
          pwBtn.disabled = false;
          if (j.ok) {
            showMsg(msg, true, copy.passwordChanged || 'Parol yangilandi');
            document.getElementById('pw-current').value = '';
            document.getElementById('pw-new').value = '';
          } else {
            showMsg(msg, false, (copy.passwordErrors && copy.passwordErrors[j.error]) || j.error || 'Xatolik');
          }
        }).catch(function () {
          pwBtn.disabled = false;
          showMsg(msg, false, copy.networkError || 'Ulanishda muammo');
        });
      });
    }

    // ── Security events feed ──
    var eventsList = document.getElementById('events-list');
    if (eventsList) {
      var evCopy = copy.events || {};
      fetch('/api/account/security-events', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var items = (j && j.events) || [];
          if (!items.length) {
            eventsList.innerHTML = '<div style="font-size:.8rem;color:var(--deborah-semantic-color-text-muted)">' + esc(copy.eventsEmpty || "Hozircha hodisalar yo'q") + '</div>';
            return;
          }
          var html = items.map(function (e) {
            var label = evCopy[e.type] || evCopy.unknown || e.type;
            var meta = [e.device, e.browser].filter(Boolean).join(' / ');
            if (e.city) meta = meta ? meta + ' \u00b7 ' + e.city : e.city;
            return '<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--deborah-semantic-color-border-default)">' +
              '<div style="min-width:0;flex:1">' +
              '<div style="font-size:.85rem;font-weight:700;color:var(--deborah-semantic-color-text-primary)">' + esc(label) + '</div>' +
              '<div style="font-size:.74rem;color:var(--deborah-semantic-color-text-muted)">' + esc(meta || '') + '</div>' +
              '</div>' +
              '<div style="font-size:.72rem;color:var(--deborah-semantic-color-text-muted);white-space:nowrap">' + fmtTime(e.ts) + '</div>' +
              '</div>';
          }).join('');
          eventsList.innerHTML = html;
        })
        .catch(function () {
          eventsList.innerHTML = '<div style="font-size:.8rem;color:var(--deborah-semantic-color-text-muted)">' + esc(copy.eventsEmpty || '') + '</div>';
        });
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  });
})();
