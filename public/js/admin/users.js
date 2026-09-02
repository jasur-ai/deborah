/**
 * Deborah — Admin user management (AUTH C-08 + D-10)
 * -------------------------------------------------------------------
 * Ro'yxat + qidiruv (username/email) + filter (rol/status) + pagination.
 * Har user: [Bloklash] (sabab majburiy) / [Aktivlash] / [Rol] / [Sessiyalar].
 * CSRF: x-csrf-token header (global CSRF middleware).
 * A11y: native <button>, 44px min-height, role=alert live region.
 *
 * D-10: optimistic UI + rollback — action bosilganda row darhol busy holatga
 * o'tadi (server javobini kutmay), xatoda avvalgi holat qaytariladi.
 * i18n: window.__ADMIN_COPY__ (admin bloki, 4 til) — yo'q bo'lsa uz fallback.
 * `window.__adminUsers` API (EJS inline onclick) SAQLANADI.
 */
(function () {
  'use strict';

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

  const csrf = () => document.getElementById('csrf-token')?.value || '';

  function showAlert(msg, ok) {
    const el = document.getElementById('admin-alert');
    if (!el) return;
    el.textContent = msg;
    el.className = 'msg ' + (ok ? 'ok' : 'err');
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('uz-UZ'); } catch (_) { return '—'; }
  }

  function roleBadge(role) {
    const map = { student: 'accent', teacher: 'ok', proctor: 'warn', marker: 'info', board: 'info' };
    const cls = map[role] || 'accent';
    return '<span class="badge badge-' + cls + '">' + esc(role || 'student') + '</span>';
  }

  function statusBadge(status) {
    if (status === 'blocked') return '<span class="badge badge-danger">' + esc(t('users.blocked', 'Bloklangan')) + '</span>';
    return '<span class="badge badge-ok">' + esc(t('users.active', 'Active')) + '</span>';
  }

  function escAttr(v) {
    return esc(v).replace(/\\/g, '\\\\');
  }

  function renderRows(users) {
    const tb = document.getElementById('users-tbody');
    if (!users.length) {
      tb.innerHTML = '<tr><td colspan="7"><div class="admin-empty">' + esc(t('users.empty', 'Foydalanuvchilar topilmadi')) + '</div></td></tr>';
      return;
    }
    tb.innerHTML = users.map((u, i) => {
      const uname = u.username || u.key;
      const roleOptions = ['student', 'teacher', 'proctor', 'marker', 'board']
        .map((r) => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + r + '</option>')
        .join('');
      const roleLabel = esc(t('users.roleLabel', 'Rol'));
      const btnBlock = esc(t('users.btnBlock', 'Bloklash'));
      const btnUnblock = esc(t('users.btnUnblock', 'Aktivlash'));
      const btnSessions = esc(t('users.btnSessions', 'Sessiyalar'));
      const btnDelete = esc(t('users.btnDelete', "O'chirish"));
      const isStaff = u.role === 'teacher' || u.role === 'proctor' || u.role === 'marker' || u.role === 'board';
      const vipCell = isStaff
        ? '<span class="badge badge-info" title="Xodimlar VIP bo\u2018la olmaydi">—</span>'
        : (u.isVip
          ? '<button type="button" class="admin-edit-btn" onclick="window.__adminUsers.vipRevoke(\'' + escAttr(uname) + '\')" style="min-height:44px" title="VIP ni olib tashlash">VIP ✕</button>'
          : '<button type="button" class="admin-edit-btn" onclick="window.__adminUsers.vipGrant(\'' + escAttr(uname) + '\')" style="min-height:44px" title="VIP berish">+ VIP</button>');
      return (
        '<tr>' +
        '<td>' + ((currentPage - 1) * pageSize + i + 1) + '</td>' +
        '<td class="dt-cell-main"><span class="font-bold">' + esc(uname) + '</span>' +
        (u.name && u.name !== uname ? '<div class="text-muted" style="font-size:.72rem">' + esc(u.name) + '</div>' : '') +
        '</td>' +
        '<td class="text-muted" style="font-size:.78rem">' + esc(u.email || '—') + '</td>' +
        '<td>' +
        '<select data-role-key="' + escAttr(u.key) + '" data-prev-role="' + escAttr(u.role || 'student') + '" class="inp" aria-label="' + roleLabel + '" style="min-width:110px;padding:4px 8px;font-size:.75rem" ' +
        'onchange="window.__adminUsers && window.__adminUsers.changeRole(this)">' + roleOptions + '</select>' +
        '</td>' +
        '<td>' + statusBadge(u.status) + '</td>' +
        '<td>' + vipCell + '</td>' +
        '<td class="text-muted dt-ts" style="font-size:.76rem">' + fmtDate(u.created_at) + '</td>' +
        '<td class="dt-actions">' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        (u.status === 'blocked'
          ? '<button type="button" class="admin-edit-btn" onclick="window.__adminUsers.unblock(\'' + escAttr(u.key) + '\',\'' + escAttr(uname) + '\')" style="min-height:44px">' + btnUnblock + '</button>'
          : '<button type="button" class="admin-del-btn" onclick="window.__adminUsers.openBlock(\'' + escAttr(u.key) + '\',\'' + escAttr(uname) + '\')" style="min-height:44px">' + btnBlock + '</button>') +
        '<button type="button" class="admin-edit-btn" onclick="window.__adminUsers.revokeSessions(\'' + escAttr(u.key) + '\',\'' + escAttr(uname) + '\')" style="min-height:44px">' + btnSessions + '</button>' +
        '<button type="button" class="admin-del-btn" onclick="window.__adminUsers.deleteUser(\'' + escAttr(u.key) + '\',\'' + escAttr(uname) + '\')" style="min-height:44px" title="Foydalanuvchini o\u2018chirish">' + btnDelete + '</button>' +
        '</div>' +
        '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function updatePagination(total) {
    document.getElementById('users-total').textContent = fmt(t('users.total', 'Jami: {n} ta foydalanuvchi'), { n: total });
    document.getElementById('users-page').textContent = String(currentPage);
    document.getElementById('users-prev').disabled = currentPage <= 1;
    document.getElementById('users-next').disabled = currentPage * pageSize >= total;
  }

  let currentPage = 1;
  let pageSize = 25;

  async function loadUsers(page) {
    currentPage = Math.max(1, page || 1);
    const q = document.getElementById('users-q')?.value || '';
    const role = document.getElementById('users-role')?.value || '';
    const status = document.getElementById('users-status')?.value || '';
    const params = new URLSearchParams({ page: currentPage, pageSize });
    if (q) params.set('q', q);
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const vip = document.getElementById('users-vip')?.value || ''; // S22
    if (vip) params.set('vip', vip);
    try {
      const r = await fetch('/admin/api/users?' + params.toString());
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'xato');
      renderRows(data.users || []);
      updatePagination(data.total || 0);
    } catch (e) {
      showAlert(fmt(t('users.loadFail', "Ro'yxat yuklab bo'lmadi: {err}"), { err: e.message }), false);
    }
  }

  function resetFilters() {
    document.getElementById('users-q').value = '';
    document.getElementById('users-role').value = '';
    document.getElementById('users-status').value = '';
    loadUsers(1);
  }

  // ── Optimistic UI: row busy + rollback ──
  function findRow(key) {
    const sel = document.querySelector('[data-role-key="' + key + '"]');
    return sel ? sel.closest('tr') : null;
  }
  function setRowBusy(key, busy) {
    const row = findRow(key);
    if (!row) return;
    row.style.opacity = busy ? '0.55' : '';
    row.style.pointerEvents = busy ? 'none' : '';
    const btns = row.querySelectorAll('button, select');
    for (let i = 0; i < btns.length; i++) btns[i].disabled = busy;
  }
  function optimisticStatus(key, status) {
    const row = findRow(key);
    if (!row) return;
    const badge = row.querySelector('.badge');
    if (!badge) return;
    badge.className = status === 'blocked' ? 'badge badge-danger' : 'badge badge-ok';
    badge.textContent = status === 'blocked' ? t('users.blocked', 'Bloklangan') : t('users.active', 'Active');
  }

  // ── Bloklash (sabab majburiy) ──
  let pendingBlockKey = null;
  let pendingBlockName = null;
  let blockOpener = null; // fokusni qaytarish uchun (D-10 §11 focus management)

  function trapTab(ev) {
    const modal = document.getElementById('block-modal');
    if (modal.hidden) return;
    const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function openBlock(key, name) {
    pendingBlockKey = key;
    pendingBlockName = name;
    blockOpener = document.activeElement;
    document.getElementById('block-user-label').textContent = name;
    document.getElementById('block-reason').value = '';
    document.getElementById('block-reason-err').style.display = 'none';
    document.getElementById('block-modal').hidden = false;
    document.getElementById('block-reason').focus();
  }

  function closeBlockModal() {
    document.getElementById('block-modal').hidden = true;
    pendingBlockKey = null;
    if (blockOpener && typeof blockOpener.focus === 'function') blockOpener.focus();
    blockOpener = null;
  }

  async function confirmBlock() {
    const reason = document.getElementById('block-reason').value.trim();
    if (!reason) {
      document.getElementById('block-reason-err').style.display = 'block';
      return;
    }
    const key = pendingBlockKey;
    const name = pendingBlockName;
    // Optimistic: row darhol busy + bloklangan ko'rinish
    setRowBusy(key, true);
    optimisticStatus(key, 'blocked');
    try {
      const r = await fetch('/admin/api/users/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ key, reason }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'xato');
      showAlert(fmt(t('users.blockedOk', '{name} bloklandi'), { name }), true);
      closeBlockModal();
      loadUsers(currentPage);
    } catch (e) {
      // Rollback
      setRowBusy(key, false);
      optimisticStatus(key, 'active');
      closeBlockModal();
      showAlert(fmt(t('users.blockErr', 'Bloklash xato: {err}'), { err: e.message }), false);
    }
  }

  async function unblock(key, name) {
    if (!confirm(fmt(t('users.confirmUnblock', '{name} ni aktivlashtirasizmi?'), { name }))) return;
    // Optimistic
    setRowBusy(key, true);
    optimisticStatus(key, 'active');
    try {
      const r = await fetch('/admin/api/users/unblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ key }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'xato');
      showAlert(fmt(t('users.unblockedOk', '{name} aktivlashtirildi'), { name }), true);
      loadUsers(currentPage);
    } catch (e) {
      // Rollback
      setRowBusy(key, false);
      optimisticStatus(key, 'blocked');
      showAlert(fmt(t('users.unblockErr', 'Aktivlash xato: {err}'), { err: e.message }), false);
    }
  }

  async function changeRole(sel) {
    const key = sel.getAttribute('data-role-key');
    const role = sel.value;
    const name = sel.closest('tr')?.querySelector('.font-bold')?.textContent || key;
    if (!confirm(fmt(t('users.confirmRole', '{name} rolini "{role}" ga o\'zgartirasizmi? (barcha sessiyalari bekor qilinadi)'), { name, role }))) {
      loadUsers(currentPage); // revert
      return;
    }
    // Optimistic: select allaqachon yangi qiymatda — row busy
    setRowBusy(key, true);
    try {
      const r = await fetch('/admin/api/users/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ key, role }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'xato');
      showAlert(fmt(t('users.roleOk', "{name} roli o'zgartirildi → {role}"), { name, role }), true);
      loadUsers(currentPage);
    } catch (e) {
      // Rollback: select'ni avvalgi qiymatga qaytarish
      setRowBusy(key, false);
      const prev = sel.getAttribute('data-prev-role') || 'student';
      sel.value = prev;
      loadUsers(currentPage);
      showAlert(fmt(t('users.roleErr', "Rol o'zgartirish xato: {err}"), { err: e.message }), false);
    }
  }

  async function revokeSessions(key, name) {
    if (!confirm(fmt(t('users.confirmRevoke', '{name} ning barcha sessiyalarini yakunlaysizmi?'), { name }))) return;
    // Optimistic
    setRowBusy(key, true);
    try {
      const r = await fetch('/admin/api/users/revoke-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ key }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'xato');
      showAlert(fmt(t('users.revokeOk', '{name}: {n} ta sessiya yakunlandi'), { name, n: data.count || 0 }), true);
      setRowBusy(key, false);
    } catch (e) {
      // Rollback
      setRowBusy(key, false);
      showAlert(fmt(t('users.revokeErr', 'Sessiya yakunlash xato: {err}'), { err: e.message }), false);
    }
  }

  /* ── S34f: VIP grant/revoke + Delete (real endpointlar) ── */
  async function vipGrant(username) {
    if (!confirm(fmt(t('users.confirmVip', '{name} ga VIP berilsinmi? (vaqtinchalik parol yaratiladi)'), { name }))) return;
    try {
      const r = await fetch('/admin/api/vip/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ username }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'xato');
      const pass = data.vipPlainPassword || data.vipPass || '';
      if (pass) {
        prompt('VIP berildi! Vaqtinchalik parol (nusxalab qo\'ying):', pass);
      } else {
        showAlert(fmt(t('users.vipOk', '{name} — VIP berildi'), { name }), true);
      }
      loadUsers(currentPage);
    } catch (e) {
      showAlert('VIP berish xato: ' + e.message, false);
    }
  }
  async function vipRevoke(username) {
    if (!confirm(fmt(t('users.confirmVipRevoke', '{name} dan VIP olinadi. Davom etasizmi?'), { name }))) return;
    try {
      const r = await fetch('/admin/api/vip/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ username }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'xato');
      showAlert(fmt(t('users.vipRevokeOk', '{name} — VIP olib tashlandi'), { name }), true);
      loadUsers(currentPage);
    } catch (e) {
      showAlert('VIP olish xato: ' + e.message, false);
    }
  }
  async function deleteUser(key, name) {
    const typed = prompt('"' + name + '" foydalanuvchisini o\u2018chirish uchun username\u2018ni kiriting:', '');
    if (typed === null) return;
    if (typed !== name) { showAlert("Username mos kelmadi — bekor qilindi.", false); return; }
    setRowBusy(key, true);
    try {
      const r = await fetch('/admin/api/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ key }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || data.message || 'xato');
      showAlert(fmt(t('users.deleteOk', '{name} o\u2018chirildi'), { name }), true);
      loadUsers(currentPage);
    } catch (e) {
      setRowBusy(key, false);
      showAlert("O'chirish xato: " + e.message, false);
    }
  }

  // Global — inline onclick uchun
  window.__adminUsers = { openBlock, closeBlockModal, confirmBlock, unblock, changeRole, revokeSessions, vipGrant, vipRevoke, deleteUser };

  // Enter qidiruv + debounce (D-10 §07: qidiruv debounce)
  document.addEventListener('DOMContentLoaded', function () {
    loadUsers(1);
    const q = document.getElementById('users-q');
    if (q) {
      let debounceTimer = null;
      q.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () { loadUsers(1); }, 300);
      });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounceTimer); loadUsers(1); }
      });
    }
    // Modal ESC yopish + Tab trap (D-10 §11 focus management)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !document.getElementById('block-modal').hidden) closeBlockModal();
      if (e.key === 'Tab' && !document.getElementById('block-modal').hidden) trapTab(e);
    });
  });
})();
