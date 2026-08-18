/**
 * Edikit — Landing client (plan_index §3/§9, STEP 21)
 * Demo modal (focus trap), how tabs, analytics event'lar, scroll depth.
 * Deferred (landing.js at bottom) — INP uchun minimal.
 * (STEP 21 S21.07: stats/count-up olib tashlandi — fake proof yo'q.)
 */
(function () {
  'use strict';

  // ── Analytics (plan_index §9) — qulashsa ham hech narsa buzilmaydi ──
  function track(event, data) {
    try {
      if (typeof window.gtag === 'function') window.gtag('event', event, data || {});
      if (typeof window.fbq === 'function') window.fbq('trackCustom', event, data || {});
    } catch (_) { /* noop */ }
    // data-analytics attribute'larni qayd qilish (debug)
    if (window.__landingAnalytics) window.__landingAnalytics.push({ event, data: data || {} });
  }

  // data-analytics attribute'lari bo'lgan elementlarga listener
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-analytics]');
    if (!el) return;
    const event = el.getAttribute('data-analytics');
    const data = {};
    ['data-cta', 'data-role', 'data-feature', 'data-stat', 'data-lang'].forEach(function (k) {
      const v = el.getAttribute(k);
      if (v !== null) data[k.replace('data-', '')] = v;
    });
    track(event, data);
  });

  // ── STEP 23 S23.11 — first-click analytics (privacy-safe, PII yo'q, bir marta) ──
  var firstClickSent = false;
  document.addEventListener('click', function (e) {
    if (firstClickSent) return;
    var el = e.target.closest('[data-cta]');
    if (!el) return;
    firstClickSent = true;
    // Faqat event nomi + cta turi (visual preference emas, haqiqiy conversion proxy)
    track('first_click', { cta: el.getAttribute('data-cta') });
  }, { capture: true });

  // ── Scroll depth (25/50/75/100) ──
  var fired = {};
  window.addEventListener('scroll', function throttleScroll() {
    var doc = document.documentElement;
    var pct = Math.round(((window.scrollY || doc.scrollTop) / Math.max(1, (doc.scrollHeight - window.innerHeight))) * 100);
    [25, 50, 75, 100].forEach(function (t) {
      if (pct >= t && !fired[t]) { fired[t] = true; track('scroll_depth', { depth: t }); }
    });
  }, { passive: true });

  // ── How-it-works tabs ──
  // S14.07: ARIA tabs pattern public/js/components/tabs.js da ([data-tabs] wrapper)
  // Eski div/aria-manual switching olib tashlandi — tabs.js roving tabindex,
  // arrow-nav, Home/End va aria-selected'ni boshqaradi. Faqat is-active sinf
  // sync (landing styleni uchun) shu yerda qo'llanadi.
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tabs] [role="tab"]');
    if (!tab) return;
    var tabs = tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]');
    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t === tab);
    });
  });

  // ── Demo modal (focus trap) ──
  var modal = document.getElementById('ld-demo-modal');
  var openBtn = document.querySelector('[data-demo-open]');
  var lastFocused = null;

  function openModal() {
    if (!modal) return;
    lastFocused = document.activeElement;
    modal.hidden = false;
    track('demo_start', {});
    var first = modal.querySelector('.ld-demo-opt');
    if (first) first.focus();
    resetDemo();
  }
  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    track('demo_close', {});
  }

  function resetDemo() {
    var result = document.getElementById('ld-demo-result');
    var cta = document.querySelector('.ld-demo-cta');
    var opts = document.querySelectorAll('.ld-demo-opt');
    if (result) { result.hidden = true; result.classList.remove('is-good', 'is-bad'); }
    if (cta) cta.hidden = true;
    opts.forEach(function (o) { o.classList.remove('is-correct', 'is-wrong'); o.disabled = false; });
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (modal) {
    modal.querySelectorAll('[data-demo-close]').forEach(function (b) {
      b.addEventListener('click', closeModal);
    });
    document.addEventListener('keydown', function (e) {
      if (modal.hidden) return;
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key === 'Tab') {
        // focus trap
        var focusables = modal.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    });
  }

  // Demo javob tanlash
  document.addEventListener('click', function (e) {
    var opt = e.target.closest('.ld-demo-opt');
    if (!opt) return;
    var correct = opt.getAttribute('data-answer') === '1';
    opt.classList.add(correct ? 'is-correct' : 'is-wrong');
    var all = document.querySelectorAll('.ld-demo-opt');
    all.forEach(function (o) { if (o !== opt) o.disabled = true; });
    var result = document.getElementById('ld-demo-result');
    var cta = document.querySelector('.ld-demo-cta');
    if (result) {
      result.textContent = correct
        ? (window.__ldDemoGood || 'To\'g\'ri! 🎉 — sinfingiz ham shunday tez tushunadi.')
        : (window.__ldDemoBad || 'Hmm, bu yerga yana qaraymiz. Izohli javob shu yerda.');
      result.classList.add(correct ? 'is-good' : 'is-bad');
      result.hidden = false;
    }
    if (cta) cta.hidden = false;
    track('demo_answer', { correct: correct });
    if (correct) track('demo_complete', {});
  });
})();
