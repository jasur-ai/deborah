/**
 * Edikit — Form field enhancements (STYLE STEP 13)
 * --------------------------------------------------
 * S13.01 — live character counter: .form-field__count[data-for][data-max]
 *          maxlength'dan oshsa data-over attribute qo'yiladi (CSS red).
 * Progressive enhancement: JS bo'lmasa ham static count ko'rinadi.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.form-field__count[data-for]').forEach(function (el) {
      var input = document.getElementById(el.getAttribute('data-for'));
      var max = parseInt(el.getAttribute('data-max') || '0', 10);
      if (!input || !max) return;

      var update = function () {
        var len = input.value.length;
        el.textContent = len + '/' + max;
        if (len > max) el.setAttribute('data-over', 'true');
        else el.removeAttribute('data-over');
      };

      input.addEventListener('input', update);
      update();
    });
  });
})();
