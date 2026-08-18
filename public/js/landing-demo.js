/**
 * Edikit — Landing product stage (STEP 22 S22.07)
 * Hero stage'ning optional animatsiyasi: prefers-reduced-motion yoki
 * Save-Data rejimida static variant default qoladi (fallback).
 * Animatsiya CSS keyframes (landing.css: ld-rail-grow / ld-fade-in) orqali,
 * `is-anim` class'ini ruxsat berilganda qo'shadi. Buzilish — xavfsiz no-op.
 */
(function () {
  'use strict';

  var stage = document.querySelector('[data-stage]');
  if (!stage) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);

  // Static default — animatsiya yo'q (S22.07: reduced-motion/low-data fallback)
  if (reduceMotion || saveData) return;

  if ('requestAnimationFrame' in window) {
    requestAnimationFrame(function () {
      stage.classList.add('is-anim');
    });
  }
})();
