/**
 * Deborah — Cast Replay (C5-02)
 * ------------------------------
 * Teacher event timeline + private reflection. Camera ruxsati so'ralmaydi.
 */
(function () {
  'use strict';

  const BOOT = window.__BOOT__ || {};
  const SID = BOOT.sessionId;
  const CSRF = window.__CSRF_TOKEN || '';
  const REFLECTION_FIELDS = BOOT.reflectionFields || [];

  const TEACHER_URL = `/api/cast/sessions/${SID}/replay/teacher`;
  const AUDIT_URL = `/api/cast/sessions/${SID}/replay/audit`;
  const DET_URL = `/api/cast/sessions/${SID}/replay/determinism`;
  const REFLECT_URL = `/api/cast/sessions/${SID}/reflection`;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  function setCard(id, html) {
    const card = $(id);
    if (!card) return;
    const body = card.querySelector('.rp-body');
    if (body) body.innerHTML = html;
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderTeacher(t) {
    // Timeline
    const tl = t.timeline || [];
    let tlHtml = '';
    if (tl.length === 0) tlHtml = '<p class="rp-muted">Eventlar yo&#39;q</p>';
    else {
      tlHtml = '<ol class="rp-timeline">';
      for (const f of tl) {
        tlHtml += `<li><span class="rp-tl-rev">r${f.revision}</span> <span class="rp-tl-time">${fmtTime(f.serverAt)}</span> <b>${esc(f.type)}</b></li>`;
      }
      tlHtml += '</ol>';
    }
    setCard('rp-timeline', tlHtml);

    // Distributions
    const dists = t.distributions || [];
    let dHtml = '';
    if (dists.length === 0) dHtml = '<p class="rp-muted">Ma&#39;lumot yo&#39;q</p>';
    else {
      dHtml = '<table class="rp-table"><thead><tr><th>Savol</th><th>Accuracy</th><th>Taqlot</th></tr></thead><tbody>';
      for (const d of dists) {
        const distStr = Object.entries(d.distribution || {}).map(([o, c]) => `${esc(o)}:${c}`).join(' · ') || '—';
        dHtml += `<tr><td>${esc(d.questionId)}</td><td>${d.accuracyPercent === null ? '—' : d.accuracyPercent + '%'}</td><td>${esc(distStr)}</td></tr>`;
      }
      dHtml += '</tbody></table>';
    }
    setCard('rp-distributions', dHtml);

    // Misconceptions
    const mis = t.misconceptionMarkers || [];
    let mHtml = '';
    if (mis.length === 0) mHtml = '<p class="rp-muted">Tasdiqlangan misconception yo&#39;q</p>';
    else {
      mHtml = '<ul class="rp-list">';
      for (const m of mis) {
        mHtml += `<li><b>${esc(m.label)}</b> — q${esc(m.questionId)}${m.teacherExplanation ? `<br><span class="rp-muted">${esc(m.teacherExplanation)}</span>` : ''}</li>`;
      }
      mHtml += '</ul>';
    }
    setCard('rp-misconceptions', mHtml);

    // Actions
    const acts = t.actions || [];
    let aHtml = '';
    if (acts.length === 0) aHtml = '<p class="rp-muted">Action markerlar yo&#39;q</p>';
    else {
      aHtml = '<ul class="rp-list">';
      for (const a of acts) {
        const p = a.payload || {};
        const detail = p.questionId ? ` — q${esc(p.questionId)}` : '';
        aHtml += `<li><span class="rp-tl-rev">r${a.revision}</span> <b>${esc(a.type)}</b>${detail}</li>`;
      }
      aHtml += '</ul>';
    }
    setCard('rp-actions', aHtml);

    // Network
    const nb = t.networkBuckets || {};
    let nHtml = '<ul class="rp-list">';
    const keys = Object.keys(nb);
    if (keys.length === 0) nHtml += '<li>Namunalar yo&#39;q</li>';
    for (const k of keys) nHtml += `<li>${esc(k)}: ${nb[k]}</li>`;
    nHtml += '</ul>';
    setCard('rp-network', nHtml);

    // Fingerprint
    $('rp-badge').textContent = `Replay · ${t.configFingerprint ? t.configFingerprint.slice(0, 16) : '—'}`;
  }

  function renderAudit(a) {
    const typeCounts = a.typeCounts || {};
    let html = `<p>Eventlar: <b>${a.eventCount}</b> · Davomiyligi: <b>${a.durationMs ? Math.round(a.durationMs / 1000) + 's' : '—'}</b></p><ul class="rp-list">`;
    for (const [k, v] of Object.entries(typeCounts)) html += `<li>${esc(k)}: ${v}</li>`;
    html += '</ul>';
    setCard('rp-audit', html);
  }

  function renderReflection(r) {
    if (!r) {
      // Bo'sh forma
      let html = '';
      for (const f of REFLECTION_FIELDS) {
        html += `<div class="rp-refl-field"><label for="refl-${f.id}"><b>${esc(f.label)}</b></label><textarea id="refl-${f.id}" rows="2" maxlength="2000"></textarea></div>`;
      }
      html += '<button class="cast-btn cast-btn-secondary" id="btn-refl-save">💾 Saqlash</button>';
      setCard('rp-reflection', html);
    } else {
      let html = '';
      for (const f of REFLECTION_FIELDS) {
        html += `<div class="rp-refl-field"><label for="refl-${f.id}"><b>${esc(f.label)}</b></label><textarea id="refl-${f.id}" rows="2" maxlength="2000">${esc(r.fields?.[f.id] || '')}</textarea></div>`;
      }
      html += '<button class="cast-btn cast-btn-secondary" id="btn-refl-save">💾 Saqlash</button>';
      setCard('rp-reflection', html);
    }
    const btn = $('btn-refl-save');
    if (btn) btn.addEventListener('click', saveReflection);
  }

  async function saveReflection() {
    const fields = {};
    for (const f of REFLECTION_FIELDS) {
      const el = $(`refl-${f.id}`);
      if (el && el.value && el.value.trim()) fields[f.id] = el.value.trim();
    }
    try {
      const r = await fetch(REFLECT_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
        credentials: 'same-origin',
        body: JSON.stringify({ fields }),
      });
      const data = await r.json();
      if (data.ok) {
        renderReflection(data.reflection);
        alert('Saqlangan ✅');
      } else {
        alert(data.error?.message || data.error?.code || 'Saqlash xatosi');
      }
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  async function loadAll() {
    try {
      const [t, a, r] = await Promise.all([
        fetch(TEACHER_URL, { credentials: 'same-origin' }).then((x) => x.json()),
        fetch(AUDIT_URL, { credentials: 'same-origin' }).then((x) => x.json()),
        fetch(REFLECT_URL, { credentials: 'same-origin' }).then((x) => x.json()),
      ]);
      if (t.ok) renderTeacher(t.replay);
      if (a.ok) renderAudit(a.audit);
      if (r.ok) renderReflection(r.reflection);
    } catch (err) {
      setCard('rp-timeline', `<p class="rp-muted">Yuklash xatosi: ${esc(err.message || String(err))}</p>`);
    }
  }

  async function checkDeterminism() {
    try {
      const r = await fetch(DET_URL, { credentials: 'same-origin' });
      const d = await r.json();
      const ok = d.ok && d.deterministic;
      $('rp-badge').textContent = ok ? '✔ Deterministic' : '✘ Diverged';
      $('rp-badge').style.color = ok ? '#46dc8c' : '#ff5d6c';
      if (!ok) alert(`Replay va hozirgi state farq qiladi (${d.replayedPhase} vs ${d.currentPhase})`);
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  function bind() {
    const ref = $('btn-rp-refresh');
    if (ref) ref.addEventListener('click', loadAll);
    const det = $('btn-rp-determinism');
    if (det) det.addEventListener('click', checkDeterminism);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    loadAll();
  });
})();
