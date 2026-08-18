/**
 * Edikit — Device fingerprint (AUTH A-28)
 * ---------------------------------------------------------------
 * Yengil stable hash: canvas render + navigator signalari → FNV-1a hash.
 * - Server'ga FAQAT hash yuboriladi (raw telemetry hech qachon emas).
 * - localStorage'da cache — har reload'da bir xil hash (stability).
 * - Progresiv: hash hisoblanmasa (privacy blocker) → null → risk'da
 *   yangi-qurilma signali bermaydi (fail-safe).
 */
(function () {
  'use strict';

  var CACHE_KEY = 'edikit_device_fp_v2'; // v2: 16 belgili hash (v1 8 belgi edi — server talabi {16,64})
  var cache = null;
  try {
    cache = window.localStorage.getItem(CACHE_KEY);
    // Eski v1 (8 belgi) cache'ini ishlatma — server validatsiyasidan o'tmaydi
    if (cache && cache.length < 16) cache = null;
  } catch (_) {}

  /** FNV-1a 32-bit — tez, deterministik, sync. @returns son (unsigned). */
  function fnv1a(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h;
  }

  /** 16 belgili hex: ikki FNV-1a round (turli seed) — collision ehtimoli past. */
  function fnv1a16(str) {
    var h1 = ('00000000' + fnv1a(str, 0x811c9dc5).toString(16)).slice(-8);
    var h2 = ('00000000' + fnv1a(str, 0x9747b28c).toString(16)).slice(-8);
    return h1 + h2; // 16 hex belgi — server {16,64} talabiga mos
  }

  /** Canvas render hash — GPU/driver ga qarab stable farq beradi. */
  function canvasSig() {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 220;
      canvas.height = 40;
      var ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f5f7fa';
      ctx.fillRect(0, 0, 220, 40);
      ctx.fillStyle = '#123456';
      ctx.fillText('Edikit\u2022fingerprint\u00a7' + navigator.userAgent.slice(0, 40), 2, 2);
      ctx.fillStyle = '#abcdef';
      ctx.fillRect(80, 8, 60, 14);
      ctx.strokeStyle = '#fedcba';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(10, 30);
      ctx.lineTo(200, 8);
      ctx.stroke();
      return canvas.toDataURL();
    } catch (_) {
      return '';
    }
  }

  /** Stable signal komponentlari — hash'ga kiritiladi (raw emas). */
  function collectSignals() {
    var parts = [];
    try {
      parts.push(navigator.userAgent || '');
      parts.push(navigator.language || '');
      parts.push(String(navigator.languages || []).slice(0, 120));
      parts.push(navigator.platform || '');
      parts.push(String(screen.width) + 'x' + String(screen.height) + 'x' + String(screen.colorDepth || 0));
      parts.push(String(new Date().getTimezoneOffset()));
      parts.push(String(navigator.hardwareConcurrency || 0));
      parts.push(String(navigator.maxTouchPoints || 0));
      parts.push(String(navigator.deviceMemory || 0));
      parts.push(navigator.cookieEnabled ? '1' : '0');
      // WebGL renderer (GPU vendor agregation) — raw emas, hash'ga ketadi
      try {
        var gl = document.createElement('canvas').getContext('webgl');
        if (gl) {
          var ext = gl.getExtension('WEBGL_debug_renderer_info');
          if (ext) {
            parts.push(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').slice(0, 64));
          }
        }
      } catch (_) {}
    } catch (_) {}
    parts.push(canvasSig());
    return parts;
  }

  function compute() {
    // Privacy blocker (canvas tashqari) → null — fail-safe
    try {
      if (!window.navigator || typeof document.createElement !== 'function') return null;
    } catch (_) {
      return null;
    }
    var signals = collectSignals();
    // Hash: alohida komponentlarni FNV'da birlashtirish (deterministik)
    var h = fnv1a16('edikit|' + signals.join('|'));
    // Stability guard: bo'sh bo'lsa null (canvas/JS o'chirilgan)
    if (h === '811c9dc59747b28c') return null;
    return h;
  }

  var api = {
    /** Compute (cache'dan yoki yangi). Faqat hash — raw signal YO'Q. */
    compute: function () {
      if (cache) return cache;
      var h = compute();
      if (h) {
        try {
          window.localStorage.setItem(CACHE_KEY, h);
        } catch (_) {}
        cache = h;
      }
      return h;
    },
    /** Login form'iga hidden input qo'shadi (progresiv — no-JS ham ishlaydi). */
    attach: function (form) {
      if (!form || typeof form.querySelector !== 'function') return;
      var h = this.compute();
      if (!h) return;
      var input = form.querySelector('input[name="device_fp"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'device_fp';
        form.appendChild(input);
      }
      input.value = h;
    },
  };

  window.EdikitDeviceFingerprint = api;
  // Panel/host sahifalar: barcha auth form'larga avtomatik attach
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      document.querySelectorAll('form[data-device-fp]').forEach(function (f) { api.attach(f); });
    });
  } else {
    document.querySelectorAll('form[data-device-fp]').forEach(function (f) { api.attach(f); });
  }
})();
