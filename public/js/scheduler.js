/**
 * Edikit — Admin Exam Scheduler UI (Prompt 39)
 *
 * Tabs: Solver | Versions | Rooms | Periods | Weights
 *  - Solver: JSON exam input + seed → POST /api/admin/scheduler/run →
 *    DRAFT version, metrics + violations report
 *  - Versions: list runs, open detail, approve → publish (hard gate)
 *  - What-if: move an exam to another period (read-only compare)
 *  - Rooms/Periods: inventory CRUD
 *  - Weights: soft penalty weight sliders (saved per tenant)
 *
 * Security: no raw innerHTML from server data without escaping (esc() helper);
 * inline JSON is escaped server-side via \u003c (see EJS render).
 */

const $ = (id) => document.getElementById(id);

let runsCache = [];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg, ok = true) {
  const t = $('toast');
  t.textContent = msg;
  t.style.color = ok ? 'var(--green)' : 'var(--edikit-semantic-color-action-primary)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════════

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    ['run', 'versions', 'rooms', 'periods', 'weights'].forEach((name) => {
      const el = $('tab-' + name);
      if (el) el.style.display = name === tab.dataset.tab ? '' : 'none';
    });
    if (tab.dataset.tab === 'versions') loadVersions();
    if (tab.dataset.tab === 'rooms') loadRooms();
    if (tab.dataset.tab === 'periods') loadPeriods();
    if (tab.dataset.tab === 'weights') loadWeights();
  });
});

// ═══════════════════════════════════════════════════════════════════
// SOLVER RUN
// ═══════════════════════════════════════════════════════════════════

$('btnRun').addEventListener('click', async () => {
  const out = $('runOutput');
  out.innerHTML = '<div class="loading">Hisoblanmoqda...</div>';
  try {
    const exams = JSON.parse($('examInput').value);
    if (!Array.isArray(exams)) throw new Error('Input array bo\'lishi kerak');

    // Load rooms/periods from inventory so the solver has real constraints
    const [rooms, periods] = await Promise.all([
      api('/api/admin/scheduler/rooms'),
      api('/api/admin/scheduler/periods'),
    ]);

    const body = {
      title: $('runTitle').value || undefined,
      termId: Number($('termId').value) || undefined,
      exams,
      rooms: rooms.rooms || [],
      periods: periods.periods || [],
      proctors: [],
      seed: Number($('seed').value) || 1,
      externalKey: `run:${Date.now()}`,
    };

    const result = await api('/api/admin/scheduler/run', { method: 'POST', body: JSON.stringify(body) });
    toast('Run yaratildi (draft)');
    renderRunResult(out, result);
    loadVersions();
  } catch (e) {
    out.innerHTML = `<div class="run-preview err">${esc(e.message)}</div>`;
  }
});

function renderRunResult(el, result) {
  const v = result.violations || [];
  const unsched = result.unscheduled || [];
  const m = result.metrics || {};
  const softByType = Object.entries(m.softByType || {})
    .map(([k, val]) => `${k}: ${val}`).join(' | ');
  const html = `
    <div class="run-preview ${v.length === 0 && unsched.length === 0 ? 'ok' : 'err'}">
ID: ${result.id} · status: ${esc(result.status)} · deterministic: ${result.deterministic}<br>
Imtihonlar: ${m.placedExamCount}/${m.examCount} joylashtirildi · Studentlar: ${m.placedStudentCount}/${m.studentCount}<br>
Soft jami: ${m.softTotal}${softByType ? ' (' + esc(softByType) + ')' : ''}<br>
Hard violations: <b>${v.length}</b> · Unscheduled: <b>${unsched.length}</b>
${v.length ? '<br>' + v.slice(0, 5).map((x) => esc(x.detail)).join('<br>') : ''}
    </div>`;
  el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════
// VERSIONS
// ═══════════════════════════════════════════════════════════════════

async function loadVersions() {
  try {
    const data = await api('/api/admin/scheduler/runs');
    runsCache = data.runs || [];
    const el = $('versionsList');
    if (runsCache.length === 0) {
      el.innerHTML = '<div class="empty">Hali hech qanday run yo\'q</div>';
      return;
    }
    el.innerHTML = `
      <table class="table">
        <thead><tr><th>ID</th><th>Nomi</th><th>Status</th><th>Imtihonlar</th><th>Soft</th><th>Amallar</th></tr></thead>
        <tbody>${runsCache.map((r) => `
          <tr>
            <td>#${r.id}</td>
            <td>${esc(r.title)}</td>
            <td><span class="chip ${esc(r.status)}">${esc(r.status)}</span></td>
            <td>${r.metrics && r.metrics.placedExamCount}/${r.metrics && r.metrics.examCount}</td>
            <td>${r.metrics ? r.metrics.softTotal : '-'}</td>
            <td>
              <button class="mini-btn" onclick="openRun(${r.id})">Ko'rish</button>
              ${r.status === 'draft' ? `<button class="mini-btn" onclick="approveRun(${r.id})">Tasdiqlash</button>` : ''}
              ${r.status === 'approved' ? `<button class="mini-btn" onclick="publishRun(${r.id})">Publish</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    $('versionsList').innerHTML = `<div class="run-preview err">${esc(e.message)}</div>`;
  }
}

async function approveRun(id) {
  try {
    await api(`/api/admin/scheduler/runs/${id}/approve`, { method: 'POST', body: '{}' });
    toast('Tasdiqlandi');
    loadVersions();
    openRun(id);
  } catch (e) { toast(e.message, false); }
}

async function publishRun(id) {
  if (!confirm('Ushbu versiyani publish qilasizmi? (hard violation bo\'lsa bloklanadi)')) return;
  try {
    await api(`/api/admin/scheduler/runs/${id}/publish`, { method: 'POST', body: '{}' });
    toast('Published');
    loadVersions();
    openRun(id);
  } catch (e) { toast(e.message, false); }
}

async function openRun(id) {
  try {
    const data = await api(`/api/admin/scheduler/runs/${id}`);
    renderRunDetail(data.run);
  } catch (e) { toast(e.message, false); }
}

function renderRunDetail(run) {
  const el = $('runDetail');
  el.style.display = '';
  $('detailTitle').textContent = `#${run.id} — ${run.title}`;
  const metrics = typeof run.metrics === 'string' ? JSON.parse(run.metrics) : run.metrics || {};
  const violations = typeof run.hard_violations === 'string' ? JSON.parse(run.hard_violations) : run.hard_violations || [];
  const unscheduled = typeof run.unscheduled === 'string' ? JSON.parse(run.unscheduled) : run.unscheduled || [];
  const assignments = run.assignments || [];

  const metricHtml = `
    <div class="metric-row">
      <div class="metric ${violations.length === 0 ? 'good' : 'bad'}"><b>${violations.length}</b><span>Hard violations</span></div>
      <div class="metric"><b>${metrics.placedExamCount}/${metrics.examCount}</b><span>Imtihonlar</span></div>
      <div class="metric"><b>${metrics.softTotal}</b><span>Soft jami</span></div>
      <div class="metric"><b>${unscheduled.length}</b><span>Unscheduled</span></div>
    </div>`;

  const violHtml = violations.length
    ? violations.slice(0, 8).map((v) => `<div class="viol">${esc(v.detail || v.type)}</div>`).join('')
    : '<div class="run-preview ok">Hard violations: 0 — publish mumkin</div>';

  const assignHtml = assignments.length
    ? assignments.map((a) => {
        const pens = (a.soft_penalty || []).map((p) => `<span class="pen-item">${esc(p.type)} +${p.delta} (${esc(p.reason)})</span>`).join('');
        return `
        <div class="assign-card">
          <h4>${esc(a.event_id ? 'Imtihon #' + a.event_id : '')}</h4>
          <div class="meta">
            <span>Davr: ${esc(a.period_name || a.period_id || '-')}</span>
            <span>Xona: ${esc(a.room_name || a.room_id || '-')}</span>
            <span>Studentlar: ${(a.student_ids || []).length}</span>
            <span>Proktor: ${esc(a.proctor_user_id || '—')}</span>
          </div>
          ${pens ? `<div>${pens}</div>` : ''}
          <div class="whatif">
            <input class="inp" style="flex:1;min-width:120px;padding:6px 9px;font-size:.7rem" placeholder="Maqsadli period ID" id="whatif-period-${a.id}">
            <button class="mini-btn" onclick="whatIfRun(${run.id}, ${a.event_id}, 'whatif-period-${a.id}')">What-if</button>
          </div>
          <div id="whatif-out-${a.id}"></div>
        </div>`;
      }).join('')
    : '<div class="empty">Assignmentlar yo\'q</div>';

  el.innerHTML = metricHtml + violHtml + '<div class="card-h" style="margin-top:14px">Assignments</div>' + assignHtml;
}

async function whatIfRun(runId, examId, inputId) {
  const periodId = Number($(inputId).value);
  if (!periodId) return toast('Period ID kiriting', false);
  try {
    const data = await api(`/api/admin/scheduler/runs/${runId}/what-if`, {
      method: 'POST',
      body: JSON.stringify({ examId, targetPeriodId: periodId }),
    });
    const out = $('whatif-out-' + runId);
    const before = data.before || {};
    const after = data.after || {};
    out.innerHTML = `<div class="run-preview ${data.feasible ? 'ok' : 'err'}" style="margin-top:6px">
      ${data.error ? esc(data.error) : ''}
      ${data.feasible ? 'Mumkin ✓' : 'Mumkin emas ✗'}<br>
      Oldin: ${esc(before.periodName)} (soft ${before.softTotal}) → Keyin: ${esc(after.periodName)} / ${esc(after.roomName)} (soft ${after.softTotal})<br>
      Delta: ${data.deltaSoft > 0 ? '+' : ''}${data.deltaSoft}
      ${data.violations && data.violations.length ? '<br>' + data.violations.map((v) => esc(v.detail || v.type)).join('<br>') : ''}
    </div>`;
  } catch (e) { toast(e.message, false); }
}

// ═══════════════════════════════════════════════════════════════════
// ROOMS
// ═══════════════════════════════════════════════════════════════════

async function loadRooms() {
  try {
    const data = await api('/api/admin/scheduler/rooms');
    const rooms = data.rooms || [];
    $('roomList').innerHTML = rooms.length
      ? rooms.map((r) => `
        <div class="assign-card">
          <h4>${esc(r.name)} <span class="chip ${esc(r.status)}">${esc(r.status)}</span></h4>
          <div class="meta">
            <span>Sig'im: ${r.capacity}</span>
            <span>Bino: ${esc(r.building || '-')}</span>
            ${r.isolated ? '<span style="color:var(--gold)">Izolyatsiya</span>' : ''}
            <span>Xususiyatlar: ${esc((r.features || []).join(', ') || '-')}</span>
          </div>
        </div>`).join('')
      : '<div class="empty">Xonalar yo\'q — qo\'shing</div>';
  } catch (e) { $('roomList').innerHTML = `<div class="run-preview err">${esc(e.message)}</div>`; }
}

$('btnAddRoom').addEventListener('click', async () => {
  try {
    const body = {
      name: $('roomName').value,
      building: $('roomBuilding').value || undefined,
      capacity: Number($('roomCapacity').value),
      features: $('roomFeatures').value.split(',').map((s) => s.trim()).filter(Boolean),
      isolated: $('roomIsolated').checked,
      external_key: `room:${Date.now()}`,
    };
    await api('/api/admin/scheduler/rooms', { method: 'POST', body: JSON.stringify(body) });
    toast('Xona qo\'shildi');
    loadRooms();
  } catch (e) { toast(e.message, false); }
});

// ═══════════════════════════════════════════════════════════════════
// PERIODS
// ═══════════════════════════════════════════════════════════════════

async function loadPeriods() {
  try {
    const data = await api('/api/admin/scheduler/periods');
    const periods = data.periods || [];
    $('periodList').innerHTML = periods.length
      ? periods.map((p) => `
        <div class="assign-card">
          <h4>${esc(p.name)} <span class="chip ${esc(p.status)}">${esc(p.status)}</span></h4>
          <div class="meta">
            <span>${esc(new Date(p.start_at).toISOString())}</span>
            <span>→</span>
            <span>${esc(new Date(p.end_at).toISOString())}</span>
            <span>ID: ${p.id}</span>
          </div>
        </div>`).join('')
      : '<div class="empty">Davrlar yo\'q — qo\'shing</div>';
  } catch (e) { $('periodList').innerHTML = `<div class="run-preview err">${esc(e.message)}</div>`; }
}

$('btnAddPeriod').addEventListener('click', async () => {
  try {
    const body = {
      name: $('periodName').value,
      startAt: $('periodStart').value,
      endAt: $('periodEnd').value,
      external_key: `period:${Date.now()}`,
    };
    await api('/api/admin/scheduler/periods', { method: 'POST', body: JSON.stringify(body) });
    toast('Davr qo\'shildi');
    loadPeriods();
  } catch (e) { toast(e.message, false); }
});

// ═══════════════════════════════════════════════════════════════════
// WEIGHTS
// ═══════════════════════════════════════════════════════════════════

const WEIGHT_LABELS = {
  back_to_back: 'Ketma-ket imtihonlar',
  proctor_overload: 'Proktor yuklamasi',
  feature_mismatch: 'Xona xususiyati mos emas',
  utilization_gap: "Xona to'liq ishlatilmasligi",
  late_placement: 'Kechiktirilgan joylashuv',
};

async function loadWeights() {
  try {
    const data = await api('/api/admin/scheduler/weights');
    const weights = data.weights || {};
    const seed = data.seed || 1;
    $('wSeed').value = seed;
    $('weightRows').innerHTML = Object.entries(weights).map(([key, val]) => `
      <div class="w-row">
        <span>${esc(WEIGHT_LABELS[key] || key)}</span>
        <input type="range" min="0" max="100" step="1" value="${val}" data-weight-key="${esc(key)}">
        <output id="wv-${esc(key)}">${val}</output>
      </div>`).join('');
    document.querySelectorAll('input[data-weight-key]').forEach((slider) => {
      slider.addEventListener('input', () => {
        $(`wv-${slider.dataset.weightKey}`).textContent = slider.value;
      });
    });
  } catch (e) { $('weightRows').innerHTML = `<div class="run-preview err">${esc(e.message)}</div>`; }
}

$('btnSaveWeights').addEventListener('click', async () => {
  try {
    const weights = {};
    document.querySelectorAll('input[data-weight-key]').forEach((slider) => {
      weights[slider.dataset.weightKey] = Number(slider.value);
    });
    const body = { weights, seed: Number($('wSeed').value) || 1 };
    await api('/api/admin/scheduler/weights', { method: 'PUT', body: JSON.stringify(body) });
    toast('Og\'irliklar saqlandi');
  } catch (e) { toast(e.message, false); }
});

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadVersions();
  loadWeights();
  loadRooms();
  loadPeriods();
});

// Expose handlers for inline onclick attributes
window.openRun = openRun;
window.approveRun = approveRun;
window.publishRun = publishRun;
window.whatIfRun = whatIfRun;
