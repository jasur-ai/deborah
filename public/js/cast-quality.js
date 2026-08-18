/**
 * Edikit — Cast Quality Lab
 * --------------------------
 * - Rehearsal bot scenario runner (fast_correct, wrong_cluster, ...)
 * - Preflight / Postflight findings UI
 * - Finding status workflow (accept / dismiss / resolve)
 * - XSS-safe: barcha dinamik matn textContent orqali
 */
(function (global) {
  'use strict';

  const BOOT = global.__BOOT__ || {};
  const CSRF = global.__CSRF_TOKEN || '';

  const sessionId = BOOT.sessionId;
  const rehearsal = !!BOOT.rehearsal;

  function el(id) { return document.getElementById(id); }

  function statusLive(msg) {
    const node = el('ql-live');
    if (node) node.textContent = msg;
  }
  function alertLive(msg) {
    const node = el('ql-alert');
    if (node) node.textContent = msg;
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CSRF-Token': CSRF,
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = data.error || { message: 'So\'rov xatosi' };
      throw new Error(err.message || 'Xatolik');
    }
    return data;
  }

  // ── Finding card render (XSS-safe) ──
  const SEVERITY_META = {
    BLOCKER: { cls: 'ql-find-blocker', label: 'BLOCKER' },
    WARNING: { cls: 'ql-find-warning', label: 'WARNING' },
    INFO: { cls: 'ql-find-info', label: 'INFO' },
  };
  const STATUS_LABEL = {
    OPEN: 'Ochiq',
    ACCEPTED: 'Qabul qilingan',
    DISMISSED: 'Rad etilgan',
    RESOLVED: 'Hal qilingan',
  };

  function findingCard(f) {
    const sev = SEVERITY_META[f.severity] || SEVERITY_META.INFO;
    const card = document.createElement('div');
    card.className = 'ql-finding ' + sev.cls;

    const head = document.createElement('div');
    head.className = 'ql-finding-head';

    const badge = document.createElement('span');
    badge.className = 'ql-find-badge ' + sev.cls;
    badge.textContent = sev.label;

    const code = document.createElement('span');
    code.className = 'ql-find-code';
    code.textContent = f.code || '';

    const st = document.createElement('span');
    st.className = 'ql-find-status';
    st.textContent = STATUS_LABEL[f.status] || f.status || 'OPEN';

    head.appendChild(badge);
    head.appendChild(code);
    head.appendChild(st);
    card.appendChild(head);

    const msg = document.createElement('div');
    msg.className = 'ql-find-msg';
    msg.textContent = f.message || '';
    card.appendChild(msg);

    if (f.fieldPath || f.questionId) {
      const meta = document.createElement('div');
      meta.className = 'ql-find-meta';
      if (f.questionId) meta.textContent += 'Savol: ' + f.questionId + '  ';
      if (f.fieldPath) meta.textContent += 'Manzil: ' + f.fieldPath;
      card.appendChild(meta);
    }

    if (f.status === 'OPEN') {
      const actions = document.createElement('div');
      actions.className = 'ql-find-actions';
      const mkBtn = (label, cls, status) => {
        const b = document.createElement('button');
        b.className = 'cast-btn cast-btn-sm ' + cls;
        b.textContent = label;
        b.addEventListener('click', async () => {
          try {
            await api(`/api/cast/quality/findings/${f.id}/status`, { sessionId, status });
            alertLive('Xulosa: ' + STATUS_LABEL[status]);
            loadAll();
          } catch (err) {
            alertLive('Xato: ' + err.message);
          }
        });
        return b;
      };
      actions.appendChild(mkBtn('✓ Accept', 'cast-btn-primary', 'ACCEPTED'));
      actions.appendChild(mkBtn('✓ Hal qilish', 'cast-btn-ghost', 'RESOLVED'));
      actions.appendChild(mkBtn('✕ Rad etish', 'cast-btn-danger', 'DISMISSED'));
      card.appendChild(actions);
    }
    return card;
  }

  function renderFindings(container, findings, report) {
    container.textContent = '';
    if (!findings || findings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ql-empty';
      empty.textContent = '✅ Topilma yo\'q — hammasi yaxshi';
      container.appendChild(empty);
      return;
    }
    if (report) {
      const rep = document.createElement('div');
      rep.className = 'ql-report';
      rep.textContent =
        'Jami: ' + report.total +
        '  •  🔴 Blocker: ' + report.bySeverity.BLOCKER +
        '  •  🟠 Warning: ' + report.bySeverity.WARNING +
        '  •  🔵 Info: ' + report.bySeverity.INFO;
      container.appendChild(rep);
    }
    findings.forEach((f) => container.appendChild(findingCard(f)));
  }

  // ── Preflight ──
  async function runPreflight() {
    const btn = el('ql-run-preflight');
    const results = el('ql-preflight-results');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Tekshirilmoqda…'; }
    statusLive('Preflight ishga tushirilmoqda…');
    try {
      const data = await api(`/api/cast/quality/${sessionId}/preflight`, {});
      renderFindings(results, data.findings, data.report);
      alertLive('Preflight yakunlandi — ' + (data.report ? data.report.total : 0) + ' xulosa');
      loadAll();
    } catch (err) {
      renderFindings(results, []);
      const errBox = document.createElement('div');
      errBox.className = 'ql-empty ql-empty-err';
      errBox.textContent = 'Preflight xatosi: ' + err.message;
      results.textContent = '';
      results.appendChild(errBox);
      alertLive('Preflight xatosi: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Ishga tushirish'; }
    }
  }

  // ── Postflight ──
  async function runPostflight() {
    const btn = el('ql-run-postflight');
    const results = el('ql-postflight-results');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Tahlil qilinmoqda…'; }
    statusLive('Postflight tahlili ishga tushirilmoqda…');
    try {
      const data = await api('/api/cast/quality/postflight', { sessionId });
      renderFindings(results, data.findings, data.report);
      alertLive('Postflight yakunlandi — ' + (data.report ? data.report.total : 0) + ' xulosa');
      loadAll();
    } catch (err) {
      const errBox = document.createElement('div');
      errBox.className = 'ql-empty ql-empty-err';
      errBox.textContent = 'Postflight xatosi: ' + err.message;
      results.textContent = '';
      results.appendChild(errBox);
      alertLive('Postflight xatosi: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Tahlil qilish'; }
    }
  }

  // ── All findings list (GET — analizni qayta ishga tushirmaydi) ──
  async function loadAll() {
    try {
      const res = await fetch(`/api/cast/quality/${sessionId}/findings`, {
        headers: { 'CSRF-Token': CSRF },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error((data.error && data.error.message) || 'Xatolik');
      const list = data.all ? Object.values(data.all) : [];
      if (list.length) {
        renderFindings(el('ql-findings-list'), list, null);
      } else {
        el('ql-findings-list').textContent = '';
        const empty = document.createElement('div');
        empty.className = 'ql-empty';
        empty.textContent = 'Hozircha xulosalar yo\'q';
        el('ql-findings-list').appendChild(empty);
      }
    } catch (_) { /* non-critical refresh */ }
  }

  // ── Bots ──
  async function startBots() {
    const scenarioId = el('ql-scenario') ? el('ql-scenario').value : 'fast_correct';
    const count = el('ql-bot-count') ? Math.max(1, Math.min(Number(el('ql-bot-count').value) || 10, 100)) : 10;
    const btn = el('ql-start-bots');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Ishga tushirilmoqda…'; }
    statusLive('Botlar ishga tushirilmoqda…');
    try {
      const data = await api(`/api/cast/rehearsal/${sessionId}/bots`, { scenarioId, count });
      const n = data.bots ? data.bots.length : count;
      const st = el('ql-bot-status');
      if (st) st.textContent = `🤖 Botlar faol: ${n} ta (${scenarioId})`;
      if (el('ql-stop-bots')) el('ql-stop-bots').disabled = false;
      alertLive(`Bot scenario ishga tushdi — ${n} ta bot`);
    } catch (err) {
      alertLive('Bot xatosi: ' + err.message);
      const st = el('ql-bot-status');
      if (st) st.textContent = '⚠ ' + err.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Botlarni ishga tushirish'; }
    }
  }

  async function stopBots() {
    try {
      await api(`/api/cast/rehearsal/${sessionId}/bots/stop`, {});
      const st = el('ql-bot-status');
      if (st) st.textContent = 'Botlar: to\'xtatildi';
      if (el('ql-stop-bots')) el('ql-stop-bots').disabled = true;
      alertLive('Botlar to\'xtatildi');
    } catch (err) {
      alertLive('Xato: ' + err.message);
    }
  }

  async function resetRehearsal() {
    if (!global.confirm('Rehearsal sessiyasini qayta boshlash? Botlar va natijalar tozalanadi.')) return;
    try {
      await api(`/api/cast/rehearsal/${sessionId}/reset`, {});
      alertLive('Rehearsal reset qilindi');
      if (el('ql-bot-status')) el('ql-bot-status').textContent = 'Botlar: faol emas';
      if (el('ql-stop-bots')) el('ql-stop-bots').disabled = true;
    } catch (err) {
      alertLive('Xato: ' + err.message);
    }
  }

  // ── Wiring ──
  function init() {
    const runPf = el('ql-run-preflight');
    if (runPf) runPf.addEventListener('click', runPreflight);

    const runPost = el('ql-run-postflight');
    if (runPost) runPost.addEventListener('click', runPostflight);

    const start = el('ql-start-bots');
    if (start) start.addEventListener('click', startBots);

    const stop = el('ql-stop-bots');
    if (stop) stop.addEventListener('click', stopBots);

    const reset = el('ql-reset');
    if (reset) reset.addEventListener('click', resetRehearsal);

    // Load initial findings (non-blocking)
    loadAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
