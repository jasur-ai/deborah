/**
 * Deborah — HEMIS akkaunt bog'lash client (C-10)
 * ---------------------------------------------------------------
 * - Bog'lash: POST /api/auth/hemis/link (HEMIS login + parol)
 * - Bekor qilish: POST /api/auth/hemis/unlink
 * - Xavfsizlik: parol localStorage/sessionStorage'da saqlanmaydi;
 *   link muvaffaqiyatli bo'lsa server sessiyani aylantiradi va YANGI
 *   CSRF token qaytaradi — `window.__CSRF_TOKEN` shu bilan yangilanadi,
 *   aks holda keyingi POST'lar 403 qaytarardi.
 * CSRF: head.ejs global fetch interceptor X-CSRF-Token avtomatik qo'shadi.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var linkBtn = document.getElementById('hemis-link-btn');
    var unlinkBtn = document.getElementById('hemis-unlink-btn');
    if (!linkBtn && !unlinkBtn) return;

    var errEl = document.getElementById('hemis-err');
    var okEl = document.getElementById('hemis-ok');

    function show(el, ok, text) {
      if (!el) return;
      el.style.display = '';
      el.className = 'verdict ' + (ok ? 'ok' : 'fail');
      el.textContent = text || '';
    }
    function clearMsgs() {
      if (errEl) errEl.style.display = 'none';
      if (okEl) okEl.style.display = 'none';
    }

    // Server session'ni aylantirganda yangi CSRF token'ni saqlaymiz.
    function applyCsrf(token) {
      if (token) window.__CSRF_TOKEN = token;
    }

    function errText(code) {
      var map = {
        invalid_credentials: 'HEMIS login yoki parol noto\u2018g\u2018ri',
        geofence: 'HEMIS faqat O\u2018zbekistondan ishlaydi (geofence)',
        too_many_attempts: 'Ko\u2018p urinish — birozdan so\u2018ng qayta urinib ko\u2018ring',
        hemis_already_linked: 'Bu HEMIS akkaunt boshqa foydalanuvchiga bog\u2018langan',
        unreachable: 'HEMIS serveriga ulanishda xatolik — qayta urinib ko\u2018ring',
        disabled: 'HEMIS integratsiyasi o\u2018chirilgan',
        internal: 'Ichki xatolik — qayta urinib ko\u2018ring',
      };
      return map[code] || 'Xatolik yuz berdi — qayta urinib ko\u2018ring';
    }

    // Bog'lash
    if (linkBtn) {
      linkBtn.addEventListener('click', function () {
        var login = document.getElementById('hemis-login').value.trim();
        var password = document.getElementById('hemis-password').value;
        if (!login || !password) {
          show(errEl, false, 'HEMIS login va parolni kiriting');
          return;
        }
        linkBtn.disabled = true;
        clearMsgs();
        fetch('/api/auth/hemis/link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ login: login, password: password }),
        })
          .then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
              return { status: r.status, body: d };
            });
          })
          .then(function (r) {
            if (r.status === 200 && r.body.success) {
              applyCsrf(r.body.csrfToken);
              show(okEl, true, 'HEMIS akkaunti bog\u2018landi \u2014 sahifa yangilanmoqda...');
              setTimeout(function () { window.location.href = '/user/security-profile'; }, 600);
              return;
            }
            show(errEl, false, errText(r.body.error));
            linkBtn.disabled = false;
          })
          .catch(function () {
            show(errEl, false, 'Tarmoq xatoligi — qayta urinib ko\u2018ring');
            linkBtn.disabled = false;
          });
      });
    }

    // Bekor qilish
    if (unlinkBtn) {
      unlinkBtn.addEventListener('click', function () {
        if (!window.confirm('HEMIS akkaunti bilan bog\u2018lanish bekor qilinsinmi?')) return;
        unlinkBtn.disabled = true;
        clearMsgs();
        fetch('/api/auth/hemis/unlink', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
          .then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
              return { status: r.status, body: d };
            });
          })
          .then(function (r) {
            if (r.status === 200 && r.body.success) {
              applyCsrf(r.body.csrfToken);
              show(okEl, true, 'Bog\u2018lanish bekor qilindi \u2014 sahifa yangilanmoqda...');
              setTimeout(function () { window.location.href = '/user/security-profile'; }, 600);
              return;
            }
            show(errEl, false, errText(r.body.error));
            unlinkBtn.disabled = false;
          })
          .catch(function () {
            show(errEl, false, 'Tarmoq xatoligi — qayta urinib ko\u2018ring');
            unlinkBtn.disabled = false;
          });
      });
    }
  });
})();
