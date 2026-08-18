/**
 * AUTH A-02 — Session idle timeout ogohlantirishi
 * ---------------------------------------------------------------
 * Sessiya tugashidan `warnMs` (60s) oldin modal/banner ko'rsatadi.
 * - "Davom etish" → POST keepalive (idle timer reset) + auto-save hook.
 * - Hech narsa qilinmasa → login'ga returnUrl bilan qaytish.
 * - A11y: role="alertdialog", aria-modal, live-region countdown, keyboard (Esc=continue).
 * - Mobile (≤640px): yumshoq pastki banner (CSS).
 * - Auto-save: window.SessionTimeout.registerAutoSave(fn) — imtihon/form saqlash
 *   uchun (idle timeout ishni o'chirmaydi — stop condition).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__edikitSessionTimeout) return;
  const cfg = window.__SESSION_TIMEOUT;
  if (!cfg || !cfg.idleMs) return;
  window.__edikitSessionTimeout = true;

  const idleMs = Number(cfg.idleMs) || 1800000;
  const warnMs = Number(cfg.warnMs) || 60000;
  const keepAliveUrl = cfg.keepAliveUrl || '/api/session/ping';
  const loginUrl = cfg.loginUrl || '/user/login';
  const returnUrl = cfg.returnUrl || '/user/panel';
  const copy = cfg.copy || {};
  const T = {
    title: copy.title || 'Sessiya tugayapti',
    body: copy.body || 'Harakatsizlik tufayli sessiya tez orada yakunlanadi.',
    countdown: copy.countdown || 'Qolgan vaqt',
    keep: copy.keep || 'Davom etish',
    logout: copy.logout || 'Chiqish',
    second: copy.second || 'soniya',
  };

  const autoSaveFns = [];
  const saveHooks = {
    registerAutoSave(fn) {
      if (typeof fn === 'function') autoSaveFns.push(fn);
    },
    runAutoSave() {
      autoSaveFns.forEach((fn) => {
        try { fn(); } catch (_) { /* saqlash xatosi bloklamasligi kerak */ }
      });
    },
  };
  window.SessionTimeout = saveHooks;

  let lastActivity = Date.now();
  let modalEl = null;
  let shown = false;
  let countdownTimer = null;
  let tickTimer = null;
  let keepAliveInFlight = false;

  // ── Faollik kuzatuvi (mousemove/scroll throttled) ──
  let moveThrottle = 0;
  function onActivity() {
    lastActivity = Date.now();
  }
  function onMoveOrScroll() {
    const now = Date.now();
    if (now - moveThrottle > 2000) {
      moveThrottle = now;
      lastActivity = now;
    }
  }
  const EVENTS = ['click', 'keydown', 'touchstart', 'focus'];
  EVENTS.forEach((e) => document.addEventListener(e, onActivity, { passive: true, capture: true }));
  ['mousemove', 'scroll'].forEach((e) => document.addEventListener(e, onMoveOrScroll, { passive: true, capture: true }));

  function remaining() {
    return idleMs - (Date.now() - lastActivity);
  }

  function loginRedirect() {
    window.location.href = `${loginUrl}?returnUrl=${encodeURIComponent(returnUrl)}`;
  }

  async function keepAlive() {
    if (keepAliveInFlight) return;
    keepAliveInFlight = true;
    try {
      saveHooks.runAutoSave();
      const res = await fetch(keepAliveUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (res.ok) {
        lastActivity = Date.now();
        hideModal();
        return true;
      }
      // 401 — sessiya o'lgan
      loginRedirect();
      return false;
    } catch (_) {
      // Tarmoq xatosi — bir marta qayta urinamiz; hali ishlamasa fail-safe:
      // sessiya o'lgan bo'lishi mumkin → login'ga (yopishib qolish yo'q).
      try {
        const retry = await fetch(keepAliveUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (retry.ok) {
          lastActivity = Date.now();
          hideModal();
          return true;
        }
      } catch (_2) { /* ikkinchi urinish ham ishlamadi */ }
      loginRedirect();
      return false;
    } finally {
      keepAliveInFlight = false;
    }
  }

  const ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

  function buildModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'session-timeout-backdrop';
    backdrop.setAttribute('role', 'alertdialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-live', 'polite');
    backdrop.setAttribute('aria-labelledby', 'st-timeout-title');
    backdrop.setAttribute('aria-describedby', 'st-timeout-body');
    backdrop.innerHTML =
      '<div class="session-timeout-dialog">' +
      '<div class="session-timeout-title" id="st-timeout-title">' + ICON + '<span></span></div>' +
      '<p class="session-timeout-body" id="st-timeout-body">' +
      '<span class="session-timeout-copy"></span> <strong class="session-timeout-count" id="st-timeout-count"></strong> ' +
      '<span class="session-timeout-unit"></span></p>' +
      '<div class="session-timeout-actions">' +
      '<button type="button" class="btn btn--secondary" data-st-logout></button>' +
      '<button type="button" class="btn btn--primary" data-st-keep></button>' +
      '</div></div>';
    backdrop.querySelector('.session-timeout-title span').textContent = T.title;
    backdrop.querySelector('.session-timeout-copy').textContent = T.body;
    backdrop.querySelector('.session-timeout-unit').textContent = T.second;
    backdrop.querySelector('[data-st-logout]').textContent = T.logout;
    const keepBtn = backdrop.querySelector('[data-st-keep]');
    keepBtn.textContent = T.keep;
    keepBtn.focus(); // focus modal'ga — keyboard foydalanuvchi darhol ko'radi

    backdrop.querySelector('[data-st-logout]').addEventListener('click', () => {
      window.location.href = '/user/logout';
    });
    keepBtn.addEventListener('click', () => keepAlive());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) keepAlive(); // backdrop click = davom etish (yumshoq)
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (!shown) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        document.removeEventListener('keydown', escHandler);
        keepAlive();
      }
    });
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function showModal() {
    if (shown) return;
    shown = true;
    saveHooks.runAutoSave(); // modal oldidan auto-save (imtihon ishi saqlanadi)
    if (!modalEl) modalEl = buildModal();
    // reflow'dan keyin is-open — animatsiya
    requestAnimationFrame(() => modalEl.classList.add('is-open'));
    startCountdown();
  }

  function hideModal() {
    if (!shown) return;
    shown = false;
    stopCountdown();
    if (modalEl) modalEl.classList.remove('is-open');
  }

  function startCountdown() {
    stopCountdown();
    updateCountdown();
    tickTimer = setInterval(updateCountdown, 1000);
  }
  function stopCountdown() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
  }
  function updateCountdown() {
    const left = remaining();
    if (left <= 0) {
      // Vaqt tugadi — auto-save + login'ga
      stopCountdown();
      saveHooks.runAutoSave();
      loginRedirect();
      return;
    }
    const el = modalEl && modalEl.querySelector('#st-timeout-count');
    if (el) el.textContent = String(Math.max(1, Math.ceil(left / 1000)));
  }

  // ── Asosiy tekshiruv sikl ──
  setInterval(() => {
    const left = remaining();
    if (left <= 0) {
      saveHooks.runAutoSave();
      loginRedirect();
      return;
    }
    if (!shown && left <= warnMs) showModal();
  }, 5000);
})();
