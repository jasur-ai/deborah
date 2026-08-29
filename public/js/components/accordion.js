/**
 * Deborah — Accordion (STYLE STEP 14, S14.09)
 * ----------------------------------------------
 * Header BUTTON + aria-expanded + aria-controls.
 * [data-accordion] wrapper ichida:
 *   .accordion > h3.accordion__header > button.accordion__trigger[aria-expanded][aria-controls]
 *                 > .accordion__panel[id] > .accordion__panel-inner
 *
 * Progressive enhancement: JS bo'lmasa ham panel ochiq/берк HTML state'da.
 * [data-accordion="single"] — bir vaqtda faqat bitta ochiq.
 */
(function () {
  'use strict';

  function initAccordion(wrapper) {
    var single = wrapper.getAttribute('data-accordion') === 'single';
    var items = Array.prototype.slice.call(wrapper.querySelectorAll('.accordion'));

    items.forEach(function (item) {
      var trigger = item.querySelector('.accordion__trigger');
      var panel = item.querySelector('.accordion__panel');
      if (!trigger || !panel) return;

      // aria-controls sync
      if (!trigger.getAttribute('aria-controls') && panel.id) {
        trigger.setAttribute('aria-controls', panel.id);
      }

      trigger.addEventListener('click', function () {
        var expanded = trigger.getAttribute('aria-expanded') === 'true';
        if (single) {
          items.forEach(function (other) {
            var t = other.querySelector('.accordion__trigger');
            var p = other.querySelector('.accordion__panel');
            if (t && t !== trigger) t.setAttribute('aria-expanded', 'false');
          });
        }
        trigger.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      });
    });
  }

  function init() {
    document.querySelectorAll('[data-accordion]').forEach(function (w) {
      if (!w.__deborahAccordion) {
        w.__deborahAccordion = true;
        initAccordion(w);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
