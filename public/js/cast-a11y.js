/**
 * Cast C4-04 — Accessibility client
 * ---------------------------------
 * Har bir cast sahifasida (director/participant/projector) yuklanadi.
 * Markazlashgan live-region announce, timer threshold announcement,
 * high-contrast / reduced-motion toggle, keyboard hint panel.
 *
 * global: window.CastA11y
 */
(function () {
  'use strict';

  const STORE_KEY = 'castA11yPrefs';
  const root = document.documentElement;

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (_) {
      return {};
    }
  }
  function savePrefs(p) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
    } catch (_) { /* private mode */ }
  }

  function apply(prefs) {
    // Theme: focus_dark | focus_light | hc_dark | hc_light
    const body = document.body;
    if (prefs.theme) {
      body.dataset.castTheme = prefs.theme;
    }
    if (prefs.reducedMotion) {
      body.dataset.castMotion = 'none';
    } else {
      delete body.dataset.castMotion;
    }
    if (prefs.fontScale && prefs.fontScale !== 1) {
      body.dataset.castFontScale = String(prefs.fontScale);
    } else {
      delete body.dataset.castFontScale;
    }
  }

  // ── Live region announce (item 5/8/9) ──
  let lastAnnounceTs = 0;
  function announce(msg, kindOrAssertive) {
    const assertive =
      typeof kindOrAssertive === 'boolean'
        ? kindOrAssertive
        : kindOrAssertive === 'assertive' ||
          (kindOrAssertive && /questionClosed|error|disconnect/.test(kindOrAssertive));
    // polite politsiyasi: bir xil xabarni 3s ichida takrorlamaslik
    const now = Date.now();
    if (!assertive && msg && msg === announce.lastMsg && now - lastAnnounceTs < 3000) return;
    announce.lastMsg = msg;
    lastAnnounceTs = now;
    const el = document.getElementById(assertive ? 'alert-live' : 'status-live');
    if (el) el.textContent = msg;
  }

  // ── Timer announcement (item 6/7: 30/10/5/0 policy) ──
  // CastA11y.watchTimer({ getRemaining: () => seconds, announce: (msg)=>{} })
  let timerWatcher = null;
  let lastTimerAnnounced = null;
  function watchTimer(opts) {
    if (timerWatcher) clearInterval(timerWatcher);
    if (!opts || !opts.getRemaining) return;
    lastTimerAnnounced = null;
    timerWatcher = setInterval(() => {
      const remaining = opts.getRemaining();
      if (remaining === null || remaining === undefined) return;
      const r = Math.max(0, Math.round(remaining));
      // C4-04 review fix #1: threshold faqat roppa-rosa kesib o'tilganda e'lon qilinadi
      // (qisqa timer boshida "30 soniya qoldi" chiqmaydi)
      const thresholds = [30, 10, 5, 0];
      for (const th of thresholds) {
        if (r === th && lastTimerAnnounced !== th) {
          lastTimerAnnounced = th;
          // C4-05: locale-aware timer announcement (key qaytsa — catalog hali yuklanmagan, fallback)
          let msg = th === 0 ? 'Vaqt tugadi' : `${th} soniya qoldi`;
          if (window.CastI18n && window.CastI18n.t) {
            const localized = window.CastI18n.t(th === 0 ? 'timer.announce.0' : th === 5 ? 'timer.announce.5' : th === 10 ? 'timer.announce.10' : 'timer.announce.30');
            if (localized && !localized.startsWith('timer.announce.')) msg = localized;
          }
          (opts.announce || announce)(msg, 'timer');
          break;
        }
      }
    }, 500);
  }
  function stopTimerWatcher() {
    if (timerWatcher) { clearInterval(timerWatcher); timerWatcher = null; }
    lastTimerAnnounced = null;
  }

  // ── High contrast toggle (item 18) ──
  function toggleTheme() {
    const prefs = loadPrefs();
    const order = ['focus_dark', 'focus_light', 'hc_dark', 'hc_light'];
    const cur = prefs.theme || 'focus_dark';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    prefs.theme = next;
    prefs.highContrast = next.startsWith('hc_');
    savePrefs(prefs);
    apply(prefs);
    announce(`Tema: ${next === 'focus_dark' ? 'quyuq' : next === 'focus_light' ? 'yoruq' : next.startsWith('hc_') ? 'yuqori kontrast' : 'tema'}`);
    return next;
  }

  // ── Chart accessible table (item 11) ──
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /**
   * `.ev-dist-row` (yoki mos row selectors) dan sr-only jadval quradi.
   * @param {HTMLElement} container
   * @param {string} rowSel row selectori (default '.ev-dist-row')
   */
  function attachChartTable(container, rowSel) {
    if (!container || container.querySelector('.cast-chart-table')) return;
    const rows = Array.from(container.querySelectorAll(rowSel || '.ev-dist-row'));
    if (!rows.length) return;
    const cells = rows.map((r) => {
      const label = r.querySelector('.ev-dist-opt')?.textContent || '';
      const num = r.querySelector('.ev-dist-num')?.textContent || '';
      return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(num)}</td></tr>`;
    }).join('');
    const table = document.createElement('table');
    table.className = 'cast-chart-table sr-only';
    table.innerHTML = `<caption>Natijalar jadvali</caption><thead><tr><th scope="col">Variant</th><th scope="col">Son (foiz)</th></tr></thead><tbody>${cells}</tbody>`;
    container.appendChild(table);
  }

  // ── Keyboard hint panel (item 23) ──
  const HINTS = [
    { keys: '1 / A', action: 'Birinchi variant' },
    { keys: '2 / B', action: 'Ikkinchi variant' },
    { keys: '3 / C', action: 'Uchinchi variant' },
    { keys: '4 / D', action: 'To‘rtinchi variant' },
    { keys: 'Enter', action: 'Yuborish' },
    { keys: '→', action: 'Keyingi savol (o‘qituvchi)' },
    { keys: 'P', action: 'Pauza (o‘qituvchi)' },
    { keys: 'L', action: 'Savolni yopish (o‘qituvchi)' },
  ];
  let hintPanel = null;
  function toggleHintPanel(role) {
    if (hintPanel && hintPanel.parentNode) {
      hintPanel.remove();
      hintPanel = null;
      return;
    }
    hintPanel = document.createElement('div');
    hintPanel.className = 'cast-hints';
    hintPanel.setAttribute('role', 'dialog');
    hintPanel.setAttribute('aria-label', 'Klaviatura yorliqlari');
    // Role filter: participant -> student shortcutlar; director -> hammasi (qo'shimchalar bilan)
    const all = role === 'director' || role === 'projector';
    const rows = HINTS.filter((h) => all || !h.action.includes('(o‘qituvchi)'))
      .map((h) => `<div class="cast-hint-row"><kbd>${h.keys}</kbd><span>${h.action}</span></div>`)
      .join('');
    hintPanel.innerHTML = `<div class="cast-hints-head">⌨️ Klaviatura yorliqlari <button type="button" class="cast-hints-close" aria-label="Yopish">✕</button></div>${rows}`;
    document.body.appendChild(hintPanel);
    hintPanel.querySelector('.cast-hints-close').addEventListener('click', () => {
      hintPanel.remove();
      hintPanel = null;
    });
    const first = hintPanel.querySelector('.cast-hints-close');
    if (first) first.focus();
  }

  function init(opts) {
    opts = opts || {};
    apply(loadPrefs());
    // CSS-only toggles ham body dataset orqali ishlaydi
    const api = {
      announce,
      watchTimer,
      stopTimerWatcher,
      toggleTheme,
      toggleHintPanel,
      attachChartTable,
      loadPrefs,
      savePrefs,
      apply,
    };
    window.CastA11y = api;

    // Toggle tugmasi (agar sahifada bor bo'lsa)
    document.querySelectorAll('[data-a11y-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.a11yToggle === 'theme') toggleTheme();
        if (btn.dataset.a11yToggle === 'hints') toggleHintPanel(opts.role);
      });
    });

    // Klaviatura: "?" yoki "Shift+/" hint panel ochadi (item 23)
    // Review fix #2: input/textarea'da yozayotganda panel ochilmasligi kerak
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if ((e.key === '?' && e.shiftKey) || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        toggleHintPanel(opts.role);
      }
    });

    if (opts.onReady) opts.onReady(api);
    return api;
  }

  window.CastA11yInit = init;
})();
