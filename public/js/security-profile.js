/**
 * Edikit — Security Profile Badge & Instruction UI client (Prompt 36)
 *
 * Loads the student's assignments, fetches the sanitized security profile for
 * the selected one, renders the S0–S4 badge + requirement rows + unsupported
 * control blocker report, and runs server-side SEB boundary verification.
 *
 * Security: the badge data comes from the whitelist sanitizer on the server;
 * this client never sees the registered SEB key hash or policy internals.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function iconSvg(name) {
    // Minimal inline set (mirrors icons.js shapes used on the page).
    const paths = {
      shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
      alertTriangle: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
      monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
      globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
      key: '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    };
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:100%;height:100%">' + (paths[name] || paths.shieldCheck) + '</svg>';
  }

  const content = document.getElementById('content');
  const pick = document.getElementById('assign-pick');
  let assignments = [];

  async function loadAssignments() {
    try {
      const res = await fetch('/api/student/assignments');
      if (!res.ok) throw new Error('Assignments yuklab bo‘lmadi');
      const data = await res.json();
      assignments = data.assignments || [];
      pick.innerHTML = '<option value="">Assessment tanlang...</option>' +
        assignments.map(function (a) {
          return '<option value="' + a.assignment_id + '">' + esc(a.title) + '</option>';
        }).join('');
      if (assignments.length === 0) {
        content.innerHTML = '<div class="empty">Sizga hali assessment tayinlanmagan.</div>';
      }
    } catch (e) {
      content.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }

  async function loadProfile(assignmentId) {
    content.innerHTML = '<div class="loading"><span class="spinner" style="border-color:var(--muted);border-top-color:var(--accent)"></span> Profil tekshirilmoqda...</div>';
    try {
      const res = await fetch('/api/student/assignments/' + assignmentId + '/security-profile');
      if (!res.ok) throw new Error((await res.json()).error || 'Profil topilmadi');
      const data = await res.json();
      render(data);
    } catch (e) {
      content.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }

  function reqIcon(name, ok) {
    if (ok === true) return '<div class="req-ico ok">' + iconSvg('shieldCheck') + '</div>';
    if (ok === false) return '<div class="req-ico fail">' + iconSvg('alertTriangle') + '</div>';
    return '<div class="req-ico na">' + iconSvg(name) + '</div>';
  }

  function render(data) {
    const badge = data.badge;
    const report = data.report || { checks: [], unsupported: [] };
    const controls = report.controls || {};

    let html = '';

    // ── Badge ──
    html += '<div class="badge-card">' +
      '<div class="badge-icon">' + iconSvg('shieldCheck') + '</div>' +
      '<div>' +
        '<div class="badge-code">' + esc(badge.code) + '</div>' +
        '<div class="badge-label">' + esc(badge.label) + '</div>' +
        '<div class="badge-desc">' + esc(badge.description) + '</div>' +
        (badge.clamped_up ? '<div class="clamp-note">' + iconSvg('alertTriangle') + ' Institut minimal darajasi qo‘llandi</div>' : '') +
      '</div>' +
    '</div>';

    // ── Requirements ──
    html += '<div class="sec-title">' + iconSvg('shieldCheck') + ' <span>Talablar</span></div>';
    html += '<div class="req-list">';

    const checks = report.checks || [];
    const checkOk = function (name) {
      const c = checks.find(function (x) { return x.name === name; });
      return c ? (c.ok === true ? true : (c.ok === false ? false : null)) : null;
    };

    // Identity
    const idOk = checkOk('identity');
    html += '<div class="req-row ' + (idOk === false ? 'fail' : 'ok') + '">' +
      reqIcon('user', idOk) +
      '<div><div class="req-name">Identifikatsiya</div><div class="req-detail">talab: ' + esc(controls.identity_level || 'none') + '</div></div>' +
    '</div>';

    // Camera
    const camOk = checkOk('camera');
    html += '<div class="req-row ' + (camOk === false ? 'fail' : camOk ? 'ok' : '') + '">' +
      reqIcon('camera', camOk) +
      '<div><div class="req-name">Kamera</div><div class="req-detail">' + esc((checks.find(function (x) { return x.name === 'camera'; }) || {}).detail || '') + '</div></div>' +
    '</div>';

    // SEB
    const sebOk = checkOk('seb');
    html += '<div class="req-row ' + (sebOk === false ? 'fail' : sebOk ? 'ok' : '') + '">' +
      reqIcon('monitor', sebOk) +
      '<div><div class="req-name">Safe Exam Browser</div><div class="req-detail">' + esc((checks.find(function (x) { return x.name === 'seb'; }) || {}).detail || '') + '</div></div>' +
    '</div>';

    // Managed device
    const mdOk = checkOk('managed_device');
    html += '<div class="req-row ' + (mdOk === false ? 'fail' : mdOk ? 'ok' : '') + '">' +
      reqIcon('monitor', mdOk) +
      '<div><div class="req-name">Boshqariladigan qurilma</div><div class="req-detail">' + esc((checks.find(function (x) { return x.name === 'managed_device'; }) || {}).detail || '') + '</div></div>' +
    '</div>';

    // LAN mode
    const lanOk = checkOk('lan_mode');
    html += '<div class="req-row ' + (lanOk === false ? 'fail' : lanOk ? 'ok' : '') + '">' +
      reqIcon('globe', lanOk) +
      '<div><div class="req-name">LAN rejimi</div><div class="req-detail">' + esc((checks.find(function (x) { return x.name === 'lan_mode'; }) || {}).detail || '') + '</div></div>' +
    '</div>';

    html += '</div>';

    // ── Unsupported control report ──
    if (report.unsupported && report.unsupported.length > 0) {
      html += '<div class="unsup-box">' +
        '<div class="unsup-h">' + iconSvg('alertTriangle') + ' Bajarilmagan talablar</div>' +
        report.unsupported.map(function (u) {
          return '<div class="unsup-item">' + iconSvg('alertTriangle') + ' ' + esc(u.message) + '</div>';
        }).join('') +
      '</div>';
    } else {
      html += '<div class="unsup-box" style="border-color:rgba(0,229,160,.3);background:rgba(0,229,160,.05)">' +
        '<div class="unsup-h" style="color:var(--green)">' + iconSvg('shieldCheck') + ' Barcha talablar qondirilgan</div>' +
      '</div>';
    }

    // ── SEB verify (only when SEB is a requirement) ──
    if (controls.seb_required) {
      html += '<div class="sec-title">' + iconSvg('key') + ' <span>SEB kalitini tekshirish</span></div>' +
        '<div class="verify-row">' +
          '<input class="verify-inp" id="seb-key" placeholder="SEB config kalit xeshini kiriting (32 hex belgisi)" maxlength="64">' +
          '<button class="verify-btn" id="seb-verify-btn">' + iconSvg('shieldCheck') + ' Tekshirish</button>' +
        '</div>' +
        '<div class="verdict" id="seb-verdict" style="display:none"></div>';
    }

    content.innerHTML = html;

    if (controls.seb_required) {
      document.getElementById('seb-verify-btn').addEventListener('click', function () {
        verifySeb(assignmentId);
      });
    }
  }

  async function verifySeb(assignmentId) {
    const btn = document.getElementById('seb-verify-btn');
    const verdict = document.getElementById('seb-verdict');
    const keyInp = document.getElementById('seb-key');
    btn.disabled = true;
    verdict.style.display = 'block';
    verdict.className = 'verdict';
    verdict.textContent = 'Tekshirilmoqda...';
    try {
      const res = await fetch('/api/student/assignments/' + assignmentId + '/security/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sebPresent: true,
          configKeyHash: (keyInp.value || '').trim(),
          userAgent: navigator.userAgent,
        }),
      });
      const data = await res.json();
      verdict.className = 'verdict ' + (data.ok ? 'ok' : 'fail');
      verdict.innerHTML = (data.ok ? '<span style="color:var(--green)">SEB boundary tasdiqlandi</span>' : '<span style="color:var(--accent)">' + esc(data.reason || 'Tekshiruv o‘tmadi') + '</span>');
    } catch (e) {
      verdict.className = 'verdict fail';
      verdict.textContent = 'Xato: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  pick.addEventListener('change', function () {
    const v = pick.value;
    if (v) loadProfile(parseInt(v, 10));
    else content.innerHTML = '<div class="empty">Assessment tanlang.</div>';
  });

  loadAssignments();
})();
