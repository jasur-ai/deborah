/**
 * Edikit — Cast Results (C5-01)
 * ------------------------------
 * Teacher report (action pack) yuklaydi va render qiladi. Student private
 * recap bu sahifadan emas — o'z panelida (own response + approved explanation).
 */
(function () {
  'use strict';

  const BOOT = window.__BOOT__ || {};
  const SID = BOOT.sessionId;
  const CSRF = window.__CSRF_TOKEN || '';
  const REPORT_URL = `/api/cast/sessions/${SID}/results/report`;
  const EXPORT_URL = `/api/cast/sessions/${SID}/results/export`;
  const AI_DRAFT_URL = `/api/cast/sessions/${SID}/results/ai-draft`;

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
  const fmtPct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 10) / 10}%`);
  // C5-03 (item 2): percent UI'da integer yoki policy rounding — decimal o'rniga
  const fmtPctInt = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

  let report = null;

  function setCard(id, html) {
    const card = $(id);
    if (!card) return;
    const body = card.querySelector('.res-body');
    if (body) body.innerHTML = html;
  }

  function render() {
    if (!report) return;
    $('res-badge').textContent = '✅ Tayyor';
    $('res-badge').className = 'res-badge res-badge-ok';
    $('res-fingerprint').textContent = `fingerprint: ${report.fingerprint || '—'} · v${report.version || 1}`;

    // Participation
    const part = report.participation || {};
    const reasons = part.reasons || {};
    const cov = part.coverage || {};
    let partHtml = `<p>Jami: <b>${part.total ?? 0}</b></p><ul class="res-list">`;
    partHtml += `<li>✅ Javob berdi: ${reasons.accepted || 0}</li>`;
    partHtml += `<li>🕐 Keyin qo'shildi: ${reasons.late_join || 0}</li>`;
    partHtml += `<li>📴 Uzildi: ${reasons.disconnected || 0}</li>`;
    partHtml += `<li>⚠️ Texnik uzilish: ${reasons.technical_failure || 0}</li>`;
    partHtml += `<li>🤐 Javob yo'q: ${reasons.no_response || 0}</li>`;
    partHtml += '</ul>';
    if (cov && (cov.inRoom || cov.remote)) {
      partHtml += `<p class="res-muted">Sinfda: ${cov.inRoom?.total ?? 0} · Uzoqdan: ${cov.remote?.total ?? 0}</p>`;
    }
    setCard('res-participation', partHtml);

    // Accuracy — C5-03: numerator/denominator + integer percent (item 1, 2)
    const acc = report.accuracy || {};
    const accMetric = {
      numerator: acc.correct ?? 0,
      denominator: acc.accepted ?? 0,
      percent: acc.accuracyPercent !== null && acc.accuracyPercent !== undefined ? Math.round(acc.accuracyPercent) : null,
    };
    const accStatus = accMetric.denominator > 0 && accMetric.denominator < 6 ? ' (<span class="res-tag res-tag-warn">yetarli namuna emas</span>)' : '';
    setCard('res-accuracy', `<p class="res-big">${fmtPctInt(accMetric.percent)}</p>
      <p class="res-muted">${accMetric.numerator} to'g'ri / ${accMetric.denominator} qabul qilingan javob${accStatus}</p>`);

    // Hardest questions
    const hardest = report.hardestQuestions || [];
    let hardHtml = '';
    if (hardest.length === 0) hardHtml = '<p class="res-muted">Savollar ma&#39;lumoti yo&#39;q</p>';
    else {
      hardHtml = '<table class="res-table"><thead><tr><th>Savol</th><th>Accuracy</th><th>Javoblar</th><th>Holat</th></tr></thead><tbody>';
      for (const h of hardest.slice(0, 8)) {
        hardHtml += `<tr><td>${esc(h.text)}</td><td>${fmtPct(h.accuracyPercent)}</td><td>${h.accepted}</td><td>${h.insufficientSample ? '<span class="res-tag res-tag-warn">yetarli namuna yo&#39;q</span>' : ''}</td></tr>`;
      }
      hardHtml += '</tbody></table>';
    }
    setCard('res-hardest', hardHtml);

    // Misconceptions
    const misconceptions = report.misconceptions || [];
    let misHtml = '';
    if (misconceptions.length === 0) misHtml = '<p class="res-muted">Tasdiqlangan noto&#39;g&#39;ri tushuncha yo&#39;q</p>';
    else {
      misHtml = '<ul class="res-list">';
      for (const m of misconceptions) {
        misHtml += `<li><b>${esc(m.label)}</b> — ${esc(m.questionText)}${m.teacherExplanation ? `<br><span class="res-muted">Tushuntirish: ${esc(m.teacherExplanation)}</span>` : ''}</li>`;
      }
      misHtml += '</ul>';
    }
    setCard('res-misconceptions', misHtml);

    // Confidence matrix
    const conf = report.confidenceMatrix || [];
    let confHtml = '';
    if (conf.length === 0) confHtml = '<p class="res-muted">Ishonch ma&#39;lumoti yo&#39;q (yoki kichik namuna — de-identifikatsiya)</p>';
    else {
      confHtml = '<table class="res-table"><thead><tr><th>Savol</th><th>Correct-conf</th><th>Wrong-conf</th></tr></thead><tbody>';
      for (const c of conf.slice(0, 8)) {
        confHtml += `<tr><td>${esc(c.questionId)}</td><td>${c.correctHighConfidence ?? c.correct ?? 0}</td><td>${c.wrongHighConfidence ?? c.wrong ?? 0}</td></tr>`;
      }
      confHtml += '</tbody></table>';
    }
    setCard('res-confidence', confHtml);

    // Revote changes
    const revotes = report.revoteChanges || [];
    let revHtml = '';
    if (revotes.length === 0) revHtml = '<p class="res-muted">Revote ma&#39;lumoti yo&#39;q</p>';
    else {
      revHtml = '<table class="res-table"><thead><tr><th>Savol</th><th>Noto&#39;g&#39;ri → To&#39;g&#39;ri</th><th>To&#39;g&#39;ri → Noto&#39;g&#39;ri</th><th>Barqaror</th></tr></thead><tbody>';
      for (const r of revotes) {
        revHtml += `<tr><td>${esc(r.questionId)}</td><td class="res-pos">${r.wrongToCorrect}</td><td class="res-neg">${r.correctToWrong}</td><td>${r.stable}</td></tr>`;
      }
      revHtml += '</tbody></table>';
    }
    setCard('res-revote', revHtml);

    // Network
    const net = report.networkSummary || {};
    const buckets = net.buckets || {};
    let netHtml = `<p>Namunalar: <b>${net.totalSamples ?? 0}</b> · Texnik uzilish: <b>${net.technicalFailures ?? 0}</b></p>`;
    netHtml += '<ul class="res-list">';
    for (const [b, c] of Object.entries(buckets)) netHtml += `<li>${esc(b)}: ${c}</li>`;
    netHtml += '</ul>';
    setCard('res-network', netHtml);

    // Transfers
    const tr = report.transferResults || {};
    setCard('res-transfer', `<p>Qo'llanilgan: <b>${tr.applied ?? 0}</b> · Ball: <b>${tr.totalPoints ?? 0}</b></p>`);

    // Item quality
    const quality = report.itemQuality || [];
    let qHtml = '';
    if (quality.length === 0) qHtml = '<p class="res-muted">Flaglar yo&#39;q</p>';
    else {
      qHtml = '<table class="res-table"><thead><tr><th>Kod</th><th>Og&#39;irlik</th><th>Harakat</th><th>Xabar</th></tr></thead><tbody>';
      for (const q of quality) {
        const cls = q.severity === 'BLOCKER' ? 'res-tag res-tag-danger' : q.severity === 'WARNING' ? 'res-tag res-tag-warn' : 'res-tag';
        qHtml += `<tr><td>${esc(q.code)}</td><td><span class="${cls}">${esc(q.severity)}</span></td><td>${esc(q.action)}</td><td>${esc(q.message)}</td></tr>`;
      }
      qHtml += '</tbody></table>';
    }
    setCard('res-quality', qHtml);

    // Recommended actions
    const actions = report.recommendedActions || [];
    let actHtml = '';
    if (actions.length === 0) actHtml = '<p class="res-muted">Tavsiyalar yo&#39;q</p>';
    else {
      actHtml = '<ul class="res-list res-actions-list">';
      for (const a of actions) {
        actHtml += `<li><b>${esc(a.label)}</b>${a.reason ? `<br><span class="res-muted">${esc(a.reason)}</span>` : ''}</li>`;
      }
      actHtml += '</ul>';
    }
    setCard('res-actions', actHtml);

    // C5-03: Comparison — faqat staff; incompatible bo'lsa delta/rank blok
    let cmpHtml = '<p class="res-muted">Boshqa sessiya bilan solishtirish: <input id="cmp-session" placeholder="sessionId" style="width:160px;background:#0d101f;border:1px solid #2a3050;color:#eef0ff;border-radius:8px;padding:6px 8px;font:inherit;font-size:12px;"> <button class="cast-btn cast-btn-outline" id="btn-compare" type="button">Solishtirish</button></p><div id="cmp-result"></div>';
    setCard('res-comparison', cmpHtml);
    const cmpBtn = $('btn-compare');
    if (cmpBtn && !cmpBtn.dataset.bound) {
      cmpBtn.dataset.bound = '1';
      cmpBtn.addEventListener('click', async () => {
        const otherId = $('cmp-session')?.value?.trim();
        if (!otherId) return alert('Session id kiriting');
        try {
          const r = await fetch(`/api/cast/sessions/${SID}/comparison`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
            credentials: 'same-origin',
            body: JSON.stringify({ otherSessionId: otherId }),
          });
          const d = await r.json();
          if (!d.ok) return alert(d.error?.message || d.error?.code || 'Xato');
          const c = d.comparison;
          let html = '';
          if (c.compatible) {
            html = '<p class="res-pos">✔ Compatible — side-by-side mumkin</p>';
          } else {
            html = `<p class="res-neg">✘ Incompatible — direct delta/rank bloklandi</p><ul class="res-list">`;
            for (const diff of (c.differences || []).slice(0, 6)) html += `<li>${esc(diff)}</li>`;
            html += '</ul>';
            html += '<p class="res-muted">Faqat alohida hisobotlar (SEPARATE_REPORTS) ko\'rsatiladi — misleading taqqoslash yo\'q.</p>';
          }
          $('cmp-result').innerHTML = html;
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    }

    // Retention
    const ret = report.retention || {};
    let retHtml = `<p>Data class: <b>${esc(ret.dataClass || 'action_pack')}</b> · Saqlash: <b>${ret.days ?? '—'}</b> kun (${esc(ret.expiryAction || '')})</p>`;
    if (ret.expiryAt) {
      const d = new Date(ret.expiryAt);
      retHtml += `<p class="res-muted">Muddati: ${d.toLocaleDateString('uz')}</p>`;
    }
    setCard('res-retention', retHtml);
  }

  async function loadReport() {
    try {
      const r = await fetch(REPORT_URL, { credentials: 'same-origin' });
      const data = await r.json();
      if (data.ok && data.ready) {
        report = data.report;
        render();
      } else {
        $('res-badge').textContent = '⏳ Tayyorlanmoqda…';
        $('res-fingerprint').textContent = data.message || 'Hisobot hali tayyor emas';
        setTimeout(loadReport, 5000);
      }
    } catch (err) {
      $('res-badge').textContent = '⚠️ Yuklash xatosi';
      $('res-fingerprint').textContent = err.message || String(err);
    }
  }

  function bind() {
    const refresh = $('btn-refresh');
    if (refresh) refresh.addEventListener('click', loadReport);

    const csv = $('btn-export-csv');
    if (csv) csv.addEventListener('click', () => { window.location.href = `${EXPORT_URL}?format=csv`; });

    const json = $('btn-export-json');
    if (json) json.addEventListener('click', () => { window.location.href = `${EXPORT_URL}?format=json`; });

    const ai = $('btn-ai-draft');
    if (ai) ai.addEventListener('click', async () => {
      try {
        const r = await fetch(AI_DRAFT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
          credentials: 'same-origin',
          body: JSON.stringify({}),
        });
        const data = await r.json();
        if (data.ok) {
          $('ai-draft-payload').textContent = JSON.stringify(data.draft, null, 2);
          $('ai-modal').hidden = false;
        } else {
          alert(data.error?.message || data.error?.code || 'AI draft xatosi');
        }
      } catch (err) {
        alert(err.message || String(err));
      }
    });

    const close = $('ai-modal-close');
    if (close) close.addEventListener('click', () => { $('ai-modal').hidden = true; });
    const backdrop = $('ai-modal');
    if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.hidden = true; });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    loadReport();
  });
})();
