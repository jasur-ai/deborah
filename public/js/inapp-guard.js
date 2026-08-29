/**
 * Deborah — In-app browser guard (AUTH D-13 §17, security)
 * -------------------------------------------------------------------
 * Telegram/WhatsApp/Instagram kabi ilovalarning ichki brauzerlarida
 * login/parol kiritish xavfsiz emas (JS inject, tarix kuzatuvi).
 * User-Agent orqali WebView aniqlansa — banner ko'rsatiladi:
 *   "Tashqi brauzerda oching" + tashqi brauzerga ochish tugmasi.
 *
 * i18n: window.__INAPP_COPY__ (data/auth-i18n.js `mobile` bloki) —
 * yo'q bo'lsa uz fallback. EJS'da ulash:
 *   <script>window.__INAPP_COPY__ = <%- JSON.stringify(copy.mobile || {}) %>;</script>
 *   <script src="/js/inapp-guard.js" defer></script>
 *
 * XSS: barcha matnlar textContent bilan (innerHTML yo'q).
 */
(function () {
  'use strict';

  var copy = {};
  try { copy = JSON.parse(window.__INAPP_COPY__ || '{}'); } catch (_) {}
  function t(key, fallback) { return copy[key] || fallback || ''; }

  var UA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  var uaL = UA.toLowerCase();

  // Mashhur ilovalar WebView'lari (in-app browser)
  var WEBVIEW_RE = /telegram|whatsapp|instagram|fbav|line|viber|wechat|snapchat|tiktok/i;

  if (!WEBVIEW_RE.test(uaL)) return;

  // Banner yaratish
  var banner = document.createElement('div');
  banner.className = 'inapp-banner';
  banner.setAttribute('role', 'status');
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fff;' +
    'padding:12px 16px;font-size:.82rem;font-weight:700;display:flex;align-items:center;' +
    'justify-content:space-between;gap:10px;box-shadow:0 2px 12px rgba(0,0,0,.3);';

  var msg = document.createElement('span');
  msg.textContent = t('realBrowser', "Xavfsizlik uchun parolni faqat brauzerda kiriting — Telegram kabi ilova brauzerlarida login xavfsiz emas. Sahifani brauzerda oching.");
  msg.style.flex = '1';

  var openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = t('openBrowser', 'Tashqi brauzerda oching');
  openBtn.style.cssText =
    'border:none;border-radius:8px;background:#fff;color:#7f1d1d;padding:8px 14px;' +
    'font-weight:800;font-size:.78rem;cursor:pointer;white-space:nowrap;min-height:44px;';
  openBtn.addEventListener('click', function () {
    // Tashqi brauzer: Telegram'da bu "Open in external browser" — URL o'zi ochiladi.
    // `window.open` bloklanishi mumkin — avval shu usul, yo'q bo'lsa havola.
    var opened = false;
    try {
      opened = window.open(window.location.href, '_blank');
    } catch (_) { /* popup bloklangan bo'lishi mumkin */ }
    if (!opened) {
      // Telegram WebView'da `window.open` bloklansa — Telegram API orqali
      // external browser faqat user interaktiv bosganida ishlaydi.
      var a = document.createElement('a');
      a.href = window.location.href;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Yopish');
  closeBtn.style.cssText =
    'border:none;background:transparent;color:#fff;font-size:1.2rem;cursor:pointer;' +
    'min-width:44px;min-height:44px;';
  closeBtn.addEventListener('click', function () { banner.remove(); });

  banner.appendChild(msg);
  banner.appendChild(openBtn);
  banner.appendChild(closeBtn);

  if (document.body) document.body.prepend(banner);
  else document.addEventListener('DOMContentLoaded', function () { document.body.prepend(banner); });
})();
