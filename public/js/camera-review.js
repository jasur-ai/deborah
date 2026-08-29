/**
 * Deborah — Camera Evidence Review (teacher, human review only)
 *
 * Prompt 37 — review timeline + disposition UI. Qarorlar faqat inson
 * tomonidan: cleared | reviewed | discarded. Avtomatik misconduct yo'q.
 */

(function (global) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const DISPO_CLASS = {
    pending: 'pending',
    cleared: 'cleared',
    reviewed: 'reviewed',
    discarded: 'discarded',
  };

  const DISPO_LABEL = {
    pending: 'Kutilmoqda',
    cleared: 'Tozalandi',
    reviewed: 'Tasdiqlandi',
    discarded: 'O‘chirildi',
  };

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'medium' });
  }

  function toast(msg, ok = true) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show ${ok ? 'ok' : 'err'}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, 2400);
  }

  function flagChips(flags) {
    if (!flags || typeof flags !== 'object') return '<span class="flag">—</span>';
    const parts = [];
    if (flags.phone_detected === true) parts.push('<span class="flag warn">telefon</span>');
    if (flags.freeze_detected === true) parts.push('<span class="flag warn">freeze</span>');
    if (flags.face_present === false) parts.push('<span class="flag warn">yuz yo‘q</span>');
    if (Number.isInteger(flags.face_count) && flags.face_count > 1) parts.push(`<span class="flag warn">${flags.face_count} yuz</span>`);
    if (flags.face_present === true) parts.push('<span class="flag ok">yuz bor</span>');
    if (!parts.length) parts.push('<span class="flag">normal</span>');
    return parts.join('');
  }

  function evidenceCard(e) {
    const dispoCls = DISPO_CLASS[e.disposition] || 'pending';
    const dispoLabel = DISPO_LABEL[e.disposition] || e.disposition;
    const hasHash = e.content_hash ? `<span class="ev-time" style="color:var(--cyan)">hash: ${esc(e.content_hash.slice(0, 16))}…</span>` : '';
    const hasStorage = e.storage_key ? `<span class="ev-time" style="color:var(--green)">snapshot mavjud</span>` : '';
    // State machine (camera.schema.js): discarded → hech qayerga; cleared/reviewed
    // → faqat bir-biriga (o'zaro tuzatish). 'O'chirish' faqat pending uchun;
    // joriy disposition'ga teng tugma yashiriladi (same-state transition → 400).
    const canReview = e.disposition === 'pending' || e.disposition === 'cleared' || e.disposition === 'reviewed';
    const canDiscard = e.disposition === 'pending';
    const canClear = e.disposition !== 'cleared';
    const canFlag = e.disposition !== 'reviewed';

    return `
      <div class="card" data-id="${e.id}">
        <div class="card-h" style="justify-content:space-between;flex-wrap:wrap">
          <span>Evidence #${e.id}</span>
          <span class="dispo ${dispoCls}">${dispoLabel}</span>
        </div>
        <div class="meta-row">
          <span>seq: ${e.client_seq}</span>
          <span class="ev-time">${fmtTime(e.captured_at)}</span>
          <span>type: ${esc(e.event_type)}</span>
          ${hasStorage}
          ${hasHash}
        </div>
        <div class="flag-tags">${flagChips(e.flags)}</div>
        ${canReview ? `
          <textarea class="note-inp" placeholder="Review izohi (ixtiyoriy)…"></textarea>
          <div class="actions">
            ${canClear ? '<button class="act-btn clear" data-d="cleared">Tozalangan</button>' : ''}
            ${canFlag ? '<button class="act-btn flag" data-d="reviewed">Tasdiqlangan (anomaliya)</button>' : ''}
            ${canDiscard ? '<button class="act-btn discard" data-d="discarded">O‘chirish</button>' : ''}
          </div>` : ''}
      </div>`;
  }

  async function loadReview() {
    const id = $('#attemptInp').value.trim();
    if (!id) { toast('Attempt ID kiriting', false); return; }
    $('#list').innerHTML = '<div class="loading"><span class="spinner"></span> Yuklanmoqda…</div>';
    try {
      const res = await fetch(`/api/admin/attempts/${encodeURIComponent(id)}/camera/review`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok === false) throw new Error(data.reason || 'load failed');
      renderList(data);
    } catch (err) {
      $('#list').innerHTML = `<div class="empty">Yuklash xatosi: ${esc(err.message)}</div>`;
    }
  }

  function renderList(data) {
    const ev = data.evidence || [];
    $('#summary').classList.remove('hidden');
    $('#summary').innerHTML = `
      <div class="sum-chip">Jami <b>${data.meta?.total ?? ev.length}</b></div>
      <div class="sum-chip">Flag'd <b style="color:var(--gold)">${data.meta?.flagged ?? 0}</b></div>`;
    if (!ev.length) {
      $('#list').innerHTML = '<div class="empty">Bu attempt uchun camera evidence yo‘q.</div>';
      return;
    }
    $('#list').innerHTML = ev.map(evidenceCard).join('');
    bindActions();
  }

  function bindActions() {
    $('#list').querySelectorAll('.act-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.card');
        const id = card.dataset.id;
        const disposition = btn.dataset.d;
        const note = card.querySelector('.note-inp')?.value?.trim() || null;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/admin/camera/evidence/${id}/disposition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF || '' },
            body: JSON.stringify({ disposition, note }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          toast(`Disposition: ${disposition}`);
          await loadReview();
        } catch (_) {
          toast('Saqlanmadi', false);
          btn.disabled = false;
        }
      });
    });
  }

  async function runRetention() {
    try {
      const res = await fetch('/api/admin/camera/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF || '' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      toast(data.ok ? `Retention: ${data.deleted ?? 0} o‘chirildi` : 'Xatolik', !!data.ok);
      if (data.ok && $('#attemptInp').value.trim()) await loadReview();
    } catch (_) {
      toast('Retention xatosi', false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#loadBtn').addEventListener('click', loadReview);
    $('#retentionBtn').addEventListener('click', runRetention);
    $('#attemptInp').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadReview(); });
  });
})(window);
