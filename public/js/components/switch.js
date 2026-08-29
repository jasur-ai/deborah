/**
 * S14.06 — Switch pending/rollback UX.
 * Toggle paytida (750ms) switch is-pending holatiga o'tadi — bu optimistic
 * update'da server javobini kutayotganda yoki rollback'da ko'rsatiladigan
 * visual kontrakt. Faqat [data-pending-switch] belgilangan switch'lar ishlaydi.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__deborahSwitchInit) return;
  window.__deborahSwitchInit = true;

  const PENDING_MS = 750;

  function bindSwitch(input) {
    const wrap = input.closest('.switch');
    if (!wrap || input.disabled) return;

    input.addEventListener('change', function () {
      // Optimistic: pending holatini qisqa ko'rsat (server ack kontrakti)
      wrap.classList.add('is-pending');
      input.disabled = true;
      setTimeout(function () {
        wrap.classList.remove('is-pending');
        input.disabled = false;
      }, PENDING_MS);
    });
  }

  function scan(root) {
    (root || document).querySelectorAll('[data-pending-switch] .switch__input').forEach(bindSwitch);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(); });
  } else {
    scan();
  }
  // Mutatsiyalar uchun (SPA/dinamik render)
  if (window.MutationObserver) {
    const mo = new MutationObserver(function (muts) {
      for (const m of muts) {
        if (m.addedNodes.length) {
          for (const n of m.addedNodes) {
            if (n.querySelector && n.querySelector('[data-pending-switch] .switch__input')) scan(n);
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
