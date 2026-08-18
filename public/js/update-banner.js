/* ─────────────────────────────────────────────────────────────────────
   Edikit PWA Update Banner (STYLE S34.08)
   - New service worker available → nonblocking banner + "Yangilash" action
   - Active Cast session'da forced reload qilinmaydi (manual click required)
   - Banner keyboard accessible (button), dismissible, reduced-motion aware
   ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;
  // Cast projector/participant sahifalarida forced UX buzilmaydi — banner hali ham ko'rinadi,
  // lekin hech qachon avtomatik reload qilinmaydi (S34.08).
  var isCastView = /\/cast\//.test(location.pathname);

  var banner = null;
  var dismissUntil = null;
  try {
    dismissUntil = parseInt(localStorage.getItem('edikit-update-dismiss') || '0', 10);
  } catch (_) { /* private mode */ }

  function showBanner() {
    if (dismissUntil && Date.now() < dismissUntil) return;
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML =
      '<div class="update-banner-body">' +
      '  <span class="update-banner-text">Yangi versiya mavjud</span>' +
      '  <button type="button" class="btn btn-primary update-banner-action">Yangilash</button>' +
      '  <button type="button" class="update-banner-close" aria-label="Yopish">×</button>' +
      '</div>';
    document.body.appendChild(banner);

    banner.querySelector('.update-banner-action').addEventListener('click', function () {
      banner.remove();
      banner = null;
      localStorage.setItem('edikit-update-dismiss', String(Date.now() + 1000 * 60 * 60)); // 1 soat
      // S34.08: faqat foydalanuvchi bosganda reload — Cast'da ham forced emas.
      // Race: reg.waiting yo'q bo'lsa reload qilinmaydi (eski SW'da qolishning oldini oladi).
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          return true;
        }
        return false;
      }).then(function (activated) {
        if (activated) location.reload();
      });
    });

    banner.querySelector('.update-banner-close').addEventListener('click', function () {
      banner.remove();
      banner = null;
      try { localStorage.setItem('edikit-update-dismiss', String(Date.now() + 1000 * 60 * 30)); } catch (_) {}
    });
  }

  // SW install'da xabar yuboradi (service-worker.js 'EDIKIT_UPDATE_AVAILABLE')
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'EDIKIT_UPDATE_AVAILABLE') {
      showBanner();
    }
  });

  // Controller almashtirilganda ham ko'rsatish (skipWaiting + clients.claim)
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    setTimeout(showBanner, 800);
  });
})();
