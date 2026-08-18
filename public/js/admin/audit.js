/**
 * Deborah — Admin audit dashboard (AUTH C-09)
 * -------------------------------------------------------------------
 * auth_audit ro'yxati: filter (action/outcome/vaqt), qidiruv (actor_id),
 * pagination. Aggregate kartalar (login success/fail rate, lockout,
 * teacher, risk, HIBP, abuse) + accessible matn-chart (C-09 §12).
 * CSRF: GET'lar uchun shart emas; faqat server-render sahifa.
 * A11y: native button/select, live-region, 44px min-height.
 */
(function () {
  'use strict';

  // D-10 §13: i18n — window.__ADMIN_COPY__ (admin bloki, 4 til); fallback uz
  var copy = {};
  try { copy = JSON.parse(window.__ADMIN_COPY__ || '{}'); } catch (_) {}
  function t(key, fallback) {
    var v = copy;
    var parts = String(key).split('.');
    for (var i = 0; i < parts.length && v; i++) v = v[parts[i]];
    return (typeof v === 'string' && v) ? v : (fallback || key);
  }
  function fmt(tpl, map) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : '{' + k + '}'; });
  }

  let currentPage = 1;
  const pageSize = 25;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('uz-UZ'); } catch (_) { return '—'; }
  }

  function outcomeBadge(outcome) {
    const map = {
      success: 'ok', failed: 'danger', locked: 'warn',
      blocked: 'danger', flagged: 'warn', reminded: 'accent',
      escalated: 'danger',
    };
    const cls = map[outcome] || 'accent';
    return '<span class="badge badge-' + cls + '">' + esc(outcome || '—') + '</span>';
  }

  function ipCell(hash) {
    if (!hash) return '—';
    return '<code style="font-size:.72rem;word-break:break-all">' + esc(hash.slice(0, 12)) + '…</code>';
  }

  function renderRows(items) {
    const tb = document.getElementById('audit-tbody');
    if (!items.length) {
      tb.innerHTML = '<tr><td colspan="6"><div class="admin-empty">' + esc(t('audit.empty', 'Hodisalar topilmadi')) + '</div></td></tr>';
      return;
    }
    tb.innerHTML = items.map((e) => (
      '<tr>' +
      '<td class="dt-ts" style="font-size:.76rem">' + fmtDate(e.ts) + '</td>' +
      '<td><code style="font-size:.74rem">' + esc(e.action) + '</code></td>' +
      '<td>' + outcomeBadge(e.outcome) + '</td>' +
      '<td class="text-muted" style="font-size:.76rem">' + esc(e.method || '—') + '</td>' +
      '<td class="text-muted" style="font-size:.76rem;word-break:break-all">' + esc(e.actor_id || '—') + '</td>' +
      '<td>' + ipCell(e.ip_hash) + '</td>' +
      '</tr>'
    )).join('');
  }

  function updatePagination(total) {
    const totalEl = document.getElementById('audit-total');
    if (totalEl) totalEl.textContent = fmt(t('audit.total', 'Jami: {n} ta hodisa'), { n: total });
    const pageEl = document.getElementById('audit-page');
    if (pageEl) pageEl.textContent = String(currentPage);
    const prev = document.getElementById('audit-prev');
    const next = document.getElementById('audit-next');
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage * pageSize >= total;
  }

  // ── Ro'yxat yuklash (filter + qidiruv + pagination) ──
  async function loadAudit(page) {
    currentPage = Math.max(1, page || 1);
    const range = document.getElementById('audit-range')?.value || '24h';
    const action = document.getElementById('audit-action')?.value || '';
    const outcome = document.getElementById('audit-outcome')?.value || '';
    const q = document.getElementById('audit-q')?.value || '';
    const params = new URLSearchParams({ page: currentPage, pageSize: String(pageSize), range });
    if (action) params.set('action', action);
    if (outcome) params.set('outcome', outcome);
    if (q) params.set('q', q);
    try {
      const r = await fetch('/admin/api/audit?' + params.toString());
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'xato');
      renderRows(data.items || []);
      updatePagination(data.total || 0);
    } catch (e) {
      renderRows([]);
      updatePagination(0);
      const tb = document.getElementById('audit-tbody');
      if (tb) tb.innerHTML = '<tr><td colspan="6"><div class="admin-empty">' + esc(fmt(t('audit.loadFail', 'Yuklash xato: {err}'), { err: e.message })) + '</div></td></tr>';
    }
  }

  // ── Aggregate kartalar (C-09 §07) ──
  async function loadAggregates() {
    const range = document.getElementById('audit-range')?.value || '24h';
    try {
      const r = await fetch('/admin/api/audit/aggregates?range=' + encodeURIComponent(range));
      const a = await r.json();
      if (!r.ok) throw new Error(a.error || 'xato');
      const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
      };
      set('agg-login-success', String(a.login_success || 0));
      set('agg-login-fail', String(a.login_fail || 0));
      set('agg-fail-rate', String(a.login_fail_rate == null ? 0 : a.login_fail_rate) + '%');
      set('agg-lockout', String(a.lockout || 0));
      set('agg-teacher', String(a.teacher_applications || 0));
      set('agg-risk', String(a.risk_blocked || 0));
      set('agg-hibp', String(a.hibp_hit || 0));
      set('agg-abuse', String(a.abuse_events || 0));
      renderChart(a);
    } catch (_) { /* kartalar — '—' holatida qoladi */ }
  }

  // ── Accessible matn-chart (C-09 §12): login success/fail, lockout, block ──
  function renderChart(a) {
    const el = document.getElementById('audit-chart');
    if (!el) return;
    const rows = [
      ['Login success', a.login_success || 0],
      ['Login fail', a.login_fail || 0],
      ['Lockout', a.lockout || 0],
      ['Risk blok', a.risk_blocked || 0],
    ];
    const max = Math.max(1, ...rows.map((r) => r[1]));
    el.className = 'admin-chart-text';
    el.innerHTML = rows.map(([label, val]) => {
      const bar = Math.max(1, Math.round((val / max) * 24));
      return (
        '<div class="chart-line" style="display:flex;align-items:center;gap:8px;margin:4px 0">' +
        '<span style="min-width:110px;font-size:.78rem">' + esc(label) + '</span>' +
        '<span class="chart-bar" style="display:inline-block;height:12px;min-width:4px;background:var(--deborah-semantic-color-action-primary, #2563eb);border-radius:3px;width:' + bar * 4 + 'px" aria-hidden="true"></span>' +
        '<strong style="font-size:.78rem">' + val + '</strong>' +
        '</div>'
      );
    }).join('') || '<div class="admin-empty">' + esc(t('audit.chartNoData', "Ma'lumot yo'q")) + '</div>';
  }

  // ── Event'lar ──
  document.addEventListener('DOMContentLoaded', function () {
    loadAggregates();
    loadAudit(1);
    const q = document.getElementById('audit-q');
    if (q) q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); loadAudit(1); }
    });
    const range = document.getElementById('audit-range');
    if (range) range.addEventListener('change', function () {
      loadAggregates();
      loadAudit(1);
    });
  });

  // Inline onclick (audit.ejs) uchun global
  window.loadAudit = loadAudit;
})();
