/**
 * Edikit — Client-side Utilities
 */

// ── DOM shortcuts ──
const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);

// ── HTML Escape (XSS protection) ──
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

// ── Show notification (temporary) ──
function showToast(message, type = 'ok', duration = 2000) {
  const existing = qs('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    z-index: 9999; padding: 12px 24px; border-radius: 12px;
    font-family: 'Nunito', sans-serif; font-size: .85rem; font-weight: 800;
    background: ${type === 'ok' ? 'rgba(56,189,248,.15)' : 'rgba(37,99,235,.15)'};
    border: 1px solid ${type === 'ok' ? 'rgba(56,189,248,.3)' : 'rgba(37,99,235,.3)'};
    color: ${type === 'ok' ? 'var(--green)' : 'var(--accent)'};
    backdrop-filter: blur(10px); box-shadow: 0 8px 30px rgba(0,0,0,.4);
    animation: slideUp .3s ease-out;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Confirm dialog ──
function showConfirm(title, sub, okText = 'Ha') {
  return new Promise((resolve) => {
    const existing = qs('.confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 950; display: flex;
      align-items: center; justify-content: center;
      padding: 20px; background: rgba(0,0,0,.6);
      backdrop-filter: blur(4px); animation: fadeIn .15s ease;
    `;
    overlay.innerHTML = `
      <div style="background:var(--surf);border-radius:18px;padding:24px;
        width:100%;max-width:340px;border:1px solid var(--border);text-align:center;
        animation:slideUp .2s ease;">
        <div style="font-family:'Righteous',cursive;font-size:1.1rem;margin-bottom:6px;">${esc(title)}</div>
        <p style="color:var(--muted);font-size:.82rem;line-height:1.6;margin-bottom:18px;">${esc(sub)}</p>
        <div style="display:flex;gap:8px;">
          <button id="conf-no" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--border);
            background:rgba(255,255,255,.06);color:var(--muted);font-family:'Nunito',sans-serif;
            font-size:.88rem;font-weight:900;cursor:pointer;">Bekor</button>
          <button id="conf-yes" style="flex:1;padding:11px;border-radius:10px;border:none;
            background:linear-gradient(135deg,var(--accent),#1d4ed8);color:#fff;
            font-family:'Nunito',sans-serif;font-size:.88rem;font-weight:900;cursor:pointer;">${esc(okText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#conf-no').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#conf-yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
  });
}

// ── Fetch wrapper ──
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    showToast('Xato: ' + err.message, 'err');
    return null;
  }
}
