/**
 * Deborah — Roster import UI client (C-11)
 * ---------------------------------------------------------------
 * Flow: upload → sessions → mapping → diff → approve/commit →
 *       rollback / reconcile / errors / invites.
 * CSRF: head.ejs global fetch interceptor X-CSRF-Token avtomatik qo'shadi.
 * A11y: aria-live status, aria-busy tugmalar, real label'lar.
 */
(function () {
  'use strict';

  var copy = window.__ROSTER_COPY__ || {};
  var state = { sessionId: null, hash: null };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var statusEl = $('rs-status');
  function status(msg, ok) {
    if (!statusEl) return;
    statusEl.style.display = '';
    statusEl.className = 'rs-chip ' + (ok ? 'rs-ok' : 'rs-err');
    statusEl.innerHTML = esc(msg);
    setTimeout(function () { statusEl.style.display = 'none'; }, 6000);
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  async function api(path, opts) {
    var res = await fetch(path, opts);
    var body = await res.json().catch(function () { return {}; });
    return { status: res.status, body: body };
  }

  // ── Upload ──
  window.rsUpload = async function () {
    var input = $('rs-file');
    var btn = $('rs-upload-btn');
    if (!input.files || !input.files[0]) { status(copy.chooseFile || 'Choose file', false); return; }
    var f = input.files[0];
    if (!/\.(xlsx|csv)$/i.test(f.name)) { status(copy.unsupported || 'Only .xlsx and .csv allowed', false); return; }
    var fd = new FormData();
    fd.append('file', f);
    busy(btn, true);
    btn.textContent = copy.uploading || 'Uploading...';
    try {
      var r = await api('/api/roster/upload', { method: 'POST', body: fd });
      if (r.status === 201 && r.body.ok) {
        state.sessionId = r.body.sessionId;
        status(copy.uploadOk + ' — ' + (r.body.report ? r.body.report.totalRows : '') + ' ' + copy.rows, true);
        var rep = $('rs-upload-result');
        rep.innerHTML = '';
        var report = r.body.report || {};
        var chips = '';
        chips += '<span class="rs-chip rs-ok">' + (report.totalRows || 0) + ' ' + copy.rows + '</span>';
        chips += '<span class="rs-chip">' + (report.totalSheets || 0) + ' ' + copy.sheets + '</span>';
        if ((report.warnings || []).length) chips += '<span class="rs-chip rs-warn">' + report.warnings.length + ' ' + copy.warnings + '</span>';
        if ((report.rowErrors || []).length) chips += '<span class="rs-chip rs-err">' + report.rowErrors.length + ' ' + copy.errors + '</span>';
        rep.innerHTML = chips;
        rsRefreshSessions();
        showMappingCard();
      } else {
        status((r.body && r.body.error) || copy.apiError, false);
      }
    } catch (e) {
      status(copy.apiError, false);
    } finally {
      busy(btn, false);
      btn.textContent = copy.chooseFile || 'Choose file';
    }
  };

  // ── Sessions ──
  window.rsRefreshSessions = async function () {
    var box = $('rs-sessions');
    var statusFilter = ($('rs-status-filter') || {}).value || '';
    var q = statusFilter ? '?status=' + encodeURIComponent(statusFilter) : '';
    box.innerHTML = '<div class="loading"><span class="spinner" style="border-color:var(--deborah-semantic-color-text-muted);border-top-color:var(--deborah-semantic-color-action-primary)"></span></div>';
    try {
      var r = await api('/api/roster/sessions' + q);
      var list = r.body || [];
      if (!Array.isArray(list) || list.length === 0) {
        box.innerHTML = '<div style="font-size:.8rem;color:var(--deborah-semantic-color-text-muted)">' + esc(copy.empty || 'No sessions') + '</div>';
        return;
      }
      var html = '';
      list.forEach(function (s) {
        var isActive = state.sessionId && s.id === state.sessionId;
        html += '<div class="rs-session' + (isActive ? ' active' : '') + '" data-id="' + esc(s.id) + '">' +
          '<div>' +
          '<div style="font-weight:700;font-size:.82rem">' + esc(s.filename || '') + '</div>' +
          '<div style="font-size:.72rem;color:var(--deborah-semantic-color-text-muted)">' + esc(s.status || '') + ' · ' + (s.totalRows || 0) + ' ' + esc(copy.rows || '') + (s.totalErrors ? ' · <span style="color:#dc2626">' + s.totalErrors + ' ' + esc(copy.errors || '') + '</span>' : '') + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-quiet" style="min-height:34px;font-size:.74rem" onclick="rsSelectSession(\'' + esc(s.id) + '\')">' + esc(copy.select || 'Select') + '</button>' +
          '</div>';
      });
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = '<div style="font-size:.8rem;color:#dc2626">' + esc(copy.apiError || '') + '</div>';
    }
  };

  window.rsSelectSession = async function (id) {
    state.sessionId = id;
    state.hash = null;
    rsRefreshSessions();
    showMappingCard();
  };

  function showMappingCard() {
    $('rs-mapping-card').style.display = '';
    $('rs-mapping').innerHTML = '<div class="loading"><span class="spinner" style="border-color:var(--deborah-semantic-color-text-muted);border-top-color:var(--deborah-semantic-color-action-primary)"></span></div>';
  }

  // ── Mapping ──
  window.rsAutoMap = async function () {
    if (!state.sessionId) { status(copy.noMapping || 'Create a mapping first', false); return; }
    var btn = $('rs-map-btn');
    busy(btn, true);
    try {
      var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/map', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (r.status === 200) {
        renderMapping(r.body);
      } else {
        $('rs-mapping').innerHTML = '<div style="font-size:.8rem;color:#dc2626">' + esc((r.body && r.body.error) || copy.apiError) + '</div>';
      }
    } catch (e) {
      $('rs-mapping').innerHTML = '<div style="font-size:.8rem;color:#dc2626">' + esc(copy.apiError) + '</div>';
    } finally {
      busy(btn, false);
    }
  };

  function renderMapping(data) {
    var mapping = data.mapping || {};
    var unmapped = data.unmapped || [];
    var html = '<table class="rs-table"><thead><tr><th>' + esc(copy.column || 'Column') + '</th><th>' + esc(copy.field || 'Field') + '</th></tr></thead><tbody>';
    Object.keys(mapping).forEach(function (col) {
      html += '<tr><td>' + esc(col) + '</td><td><select class="inp" data-col="' + esc(col) + '" style="min-width:140px;font-size:.74rem">' + fieldOptions(mapping[col]) + '</select></td></tr>';
    });
    html += '</tbody></table>';
    if (unmapped.length) {
      html += '<div style="margin-top:8px;font-size:.78rem;color:#f59e0b">' + esc(copy.unmapped || 'Unmapped columns') + ': ' + unmapped.map(esc).join(', ') + '</div>';
    }
    html += '<div class="rs-actions"><button type="button" class="btn btn-primary" onclick="rsSaveMapping()" style="min-height:36px;font-size:.76rem">' + esc(copy.saveMapping || 'Save mapping') + '</button></div>';
    $('rs-mapping').innerHTML = html;
  }

  function fieldOptions(current) {
    var fields = ['username', 'email', 'student_id', 'full_name', 'first_name', 'last_name', 'group', 'faculty', 'specialty', 'course', 'phone', 'external_id', 'semester', 'university'];
    var opts = '<option value="">—</option>';
    fields.forEach(function (f) {
      opts += '<option value="' + f + '"' + (current === f ? ' selected' : '') + '>' + f + '</option>';
    });
    return opts;
  }

  window.rsSaveMapping = async function () {
    if (!state.sessionId) return;
    var mapping = {};
    var selects = document.querySelectorAll('#rs-mapping select[data-col]');
    selects.forEach(function (s) { mapping[s.getAttribute('data-col')] = s.value || null; });
    var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapping: mapping }),
    });
    if (r.status === 200) {
      status((r.body.completeness && r.body.completeness.isComplete) ? (copy.mapped || 'Mapped') : (copy.unmapped || 'Unmapped'), !!r.body.completeness && r.body.completeness.isComplete);
      rsLoadDiff();
    } else {
      status((r.body && r.body.error) || copy.saveFail, false);
    }
  };

  // ── Diff / preview ──
  window.rsLoadDiff = async function () {
    if (!state.sessionId) return;
    $('rs-diff-card').style.display = '';
    try {
      var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/preview');
      if (r.status !== 200) {
        $('rs-diff-chips').innerHTML = '<span class="rs-chip rs-err">' + esc((r.body && r.body.error) || copy.apiError) + '</span>';
        return;
      }
      var d = r.body;
      state.hash = d.hash || null;
      var s = (d.diff && d.diff.summary) || {};
      var chips = '';
      chips += '<span class="rs-chip rs-ok">' + (s.creates || 0) + ' ' + esc(copy.create || 'Create') + '</span>';
      chips += '<span class="rs-chip rs-warn">' + (s.updates || 0) + ' ' + esc(copy.update || 'Update') + '</span>';
      chips += '<span class="rs-chip rs-err">' + (s.deactivates || 0) + ' ' + esc(copy.deactivate || 'Deactivate') + '</span>';
      if (s.conflicts) chips += '<span class="rs-chip rs-err">' + s.conflicts + ' conflict</span>';
      $('rs-diff-chips').innerHTML = chips;

      var v = d.validation || {};
      var vhtml = '';
      if (v.requiredFields && v.requiredFields.missing && v.requiredFields.missing.length) {
        vhtml += '<span class="rs-chip rs-err">' + esc(copy.requiredFail || 'Required fields missing') + '</span> ';
      }
      if (v.duplicates && v.duplicates.length) {
        vhtml += '<span class="rs-chip rs-warn">' + esc(copy.duplicates || 'Duplicate rows') + ': ' + v.duplicates.length + '</span> ';
      }
      if (v.referentialIntegrity && v.referentialIntegrity.issues && v.referentialIntegrity.issues.length) {
        vhtml += '<span class="rs-chip rs-err">' + esc(copy.referential || 'Referential integrity') + '</span>';
      }
      $('rs-diff-validation').innerHTML = vhtml || '';
    } catch (e) {
      $('rs-diff-chips').innerHTML = '<span class="rs-chip rs-err">' + esc(copy.apiError) + '</span>';
    }
  };

  window.rsApprove = async function () {
    if (!state.sessionId) return;
    var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approve: true }),
    });
    status((r.body && r.body.ok) ? (copy.approved || 'Approved') : ((r.body && r.body.error) || copy.apiError), !!(r.body && r.body.ok));
  };

  // ── Commit ──
  window.rsCommit = async function () {
    if (!state.sessionId) return;
    var btn = $('rs-commit-btn');
    busy(btn, true);
    btn.textContent = copy.committing || 'Writing...';
    try {
      var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/commit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hash: state.hash || null }),
      });
      if (r.status === 200 && r.body.ok) {
        status(copy.commitOk || 'Commit successful', true);
        $('rs-post-card').style.display = '';
        var errs = $('rs-errors-link');
        errs.href = '/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/errors/download';
        rsLoadInvites();
      } else {
        status((r.body && (r.body.error || r.body.message)) || copy.commitFail, false);
      }
    } catch (e) {
      status(copy.commitFail, false);
    } finally {
      busy(btn, false);
      btn.textContent = copy.commitBtn || 'Write to database';
    }
  };

  // ── Rollback / reconcile ──
  window.rsRollback = async function () {
    if (!state.sessionId) return;
    if (!window.confirm(copy.rollbackOk ? (copy.rollback + '?') : 'Rollback?')) return;
    var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/rollback', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    status((r.body && r.body.ok) ? (copy.rollbackOk || 'Rollback done') : ((r.body && r.body.error) || copy.rollbackFail), !!(r.body && r.body.ok));
  };

  window.rsReconcile = async function () {
    if (!state.sessionId) return;
    var el = $('rs-reconcile');
    el.innerHTML = '<div class="loading"><span class="spinner" style="border-color:var(--deborah-semantic-color-text-muted);border-top-color:var(--deborah-semantic-color-action-primary)"></span></div>';
    var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/reconcile');
    el.innerHTML = '<span class="rs-chip ' + (r.body && r.body.ok ? 'rs-ok' : 'rs-err') + '">' + esc(JSON.stringify(r.body || r.body.error || '')).slice(0, 220) + '</span>';
  };

  // ── Invites ──
  window.rsCreateInvites = async function () {
    if (!state.sessionId) return;
    var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/invites', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'email' }),
    });
    if (r.status === 201 && r.body.ok) {
      status((copy.createInvites || 'Create invites') + ' — OK', true);
      rsLoadInvites();
    } else {
      status((r.body && r.body.error) || copy.apiError, false);
    }
  };

  window.rsSendInvites = async function () {
    var r = await api('/api/roster/invites/send', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: 'uz' }),
    });
    status(r.status === 200 ? ((copy.sendInvites || 'Send emails') + ' — OK') : ((r.body && r.body.error) || copy.apiError), r.status === 200);
  };

  window.rsLoadInvites = async function () {
    if (!state.sessionId) return;
    var el = $('rs-invites');
    var r = await api('/api/roster/sessions/' + encodeURIComponent(state.sessionId) + '/invites');
    var list = r.body && (r.body.invites || r.body);
    if (!Array.isArray(list)) { el.innerHTML = ''; return; }
    var html = '<div style="font-weight:700;margin-bottom:6px">' + list.length + ' invite</div>';
    list.slice(0, 20).forEach(function (iv) {
      html += '<div style="font-size:.74rem;padding:4px 0;border-bottom:1px solid var(--deborah-semantic-color-border-default)">' +
        esc(iv.email || iv.identity || '') + ' · <span class="rs-chip ' + (iv.status === 'used' ? 'rs-ok' : iv.status === 'pending' ? 'rs-warn' : 'rs-err') + '" style="padding:2px 6px">' + esc(iv.status || '') + '</span></div>';
    });
    el.innerHTML = html;
  };

  // ── Init ──
  document.addEventListener('DOMContentLoaded', function () {
    var drop = $('rs-drop');
    var input = $('rs-file');
    if (drop && input) {
      drop.addEventListener('click', function () { input.click(); });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('drag'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('drag');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          input.files = e.dataTransfer.files;
          rsUpload();
        }
      });
      input.addEventListener('change', function () { if (input.files && input.files[0]) rsUpload(); });
    }
    rsRefreshSessions();
  });
})();
