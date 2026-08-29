/**
 * Deborah — Settings frontend (AUTH D-09)
 *
 * settings.ejs bilan ishlaydi:
 *   - Accordion: .settings-acc-head[data-acc] ↔ #acc-* body (aria-expanded,
 *     focus management — faqat bitta section ochiq).
 *   - Profil: [data-profile-field] (name/lang/theme) → PATCH
 *     /user/api/settings/profile → [data-profile-msg] (save state).
 *   - Toggle: .settings-toggle[data-toggle-key] (role=switch) → POST
 *     /api/notifications/prefs — optimistic UI, xatoda rollback + xabar.
 *   - DSAR: [data-dsar-export] / [data-dsar-delete] — D-23 ga ulanadi (disabled).
 *
 * i18n: window.__SETTINGS_COPY__ (4 til) — hardcode 0, hammasi t() orqali.
 * XSS: barcha matnlar textContent bilan yoziladi (innerHTML yo'q).
 */
(function () {
  'use strict';

  var copy = {};
  try { copy = JSON.parse(window.__SETTINGS_COPY__ || '{}'); } catch (_) {}
  function t(key, fallback) { return (copy && copy[key]) || fallback || ''; }

  var csrf = (window.__CSRF_TOKEN || '');

  // ── Accordion (faqat bitta section ochiq + keyboard nav) ──
  function initAccordion() {
    var heads = Array.prototype.slice.call(
      document.querySelectorAll('.settings-acc-head[data-acc]')
    );
    if (!heads.length) return;

    function toggleHead(head, forceOpen) {
      var isOpen = forceOpen !== undefined ? forceOpen : head.getAttribute('aria-expanded') === 'true';
      // Barchasini yopish
      for (var j = 0; j < heads.length; j++) {
        heads[j].setAttribute('aria-expanded', 'false');
        var b = document.getElementById(heads[j].getAttribute('aria-controls'));
        if (b) b.hidden = true;
      }
      // Bosilganini ochish (allaqachon ochiq bo'lsa yopiladi)
      if (!isOpen) {
        head.setAttribute('aria-expanded', 'true');
        var body = document.getElementById(head.getAttribute('aria-controls'));
        if (body) body.hidden = false;
      }
    }

    function focusHead(idx) {
      if (idx < 0) idx = heads.length - 1;
      if (idx > heads.length - 1) idx = 0;
      heads[idx].focus();
    }

    for (var i = 0; i < heads.length; i++) {
      heads[i].addEventListener('click', function () { toggleHead(this); });
      // WAI-ARIA accordion keyboard pattern: ArrowDown/Up, Home/End
      heads[i].addEventListener('keydown', function (ev) {
        var idx = heads.indexOf(this);
        switch (ev.key) {
          case 'ArrowDown': ev.preventDefault(); focusHead(idx + 1); break;
          case 'ArrowUp': ev.preventDefault(); focusHead(idx - 1); break;
          case 'Home': ev.preventDefault(); focusHead(0); break;
          case 'End': ev.preventDefault(); focusHead(heads.length - 1); break;
        }
      });
    }
  }

  // ── Profil saqlash (save state) ──
  function initProfileSave() {
    var saveBtn = document.querySelector('[data-profile-save]');
    if (!saveBtn) return;
    var msg = document.querySelector('[data-profile-msg]');
    var fields = document.querySelectorAll('[data-profile-field]');

    function show(text, ok) {
      if (!msg) return;
      msg.textContent = text;
      msg.className = 'settings-msg' + (ok ? ' ok' : ' fail');
    }

    saveBtn.addEventListener('click', function () {
      var body = {};
      var changed = false;
      for (var i = 0; i < fields.length; i++) {
        var el = fields[i];
        if (!el.name || el.name === 'email') continue;
        body[el.name] = el.value.trim();
        changed = true;
      }
      if (!changed) { show(t('saveFailed', 'Hech narsa saqlanmadi'), false); return; }

      saveBtn.disabled = true;
      show(t('saving', 'Saqlanmoqda…'), true);

      fetch('/user/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (res) {
          if (res && res.ok) {
            show(t('saved', 'Saqlangan ✓'), true);
          } else {
            var err = (res && res.error) || 'server';
            show(t('saveFailed', 'Saqlashda xatolik: __err__').replace('__err__', err), false);
          }
        })
        .catch(function () {
          show(t('network', 'Server bilan bog\u2018lanishda xatolik. Qayta urinib ko\u2018ring.'), false);
        })
        .finally(function () { saveBtn.disabled = false; });
    });
  }

  // ── Bildirishnoma toggle (optimistic + rollback) ──
  function initToggles() {
    var toggles = document.querySelectorAll('.settings-toggle[data-toggle-key]');
    if (!toggles.length) return;
    var msg = document.querySelector('[data-toggle-msg]');

    function show(text, ok) {
      if (!msg) return;
      msg.textContent = text;
      msg.className = 'settings-msg' + (ok ? ' ok' : ' fail');
    }

    for (var i = 0; i < toggles.length; i++) {
      toggles[i].addEventListener('click', function () {
        var toggle = this;
        var key = toggle.getAttribute('data-toggle-key') || '';
        // telegram_events → telegram → ch_telegram (B-21 kontrakti)
        var channel = key.replace(/_events$/, '');
        var url = toggle.getAttribute('data-toggle-url') || '/api/notifications/prefs';
        var next = toggle.getAttribute('aria-checked') !== 'true';

        // Optimistic: darhol UI'ni almashtirish
        toggle.setAttribute('aria-checked', String(next));
        toggle.disabled = true;

        var payload = {};
        payload['ch_' + channel] = next;

        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify(payload),
        })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (res) {
            if (res && res.ok) {
              show(t('prefSaved', 'Bildirishnoma sozlamalari saqlandi'), true);
            } else {
              // Rollback
              toggle.setAttribute('aria-checked', String(!next));
              show(t('prefFailed', 'Bildirishnoma sozlamalarini saqlashda xatolik'), false);
            }
          })
          .catch(function () {
            // Rollback
            toggle.setAttribute('aria-checked', String(!next));
            show(t('network', 'Server bilan bog\u2018lanishda xatolik. Qayta urinib ko\u2018ring.'), false);
          })
          .finally(function () { toggle.disabled = false; });
      });
    }
  }

  // ── DSAR (D-23 da ulanadi; tugmalar disabled bo'lib qoladi) ──
  // [data-dsar-export] / [data-dsar-delete] — D-23 spec bo'yicha reauth-gated
  // flow ulanadi. Hozircha serverda yo'q, shuning uchun JS qo'shmaymiz.

  document.addEventListener('DOMContentLoaded', function () {
    initAccordion();
    initProfileSave();
    initToggles();
  });
})();
