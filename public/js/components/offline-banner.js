/**
 * S16.09-10 — Offline / reconnect banner.
 * - Offline: foydalanuvchi harakatlari saqlanadi (browser IndexedDB journal
 *   kabi; bu yerda — banner state), reconnect'da progress ko'rsatiladi.
 * - Reconnect: progress + retry/cancel action.
 * - Full-screen loading overlay emas — section-level, tizim ishlashda davom
 *   etadi.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__deborahOfflineBanner) return;
  window.__deborahOfflineBanner = true;

  const MESSAGES = {
    offline: 'Internet aloqasi uzildi',
    offlineDesc: 'O‘zgarishlaringiz saqlanmoqda va qayta ulanganda yuboriladi.',
    reconnect: 'Qayta ulanmoqda…',
    retry: 'Qayta urinish',
    cancel: 'Bekor qilish',
    online: 'Aloqa tiklandi',
    saved: 'Barcha o‘zgarishlar sinxronlandi',
  };

  let banner = null;
  let statusEl = null;
  let descEl = null;
  let progressEl = null;
  let barEl = null;
  let actionsEl = null;
  let pendingOps = 0;
  let hideTimer = null;

  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML =
      '<span class="offline-banner__icon" aria-hidden="true">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>'
      + '</span>'
      + '<div class="offline-banner__body">'
      + '  <div class="offline-banner__status"></div>'
      + '  <div class="offline-banner__desc"></div>'
      + '  <div class="offline-banner__progress" hidden>'
      + '    <div class="progress progress--sm" aria-hidden="true"><div class="progress__bar"></div></div>'
      + '  </div>'
      + '  <div class="offline-banner__actions"></div>'
      + '</div>';
    document.body.appendChild(banner);
    statusEl = banner.querySelector('.offline-banner__status');
    descEl = banner.querySelector('.offline-banner__desc');
    progressEl = banner.querySelector('.offline-banner__progress');
    barEl = banner.querySelector('.progress__bar');
    actionsEl = banner.querySelector('.offline-banner__actions');
    return banner;
  }

  function show() {
    ensureBanner();
    clearHideTimer();
    banner.classList.add('is-in');
    banner.removeAttribute('hidden');
  }
  function hide() {
    if (!banner) return;
    banner.classList.remove('is-in');
    setTimeout(() => { if (banner) banner.hidden = true; }, 200);
  }
  // Stale hide timer offline banner'ni yashira olmasin (timer race)
  function clearHideTimer() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function setProgress(pct) {
    ensureBanner();
    progressEl.hidden = false;
    barEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function renderActions(opts) {
    actionsEl.innerHTML = '';
    if (opts.retry) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-primary btn-sm'; // S36.02: eski btn--primary/btn--sm nomlari design system'da yo'q edi
      retryBtn.textContent = MESSAGES.retry;
      retryBtn.addEventListener('click', opts.retry);
      actionsEl.appendChild(retryBtn);
    }
    if (opts.cancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-quiet btn-sm';
      cancelBtn.textContent = MESSAGES.cancel;
      cancelBtn.addEventListener('click', opts.cancel);
      actionsEl.appendChild(cancelBtn);
    }
  }

  const api = {
    offline(desc) {
      pendingOps++;
      show();
      banner.classList.add('offline-banner--offline');
      statusEl.textContent = MESSAGES.offline;
      descEl.textContent = desc || MESSAGES.offlineDesc;
      progressEl.hidden = true;
      renderActions({
        retry: () => { api.retry(); },
      });
      window.dispatchEvent(new CustomEvent('deborah:offline'));
    },

    reconnect() {
      show();
      banner.classList.remove('offline-banner--offline');
      statusEl.textContent = MESSAGES.reconnect;
      descEl.textContent = '';
      setProgress(0);
      renderActions({
        cancel: () => { api.cancel(); },
      });
    },

    progress(pct) {
      setProgress(pct);
    },

    online(savedCount) {
      // savedCount berilsa shuncha, berilmasa barcha pending synced deb hisoblaymiz
      const synced = savedCount !== undefined ? savedCount : pendingOps;
      pendingOps = Math.max(0, pendingOps - synced);
      banner.classList.remove('offline-banner--offline');
      statusEl.textContent = MESSAGES.online;
      descEl.textContent = synced > 0 ? MESSAGES.saved : '';
      progressEl.hidden = true;
      actionsEl.innerHTML = '';
      // qisqa online state → keyin yashirish (stale timer offline'ni yashira olmaydi)
      clearHideTimer();
      hideTimer = setTimeout(hide, 1800);
      window.dispatchEvent(new CustomEvent('deborah:online'));
    },

    retry() {
      window.dispatchEvent(new CustomEvent('deborah:retry'));
      api.reconnect();
    },

    cancel() {
      hide();
      window.dispatchEvent(new CustomEvent('deborah:cancel'));
    },

    get pendingOps() { return pendingOps; },
  };

  window.DeborahOffline = api;

  // Avtomatik: navigator.onLine + online/offline eventlari
  function handleOffline() {
    if (!navigator.onLine) api.offline();
  }
  function handleOnline() {
    if (navigator.onLine) api.online(0);
  }
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) handleOffline();
})();
