/**
 * Deborah — Admin user management (AUTH C-08 + D-10)
 * -------------------------------------------------------------------
 * Ro'yxat + qidiruv (username/email) + filter (rol/status) + pagination.
 * Har user: asosiy Bloklash/Aktivlash amali + sessiya va o'chirish uchun ixcham menyu.
 * CSRF: x-csrf-token header (global CSRF middleware).
 * A11y: native buttons, keyboard menu, focus-managed dialogs, live status messages.
 *
 * D-10: optimistic UI + rollback — action bosilganda row darhol busy holatga
 * o'tadi (server javobini kutmay), xatoda avvalgi holat qaytariladi.
 * i18n: window.__ADMIN_COPY__ (admin bloki, 4 til) — yo'q bo'lsa uz fallback.
 * `window.__adminUsers` compatibility API is retained; page events are delegated and CSP-safe.
 */
(function () {
  'use strict';

  var copy = {};
  try {
    copy = typeof window.__ADMIN_COPY__ === 'string'
      ? JSON.parse(window.__ADMIN_COPY__ || '{}')
      : (window.__ADMIN_COPY__ || {});
  } catch (_) {}
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

  let currentPage = 1;
  let pageSize = 25;

  function renderRows(users) {
    const tb = document.getElementById('users-tbody');
    if (!tb) return;
    if (!users.length) {
      tb.innerHTML = '<tr><td colspan="8"><div class="admin-empty">' + esc(t('users.empty', 'Foydalanuvchilar topilmadi')) + '</div></td></tr>';
      return;
    }
    const moreIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>';
    tb.innerHTML = users.map((u, i) => {
      const uname = u.username || u.key;
      const key = String(u.key || '');
      const safeName = esc(uname);
      const safeKey = esc(key);
      const roleOptions = ['student', 'teacher', 'proctor', 'marker', 'board']
        .map((r) => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + r + '</option>')
        .join('');
      const roleLabel = esc(t('users.roleLabel', 'Rol'));
      const btnBlock = esc(t('users.btnBlock', 'Bloklash'));
      const btnUnblock = esc(t('users.btnUnblock', 'Aktivlash'));
      const btnSessions = esc(t('users.btnSessions', 'Sessiyalar'));
      const btnDelete = esc(t('users.btnDelete', "O'chirish"));
      const moreLabel = esc(t('users.moreActions', "Qo'shimcha amallar"));
      const isStaff = u.role === 'teacher' || u.role === 'proctor' || u.role === 'marker' || u.role === 'board';
      const vipCell = isStaff
        ? '<span class="badge badge-info" title="Xodimlar VIP bo\u2018la olmaydi">—</span>'
        : (u.isVip
          ? '<button type="button" class="admin-edit-btn" data-user-action="vip-revoke" data-user-name="' + safeName + '" style="min-height:44px" title="VIP ni olib tashlash">VIP ✕</button>'
          : '<button type="button" class="admin-edit-btn" data-user-action="vip-grant" data-user-name="' + safeName + '" style="min-height:44px" title="VIP berish">+ VIP</button>');
      const primaryAction = u.status === 'blocked'
        ? '<button type="button" class="admin-edit-btn user-primary-action" data-user-action="unblock" data-user-key="' + safeKey + '" data-user-name="' + safeName + '" style="min-height:44px">' + btnUnblock + '</button>'
        : '<button type="button" class="admin-del-btn user-primary-action" data-user-action="block" data-user-key="' + safeKey + '" data-user-name="' + safeName + '" style="min-height:44px">' + btnBlock + '</button>';
      const menuId = 'user-actions-menu-' + i;
      return (
        '<tr class="dt-row">' +
        '<td data-label="#">' + ((currentPage - 1) * pageSize + i + 1) + '</td>' +
        '<td class="dt-cell-main"><span class="font-bold">' + safeName + '</span>' +
        (u.name && u.name !== uname ? '<div class="text-muted" style="font-size:.72rem">' + esc(u.name) + '</div>' : '') +
        '</td>' +
        '<td class="text-muted" data-label="Email" style="font-size:.78rem">' + esc(u.email || '—') + '</td>' +
        '<td data-label="Rol">' +
        '<select data-role-key="' + safeKey + '" data-prev-role="' + esc(u.role || 'student') + '" class="inp" aria-label="' + roleLabel + '" style="min-width:110px;padding:4px 8px;font-size:.75rem">' + roleOptions + '</select>' +
        '</td>' +
        '<td data-label="Status">' + statusBadge(u.status) + '</td>' +
        '<td data-label="VIP">' + vipCell + '</td>' +
        '<td class="text-muted dt-ts" data-label="Sana" style="font-size:.76rem">' + fmtDate(u.created_at) + '</td>' +
        '<td class="dt-actions dt-cell-actions" data-label="Amallar">' +
        '<div class="users-actions" data-user-actions>' + primaryAction +
        '<button type="button" class="user-actions-trigger" data-users-action="toggle-user-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="' + menuId + '" aria-label="' + moreLabel + ': ' + safeName + '" title="' + moreLabel + '">' + moreIcon + '</button>' +
        '<div class="user-actions-menu" id="' + menuId + '" data-user-actions-menu role="menu" aria-label="' + moreLabel + ': ' + safeName + '" hidden>' +
        '<button type="button" role="menuitem" data-user-action="sessions" data-user-key="' + safeKey + '" data-user-name="' + safeName + '">' + btnSessions + '</button>' +
        '<button type="button" role="menuitem" data-user-action="delete" data-user-key="' + safeKey + '" data-user-name="' + safeName + '">' + btnDelete + '</button>' +
        '</div></div>' +
        '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function updatePagination(total, page, serverPageSize, serverPageCount) {
    const numericTotal = Number(total) || 0;
    pageSize = Number(serverPageSize) || pageSize;
    const pageCount = Number(serverPageCount) || Math.max(1, Math.ceil(numericTotal / pageSize));
    currentPage = Math.min(pageCount, Math.max(1, Number(page) || currentPage));
    const totalEl = document.getElementById('users-total');
    const pageEl = document.getElementById('users-page');
    const prev = document.getElementById('users-prev');
    const next = document.getElementById('users-next');
    if (totalEl) totalEl.textContent = fmt(t('users.total', 'Jami: {n} ta foydalanuvchi'), { n: numericTotal });
    if (pageEl) {
      pageEl.textContent = currentPage + ' / ' + pageCount;
      pageEl.setAttribute('aria-label', 'Sahifa ' + currentPage + ' / ' + pageCount);
    }
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= pageCount;
  }

  let loadSequence = 0;
  async function loadUsers(page) {
    closeActionMenus(false);
    currentPage = Math.max(1, Number(page) || 1);
    const requestSequence = ++loadSequence;
    const q = document.getElementById('users-q')?.value || '';
    const role = document.getElementById('users-role')?.value || '';
    const status = document.getElementById('users-status')?.value || '';
    const params = new URLSearchParams({ page: currentPage, pageSize });
    if (q) params.set('q', q);
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const vip = document.getElementById('users-vip')?.value || '';
    if (vip) params.set('vip', vip);
    try {
      const r = await fetch('/admin/api/users?' + params.toString());
      let data = {};
      try { data = await r.json(); } catch (_) { /* non-JSON response */ }
      if (requestSequence !== loadSequence) return;
      if (!r.ok) throw new Error(data.message || data.error || 'Serverdan xato javob olindi.');
      const users = Array.isArray(data.users) ? data.users : [];
      updatePagination(data.total, data.page, data.pageSize, data.pageCount);
      renderRows(users);
    } catch (e) {
      if (requestSequence === loadSequence) {
        showAlert(fmt(t('users.loadFail', "Ro'yxat yuklab bo'lmadi: {err}"), { err: e.message || 'Tarmoq xatosi' }), false);
      }
    }
  }

  function resetFilters() {
    const query = document.getElementById('users-q');
    const role = document.getElementById('users-role');
    const status = document.getElementById('users-status');
    const vip = document.getElementById('users-vip');
    if (query) query.value = '';
    if (role) role.value = '';
    if (status) status.value = '';
    if (vip) vip.value = '';
    loadUsers(1);
  }

  function quickSection(kind) {
    const vip = document.getElementById('users-vip');
    const role = document.getElementById('users-role');
    const status = document.getElementById('users-status');
    if (status) status.value = '';
    if (kind === 'vip') {
      if (vip) vip.value = 'true';
      if (role) role.value = '';
    } else if (kind === 'teacher') {
      if (vip) vip.value = '';
      if (role) role.value = 'teacher';
    } else {
      if (vip) vip.value = '';
      if (role) role.value = '';
    }
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
    const modal = document.querySelector('.modal-overlay:not([hidden])');
    if (!modal) return;
    const focusables = modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
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
    const modal = document.getElementById('block-modal');
    if (modal) modal.hidden = true;
    pendingBlockKey = null;
    if (blockOpener && typeof blockOpener.focus === 'function') blockOpener.focus();
    blockOpener = null;
  }

  let pendingDeleteKey = null;
  let pendingDeleteName = null;
  let deleteOpener = null;

  function openDeleteModal(key, name, opener) {
    pendingDeleteKey = key;
    pendingDeleteName = String(name || key || '');
    deleteOpener = opener || document.activeElement;
    const modal = document.getElementById('delete-modal');
    const label = document.getElementById('delete-user-label');
    const input = document.getElementById('delete-confirm-input');
    const error = document.getElementById('delete-confirm-error');
    const confirmButton = document.getElementById('delete-confirm');
    if (!modal || !input || !confirmButton) return;
    if (label) label.textContent = pendingDeleteName;
    input.value = '';
    input.setAttribute('aria-invalid', 'false');
    input.setAttribute('aria-label', 'Tasdiqlash uchun ' + pendingDeleteName + ' username\'ini kiriting');
    if (error) {
      error.textContent = 'Username to\'liq mos kelmadi.';
      error.hidden = true;
    }
    confirmButton.disabled = true;
    modal.hidden = false;
    input.focus();
  }

  function closeDeleteModal(restoreFocus) {
    const modal = document.getElementById('delete-modal');
    if (modal) modal.hidden = true;
    pendingDeleteKey = null;
    pendingDeleteName = null;
    const opener = deleteOpener;
    deleteOpener = null;
    if (restoreFocus !== false && opener && typeof opener.focus === 'function') opener.focus();
  }

  function validateDeleteInput() {
    const input = document.getElementById('delete-confirm-input');
    const error = document.getElementById('delete-confirm-error');
    const confirmButton = document.getElementById('delete-confirm');
    if (!input || !confirmButton) return false;
    const typed = input.value.trim();
    const matches = !!pendingDeleteName && typed === pendingDeleteName;
    input.setAttribute('aria-invalid', typed && !matches ? 'true' : 'false');
    confirmButton.disabled = !matches;
    if (error) {
      error.textContent = 'Username to\'liq mos kelmadi.';
      error.hidden = !typed || matches;
    }
    return matches;
  }

  async function confirmDelete() {
    if (!validateDeleteInput() || !pendingDeleteKey) {
      const error = document.getElementById('delete-confirm-error');
      if (error) error.hidden = false;
      return;
    }
    const key = pendingDeleteKey;
    const name = pendingDeleteName;
    const confirmButton = document.getElementById('delete-confirm');
    if (confirmButton) confirmButton.disabled = true;
    setRowBusy(key, true);
    try {
      const r = await fetch('/admin/api/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ key }),
      });
      let data = {};
      try { data = await r.json(); } catch (_) { /* server may return non-JSON */ }

      if (r.status === 403 && data.error === 'mfa_stepup_required') {
        setRowBusy(key, false);
        closeDeleteModal();
        redirectToMfaStepup(data.redirect, { key, name });
        return;
      }
      if (!r.ok || data.success !== true) {
        throw new Error(data.message || data.error || 'O\'chirish amalga oshmadi.');
      }

      closeDeleteModal(false);
      setRowBusy(key, false);
      showAlert(fmt(t('users.deleteOk', '{name} o\u2018chirildi'), { name }), true);
      await loadUsers(currentPage);
      const nextFocus = document.querySelector('#users-tbody .user-primary-action') || document.getElementById('users-page');
      if (nextFocus && typeof nextFocus.focus === 'function') nextFocus.focus();
    } catch (e) {
      setRowBusy(key, false);
      if (confirmButton) confirmButton.disabled = !validateDeleteInput();
      const message = e.message || 'Tarmoq bilan bog\u2018lanishda xato yuz berdi.';
      const error = document.getElementById('delete-confirm-error');
      if (error) {
        error.textContent = "O'chirish amalga oshmadi: " + message;
        error.hidden = false;
      }
      showAlert("O'chirish xato: " + message, false);
    }
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
  function deleteUser(key, name) {
    openDeleteModal(key, name);
  }

  // Public test/legacy API; page controls use delegated, CSP-safe events.
  window.__adminUsers = {
    loadUsers, resetFilters, openBlock, closeBlockModal, confirmBlock,
    unblock, changeRole, revokeSessions, vipGrant, vipRevoke, deleteUser,
  };

  let openMenuTrigger = null;
  let openMenuElement = null;
  let openMenuPlaceholder = null;

  function closeActionMenus(restoreFocus) {
    const focusTarget = openMenuTrigger;
    const menu = openMenuElement;
    if (menu) {
      menu.hidden = true;
      menu.style.removeProperty('left');
      menu.style.removeProperty('top');
      menu.style.removeProperty('visibility');
      if (openMenuPlaceholder?.parentNode) {
        openMenuPlaceholder.parentNode.insertBefore(menu, openMenuPlaceholder);
        openMenuPlaceholder.remove();
      } else if (menu.parentNode === document.body) {
        menu.remove();
      }
    }
    document.querySelectorAll('.user-actions-menu:not([hidden])').forEach((otherMenu) => { otherMenu.hidden = true; });
    document.querySelectorAll('[data-users-action="toggle-user-menu"][aria-expanded="true"]').forEach((trigger) => {
      trigger.setAttribute('aria-expanded', 'false');
    });
    openMenuTrigger = null;
    openMenuElement = null;
    openMenuPlaceholder = null;
    if (restoreFocus && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') focusTarget.focus();
  }

  function positionUserMenu(trigger, menu) {
    if (!trigger || !menu || menu.hidden) return;
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.visibility = 'hidden';
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const width = menuRect.width || menu.offsetWidth || 190;
    const height = menuRect.height || menu.offsetHeight || 108;
    const margin = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 480;
    const left = Math.max(margin, Math.min(triggerRect.right - width, viewportWidth - width - margin));
    let top = triggerRect.bottom + 6;
    if (top + height > viewportHeight - margin) top = triggerRect.top - height - 6;
    top = Math.max(margin, Math.min(top, viewportHeight - height - margin));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.visibility = '';
  }

  function positionOpenMenu() {
    if (!openMenuTrigger || !openMenuTrigger.isConnected) {
      if (openMenuTrigger) closeActionMenus(false);
      return;
    }
    const rect = openMenuTrigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 480;
    if (rect.bottom < 0 || rect.top > viewportHeight) return;
    const menuId = openMenuTrigger.getAttribute('aria-controls');
    const menu = menuId ? document.getElementById(menuId) : openMenuElement;
    positionUserMenu(openMenuTrigger, menu);
  }

  function toggleUserMenu(trigger) {
    const container = trigger.closest('[data-user-actions]');
    const menuId = trigger.getAttribute('aria-controls');
    const menu = (menuId && document.getElementById(menuId)) || container?.querySelector('[data-user-actions-menu]');
    if (!menu) return;
    if (!menu.hidden && openMenuTrigger === trigger) {
      closeActionMenus(true);
      return;
    }
    closeActionMenus(false);
    if (!menu.parentNode) return;
    openMenuPlaceholder = document.createComment('user-actions-menu-placeholder');
    menu.parentNode.insertBefore(openMenuPlaceholder, menu);
    document.body.appendChild(menu);
    openMenuElement = menu;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openMenuTrigger = trigger;
    positionUserMenu(trigger, menu);
    const firstItem = menu.querySelector('[role="menuitem"]');
    if (firstItem) {
      try { firstItem.focus({ preventScroll: true }); }
      catch (_) { firstItem.focus(); }
    }
  }

  function redirectToMfaStepup(serverRedirect, intent) {
    const state = {
      key: intent?.key || '',
      name: intent?.name || '',
      page: currentPage,
      q: document.getElementById('users-q')?.value || '',
      role: document.getElementById('users-role')?.value || '',
      status: document.getElementById('users-status')?.value || '',
      vip: document.getElementById('users-vip')?.value || '',
    };
    try { window.sessionStorage.setItem('adminUsersPendingDeleteAfterMfa', JSON.stringify(state)); } catch (_) {}

    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set('mfaStepup', 'delete');
    let stepUpUrl = new URL('/admin/mfa/stepup', window.location.origin);
    try {
      const candidate = new URL(serverRedirect || '/admin/mfa/stepup', window.location.origin);
      if (candidate.origin === window.location.origin && candidate.pathname === '/admin/mfa/stepup') stepUpUrl = candidate;
    } catch (_) { /* trust only the known same-origin step-up route */ }
    stepUpUrl.searchParams.set('returnUrl', returnUrl.pathname + returnUrl.search + returnUrl.hash);
    window.location.assign(stepUpUrl.pathname + stepUpUrl.search);
  }

  function onUserAction(action, button) {
    const key = button.getAttribute('data-user-key') || '';
    const name = button.getAttribute('data-user-name') || key;
    closeActionMenus(true);
    switch (action) {
      case 'block': openBlock(key, name); break;
      case 'unblock': unblock(key, name); break;
      case 'sessions': revokeSessions(key, name); break;
      case 'delete': deleteUser(key, name); break;
      case 'vip-grant': vipGrant(name); break;
      case 'vip-revoke': vipRevoke(name); break;
      default: break;
    }
  }

  document.addEventListener('click', function (event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    const pageAction = target.closest('[data-users-action]');
    if (pageAction) {
      const action = pageAction.getAttribute('data-users-action');
      switch (action) {
        case 'toggle-user-menu': toggleUserMenu(pageAction); break;
        case 'filter': closeActionMenus(false); loadUsers(1); break;
        case 'reset': closeActionMenus(false); resetFilters(); break;
        case 'quick-all': closeActionMenus(false); quickSection(''); break;
        case 'quick-vip': closeActionMenus(false); quickSection('vip'); break;
        case 'quick-teacher': closeActionMenus(false); quickSection('teacher'); break;
        case 'previous-page': closeActionMenus(false); loadUsers(Math.max(1, currentPage - 1)); break;
        case 'next-page': closeActionMenus(false); loadUsers(currentPage + 1); break;
        case 'close-block': closeBlockModal(); break;
        case 'confirm-block': confirmBlock(); break;
        case 'close-delete': closeDeleteModal(); break;
        case 'confirm-delete': confirmDelete(); break;
        default: break;
      }
      return;
    }

    const userAction = target.closest('[data-user-action]');
    if (userAction) {
      onUserAction(userAction.getAttribute('data-user-action'), userAction);
      return;
    }

    if (!target.closest('[data-user-actions]')) closeActionMenus(false);
  });

  document.addEventListener('change', function (event) {
    const select = event.target?.closest?.('[data-role-key]');
    if (select) changeRole(select);
  });

  document.addEventListener('click', function (event) {
    if (event.target?.id === 'block-modal') closeBlockModal();
    if (event.target?.id === 'delete-modal') closeDeleteModal();
  });

  document.addEventListener('keydown', function (event) {
    const activeModal = document.querySelector('.modal-overlay:not([hidden])');
    if (event.key === 'Escape') {
      if (activeModal?.id === 'delete-modal') closeDeleteModal();
      else if (activeModal?.id === 'block-modal') closeBlockModal();
      else if (openMenuTrigger) closeActionMenus(true);
      return;
    }
    if (event.key === 'Tab' && activeModal) {
      trapTab(event);
      return;
    }

    const trigger = event.target?.closest?.('[data-users-action="toggle-user-menu"]');
    if (trigger && event.key === 'ArrowDown') {
      event.preventDefault();
      toggleUserMenu(trigger);
      return;
    }
    const item = event.target?.closest?.('.user-actions-menu [role="menuitem"]');
    if (item) {
      const menu = item.closest('[data-user-actions-menu]');
      const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') || []);
      const index = items.indexOf(item);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (event.key === 'Tab') {
        window.setTimeout(() => closeActionMenus(false), 0);
      }
    }
  });

  window.addEventListener('resize', positionOpenMenu);
  window.addEventListener('scroll', positionOpenMenu, true);

  // Enter qidiruv + debounce (D-10 §07: qidiruv debounce)
  document.addEventListener('DOMContentLoaded', function () {
    let resumeDeleteState = null;
    let initialDeleteState = null;
    let initialPage = 1;
    const locationParams = new URLSearchParams(window.location.search);
    if (locationParams.get('mfaStepup') === 'delete') {
      try {
        const savedState = JSON.parse(window.sessionStorage.getItem('adminUsersPendingDeleteAfterMfa') || 'null');
        if (savedState && typeof savedState.key === 'string' && /^[a-z0-9_-]{1,60}$/.test(savedState.key) && typeof savedState.name === 'string') {
          resumeDeleteState = savedState;
        }
      } catch (_) { resumeDeleteState = null; }
      try { window.sessionStorage.removeItem('adminUsersPendingDeleteAfterMfa'); } catch (_) {}
      if (resumeDeleteState && typeof resumeDeleteState === 'object') {
        const qFilter = document.getElementById('users-q');
        const roleFilter = document.getElementById('users-role');
        const statusFilter = document.getElementById('users-status');
        const vipFilter = document.getElementById('users-vip');
        if (qFilter) qFilter.value = resumeDeleteState.q || '';
        if (roleFilter) roleFilter.value = resumeDeleteState.role || '';
        if (statusFilter) statusFilter.value = resumeDeleteState.status || '';
        if (vipFilter) vipFilter.value = resumeDeleteState.vip || '';
        initialPage = Math.max(1, Number(resumeDeleteState.page) || 1);
      }
      locationParams.delete('mfaStepup');
      locationParams.delete('deleteKey');
      const cleanedSearch = locationParams.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (cleanedSearch ? '?' + cleanedSearch : '') + window.location.hash);
      showAlert("Admin MFA tasdiqlandi. O'chirishni yakunlash uchun username'ni qayta tasdiqlang.", true);
    } else {
      const qFilter = document.getElementById('users-q');
      if (qFilter) qFilter.value = locationParams.get('q') || '';
      const requestedKey = locationParams.get('deleteKey') || '';
      if (/^[a-z0-9_-]{1,60}$/.test(requestedKey)) initialDeleteState = { key: requestedKey, name: '' };
      if (requestedKey) {
        locationParams.delete('deleteKey');
        const cleanedSearch = locationParams.toString();
        window.history.replaceState(window.history.state, '', window.location.pathname + (cleanedSearch ? '?' + cleanedSearch : '') + window.location.hash);
      }
      try { window.sessionStorage.removeItem('adminUsersPendingDeleteAfterMfa'); } catch (_) {}
    }
    currentPage = initialPage;
    loadUsers(initialPage).then(() => {
      const deleteState = resumeDeleteState || initialDeleteState;
      if (!deleteState?.key) return;
      const row = findRow(deleteState.key);
      if (row) {
        const opener = row.querySelector('[data-users-action="toggle-user-menu"]') || row.querySelector('.user-primary-action');
        const rowName = row.querySelector('.font-bold')?.textContent?.trim() || deleteState.name || deleteState.key;
        openDeleteModal(deleteState.key, deleteState.name || rowName, opener);
      } else {
        showAlert("Foydalanuvchi joriy qidiruvda topilmadi. Ro'yxatni yangilang yoki qidiruvni tekshiring.", false);
      }
    });
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
    const deleteInput = document.getElementById('delete-confirm-input');
    if (deleteInput) {
      deleteInput.addEventListener('input', validateDeleteInput);
      deleteInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !document.getElementById('delete-confirm')?.disabled) {
          e.preventDefault();
          confirmDelete();
        }
      });
    }
  });
})();
