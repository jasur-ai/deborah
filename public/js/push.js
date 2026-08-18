/**
 * AUTH B-23 — Web Push (PWA) client
 * ---------------------------------
 * 1. Subscribe: service worker + pushManager → endpoint/keys → POST /api/push/subscribe.
 * 2. Kontekstual opt-in: 2-3 sessiyadan keyin so'raladi (§07) — birinchi
 *    kirishda emas. Banner panel'da ko'rsatiladi (push-optin).
 * 3. Unsubscribe: POST /api/push/unsubscribe.
 * 4. iOS Safari cheklangan — PWA install'dan keyin ishlaydi (§28).
 */
(function () {
  'use strict';

  var init = window.__PUSH_INIT__ || {};
  var csrf = init.csrf || window.__CSRF_TOKEN || '';
  var enabled = !!(init.enabled || init.enabled === undefined);
  var vapidKey = init.vapidKey || '';
  var copy = init.copy || {};

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  /** Push qo'llab-quvvatlanadimi? (iOS Safari — PWA install'dan keyin) */
  function supported() {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /** Subscription yaratish yoki mavjudini olish. */
  function getSubscription() {
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) return sub;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      });
    });
  }

  function subscribe() {
    if (!supported()) {
      if (copy.unsupported) showStatus(copy.unsupported, true);
      return Promise.resolve(false);
    }
    if (!vapidKey) {
      showStatus(copy.fail || 'error', true);
      return Promise.resolve(false);
    }
    return getSubscription()
      .then(function (sub) {
        return post('/api/push/subscribe', {
          endpoint: sub.endpoint,
          keys: { p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('p256dh')))), auth: btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('auth')))) },
        });
      })
      .then(function (data) {
        if (data && data.ok) {
          refreshBadge(true);
          showStatus(copy.enabled || 'enabled');
          return true;
        }
        showStatus(copy.fail || 'error', true);
        return false;
      })
      .catch(function () {
        showStatus(copy.fail || 'error', true);
        return false;
      });
  }

  function unsubscribe() {
    return navigator.serviceWorker.ready
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) {
        if (!sub) return null;
        return post('/api/push/unsubscribe', { endpoint: sub.endpoint }).then(function () {
          return sub.unsubscribe().then(function () { return true; });
        });
      })
      .then(function () {
        refreshBadge(false);
        showStatus(copy.disabled || 'disabled');
      })
      .catch(function () { showStatus(copy.fail || 'error', true); });
  }

  function refreshBadge(on) {
    var badge = document.getElementById('push-badge');
    var text = document.getElementById('push-badge-text');
    var enableBtn = document.getElementById('push-enable');
    var disableBtn = document.getElementById('push-disable');
    if (!badge) return;
    badge.className = 'push-badge ' + (on ? 'on' : 'off');
    if (text) text.textContent = on ? (copy.enabled || 'enabled') : (copy.disabled || 'disabled');
    if (enableBtn) enableBtn.hidden = on;
    if (disableBtn) disableBtn.hidden = !on;
  }

  function showStatus(msg, isError) {
    var el = document.getElementById('push-status-msg');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.style.color = isError ? '#f43f5e' : '';
  }

  function initPage() {
    if (!enabled || !supported()) return;
    var enableBtn = document.getElementById('push-enable');
    var disableBtn = document.getElementById('push-disable');
    if (enableBtn) enableBtn.addEventListener('click', subscribe);
    if (disableBtn) disableBtn.addEventListener('click', unsubscribe);
    // Mavjud holatni tekshirish
    navigator.serviceWorker.ready
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) {
        refreshBadge(!!sub);
        if (enableBtn && disableBtn) {
          enableBtn.hidden = !!sub;
          disableBtn.hidden = !sub;
        }
      })
      .catch(function () { /* no-op */ });
  }

  // ── Kontekstual opt-in banner (panel'da) ──
  function initOptIn() {
    var banner = document.getElementById('push-optin');
    if (!banner) return;
    var yesBtn = document.getElementById('push-optin-yes');
    var noBtn = document.getElementById('push-optin-no');
    // Faqat eligible bo'lsa ko'rsat (2-3 sessiyadan keyin)
    fetch('/api/push/optin-eligible', { headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.eligible) banner.hidden = false;
      })
      .catch(function () { /* no-op */ });
    if (yesBtn) yesBtn.addEventListener('click', function () {
      subscribe().then(function (ok) { if (ok) banner.hidden = true; });
    });
    if (noBtn) noBtn.addEventListener('click', function () {
      banner.hidden = true;
      try { localStorage.setItem('push-optin-dismissed', String(Date.now())); } catch (_) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initPage(); initOptIn(); });
  } else {
    initPage();
    initOptIn();
  }
})();
