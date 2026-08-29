/**
 * Deborah — Client-side Utilities
 */

// ── DOM shortcuts ──
// MUHIM (BUG-012/044): window property sifatida eksport qilamiz — global `const $`
// bo'lsa, sahifalardagi inline `const $` bilan "already declared" SyntaxError
// berib butun script blokini o'ldirardi (22 ta view ta'sirlangan edi).
window.$ = (id) => document.getElementById(id);
window.qs = (sel) => document.querySelector(sel);
window.qsa = (sel) => document.querySelectorAll(sel);

// ── Debounce ──
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ── Throttle ──
function throttle(fn, limit = 300) {
  let inThrottle = false;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// ── Format time (seconds → human-readable) ──
function fmtTime(s) {
  s = Math.round(s || 0);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

// ── Format date ──
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ── Copy to clipboard ──
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

// ── Show notification / Confirm dialog ──
// showToast va showConfirm endi /js/components/overlays.js da (S15)
// — reusable semantic dialog/toast component'lari, inline CSS yo'q.

// ── S16.04: Button pending state ──
// Original label va width saqlanadi; duplicate submit bloklanadi.
// Usage: const done = setPending(btn, 'Saqlanmoqda…'); try { … } finally { done(); }
function setPending(btn, pendingLabel) {
  if (!btn || btn.dataset.__pending) return () => {};
  btn.dataset.__pending = '1';
  const label = btn.querySelector('.btn-label');
  const original = label ? label.textContent : btn.textContent;
  const width = btn.getBoundingClientRect().width;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  // width barqaror — label almashganda sakrash yo'q
  btn.style.minWidth = width + 'px';
  if (label) label.textContent = pendingLabel || original;
  else btn.textContent = pendingLabel || original;
  return function done() {
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.style.minWidth = '';
    if (label) label.textContent = original;
    else btn.textContent = original;
    delete btn.dataset.__pending;
  };
}

// ── CSRF-safe fetch wrapper ──
// Automatically includes X-CSRF-Token header on state-changing requests
async function apiFetch(url, options = {}) {
  try {
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add CSRF token for state-changing methods
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && window.__CSRF_TOKEN) {
      headers['X-CSRF-Token'] = window.__CSRF_TOKEN;
    }

    const res = await fetch(url, {
      method,
      body: options.body,
      ...options,
      headers, // always wins — preserves CSRF token over options.headers
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    showToast('Xato: ' + err.message, 'err');
    return null;
  }
}
