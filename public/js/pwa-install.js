/**
 * Edikit — PWA install prompt (AUTH D-13 §14)
 * ---------------------------------------------------------------------------
 * - beforeinstallprompt: deferred prompt saqlanadi (browser hukmron emas).
 * - 3-sessiya qoidasi: localStorage visit counter — 3-tashrifdan keyin banner.
 * - Banner: "Ilovani o'rnatish" + yopish (44px touch target).
 * - appinstalled → banner yashiriladi + bir marta ko'rsatilgan deb belgilanadi.
 * - Xavfsizlik: faqat secure context (beforeinstallprompt o'zi HTTPS talab qiladi);
 *   hech qanday PII yozilmaydi.
 */
(function () {
  'use strict';

  var VISIT_KEY = 'edikit_pwa_visits';
  var PROMPT_KEY = 'edikit_pwa_prompted';
  var THRESHOLD = 3; // 3-sessiya qoidasi (D-13 §14)

  var deferredPrompt = null;
  var banner = null;

  function visitCount() {
    try { return parseInt(localStorage.getItem(VISIT_KEY) || '0', 10) || 0; } catch (_) { return 0; }
  }

  function markVisited() {
    try { localStorage.setItem(VISIT_KEY, String(visitCount() + 1)); } catch (_) {}
  }

  function prompted() {
    try { return !!localStorage.getItem(PROMPT_KEY); } catch (_) { return true; }
  }

  function markPrompted() {
    try { localStorage.setItem(PROMPT_KEY, '1'); } catch (_) {}
  }

  function hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function maybeShow() {
    if (!deferredPrompt || prompted() || visitCount() < THRESHOLD) return;
    if (document.querySelector('.pwa-install-banner')) return;

    banner = document.createElement('div');
    banner.className = 'pwa-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');

    var text = document.createElement('div');
    text.className = 'pwa-install-text';
    text.textContent = "Edikit'ni ilova sifatida o'rnating — tezroq va offline ishlaydi";

    var installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.className = 'pwa-install-btn';
    installBtn.textContent = "O'rnatish";
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          markPrompted();
          hideBanner();
        } else {
          // Rad etildi — 7 kundan keyin qayta (sessiya hisoblagichi davom etadi)
          try { localStorage.setItem(PROMPT_KEY, '1'); } catch (_) {}
          hideBanner();
        }
      }).catch(hideBanner);
      deferredPrompt = null;
    });

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pwa-install-close';
    closeBtn.setAttribute('aria-label', 'Yopish');
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', function () {
      markPrompted();
      hideBanner();
    });

    banner.appendChild(text);
    banner.appendChild(installBtn);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);
  }

  // Har sahifa ochilishida tashrif sanaladi (3-sessiya qoidasi)
  markVisited();

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    maybeShow();
  });

  window.addEventListener('appinstalled', function () {
    markPrompted();
    hideBanner();
  });

  // PWA rejimida (standalone) banner kerak emas
  if (window.matchMedia('(display-mode: standalone)').matches) hideBanner();
})();
