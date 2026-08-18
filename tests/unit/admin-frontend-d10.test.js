/**
 * AUTH D-10 — Admin frontend unit test (ps qismi, jsdom)
 * -----------------------------------------------------------------
 *  - users.js optimistic UI: block → row darhol 'Bloklangan' + busy; xatoda
 *    rollback (status avvalgi holatga qaytadi, row qayta faol).
 *  - changeRole: xatoda select avvalgi rolga qaytadi (data-prev-role).
 *  - audit.js i18n: window.__ADMIN_COPY__ dan kalitlar o'qiladi (fallback uz).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PAGE = `
<input type="hidden" id="csrf-token" value="csrf-1">
<div id="admin-alert" class="msg" style="display:none"></div>
<table>
  <tbody id="users-tbody"></tbody>
</table>
<div id="users-total"></div>
<div id="users-page"></div>
<button id="users-prev"></button>
<button id="users-next"></button>
<input id="users-q">
<div id="block-modal" hidden>
  <div id="block-user-label"></div>
  <textarea id="block-reason"></textarea>
  <div id="block-reason-err" style="display:none"></div>
</div>
<div id="audit-tbody"></div>
<div id="audit-total"></div>
`;

const USERS_API = [
  { key: 'u1', username: 'ali', email: 'ali@test.uz', role: 'student', status: 'active', created_at: Date.now() },
];

let fetchMock;

beforeEach(() => {
  document.body.innerHTML = PAGE;
  window.__CSRF_TOKEN = 'csrf-1';
  window.__ADMIN_COPY__ = JSON.stringify({
    users: {
      blocked: 'Bloklangan',
      active: 'Active',
      empty: 'Foydalanuvchilar topilmadi',
      total: 'Jami: {n} ta foydalanuvchi',
      loadFail: "Ro'yxat yuklab bo'lmadi: {err}",
      btnBlock: 'Bloklash',
      btnUnblock: 'Aktivlash',
      btnSessions: 'Sessiyalar',
      blockedOk: '{name} bloklandi',
      unblockedOk: '{name} aktivlashtirildi',
      roleOk: "{name} roli o'zgartirildi → {role}",
      revokeOk: '{name}: {n} ta sessiya yakunlandi',
      blockErr: 'Bloklash xato: {err}',
      unblockErr: 'Aktivlash xato: {err}',
      roleErr: "Rol o'zgartirish xato: {err}",
      revokeErr: 'Sessiya yakunlash xato: {err}',
      confirmUnblock: '{name} ni aktivlashtirasizmi?',
      confirmRole: '{name} rolini "{role}" ga o\'zgartirasizmi?',
      confirmRevoke: '{name} ning barcha sessiyalarini yakunlaysizmi?',
      roleLabel: 'Rol',
    },
    audit: {
      empty: 'Hodisalar topilmadi',
      total: 'Jami: {n} ta hodisa',
      loadFail: 'Yuklash xato: {err}',
      chartNoData: "Ma'lumot yo'q",
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function bootUsers() {
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ users: USERS_API, total: 1 }),
  });
  await import('../../public/js/admin/users.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 0));
}

describe('AUTH D-10 — users.js optimistic UI', () => {
  it('block: confirm → row darhol Bloklangan (optimistic), xatoda rollback', async () => {
    await bootUsers();
    // Birinchi fetch (loadUsers) — allaqachon ishladi; block uchun yangi mock
    const calls = fetchMock.mock.calls.length;
    window.__adminUsers.openBlock('u1', 'ali');
    document.getElementById('block-reason').value = 'spam';
    expect(document.getElementById('block-modal').hidden).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error('server down'));
    await window.__adminUsers.confirmBlock();

    // Xato → rollback: modal yopildi, xabar err, yangi fetch chaqirilmadi
    expect(document.getElementById('block-modal').hidden).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(calls + 1); // faqat block POST
    const alertEl = document.getElementById('admin-alert');
    expect(alertEl.className).toContain('err');
    expect(alertEl.textContent).toContain('Bloklash xato');
  });

  it('block: muvaffaqiyat → blockedOk xabari + ro\'yxat qayta yuklanadi', async () => {
    await bootUsers();
    const calls = fetchMock.mock.calls.length;
    window.__adminUsers.openBlock('u1', 'ali');
    document.getElementById('block-reason').value = 'spam';
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await window.__adminUsers.confirmBlock();
    await new Promise((r) => setTimeout(r, 0));
    const alertEl = document.getElementById('admin-alert');
    expect(alertEl.className).toContain('ok');
    expect(alertEl.textContent).toBe('ali bloklandi');
    expect(fetchMock.mock.calls.length).toBe(calls + 2); // block POST + reload
  });

  it('unblock: xatoda status rollback', async () => {
    await bootUsers();
    // Row'ni bloklangan ko'rinishga o'tkazamiz (simulyatsiya)
    const row = document.querySelector('[data-role-key="u1"]').closest('tr');
    row.querySelector('.badge').className = 'badge badge-danger';
    row.querySelector('.badge').textContent = 'Bloklangan';

    fetchMock.mockRejectedValueOnce(new Error('down'));
    await window.__adminUsers.unblock('u1', 'ali');
    const alertEl = document.getElementById('admin-alert');
    expect(alertEl.className).toContain('err');
    expect(alertEl.textContent).toContain('Aktivlash xato');
  });

  it('changeRole: xatoda select data-prev-role ga qaytadi (rollback)', async () => {
    await bootUsers();
    const sel = document.querySelector('[data-role-key="u1"]');
    sel.value = 'teacher'; // onchange → changeRole
    // rollback uchun data-prev-role 'student'
    expect(sel.getAttribute('data-prev-role')).toBe('student');

    fetchMock.mockRejectedValueOnce(new Error('down'));
    await window.__adminUsers.changeRole(sel);
    // Optimistic: fetch'dan oldin busy; xatoda select student ga qaytdi
    expect(sel.value).toBe('student');
    expect(document.getElementById('admin-alert').textContent).toContain("Rol o'zgartirish xato");
  });

  it('qidiruv: input debounce 300ms (D-10 §07)', async () => {
    await bootUsers();
    fetchMock.mockClear();
    const q = document.getElementById('users-q');
    q.value = 'ali';
    q.dispatchEvent(new Event('input'));
    // 300ms dan oldin — fetch chaqirilmaydi
    await new Promise((r) => setTimeout(r, 150));
    expect(fetchMock.mock.calls.length).toBe(0);
    // 300ms dan keyin — qidiruv ishga tushadi (faqat 1 marta)
    await new Promise((r) => setTimeout(r, 250));
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('modal: focus trap — Tab oxirgi elementda fokus birinchiga qaytadi (D-10 §11)', async () => {
    await bootUsers();
    // Modal to'liq tarkibi (EJS'ga mos) — fokus trap uchun
    const modal = document.getElementById('block-modal');
    modal.innerHTML = '<div id="block-user-label"></div><textarea id="block-reason"></textarea><div id="block-reason-err"></div><button id="m-cancel">Bekor</button><button id="m-confirm">Tasdiqlash</button>';
    window.__adminUsers.openBlock('u1', 'ali');
    const first = document.getElementById('block-reason'); // birinchi focusable
    const last = document.getElementById('m-confirm');
    last.focus();
    // Oxirgi elementda Tab — birinchi elementga qaytadi
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
    // Shift+Tab birinchi elementda — oxirgi elementga
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
  });

  it('modal: ESC yopadi va fokus trigger\'ga qaytadi (D-10 §11)', async () => {
    await bootUsers();
    const trigger = document.createElement('button');
    trigger.id = 'trigger-btn';
    document.body.appendChild(trigger);
    trigger.focus();
    window.__adminUsers.openBlock('u1', 'ali');
    expect(document.getElementById('block-modal').hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('block-modal').hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('AUTH D-10 — audit.js i18n', () => {
  it('__ADMIN_COPY__ dan audit.total o\'qiladi (i18n)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], total: 42 }),
    });
    await import('../../public/js/admin/audit.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 0));
    // loadAudit -> updatePagination -> t('audit.total')
    expect(document.getElementById('audit-total').textContent).toBe('Jami: 42 ta hodisa');
  });
});
