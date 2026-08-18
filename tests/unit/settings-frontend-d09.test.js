/**
 * AUTH D-09 — Settings frontend unit test (ps qismi, jsdom)
 * -----------------------------------------------------------------
 *  - Accordion: bir vaqtda faqat bitta section ochiq (aria-expanded + hidden),
 *    bosilgan section toggle bo'ladi.
 *  - Profil save: PATCH /user/api/settings/profile (CSRF header), muvaffaqiyat
 *    → 'Saqlangan ✓', xato → 'Saqlashda xatolik', server tushib qolsa → network.
 *  - Toggle: optimistic UI (darhol aria-checked), muvaffaqiyat → saqlanadi,
 *    xato/network → rollback (avvalgi holatga qaytadi).
 *  - i18n: window.__SETTINGS_COPY__ dan o'qiladi (hardcode yo'q).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PAGE = `
<section class="settings-section">
  <button class="settings-acc-head" aria-expanded="true" aria-controls="acc-profile" data-acc="profile">Profil</button>
  <div class="settings-acc-body" id="acc-profile">
    <input class="settings-inp" id="set-name" name="name" type="text" value="Ali" data-profile-field="name">
    <select class="settings-inp" id="set-lang" name="lang" data-profile-field="lang">
      <option value="uz" selected>O'zbek</option>
      <option value="ru">Русский</option>
    </select>
    <button class="settings-save" data-profile-save>Saqlash</button>
    <div class="settings-msg" data-profile-msg role="status"></div>
  </div>
</section>
<section class="settings-section">
  <button class="settings-acc-head" aria-expanded="false" aria-controls="acc-security" data-acc="security">Xavfsizlik</button>
  <div class="settings-acc-body" id="acc-security" hidden></div>
</section>
<section class="settings-section">
  <button class="settings-acc-head" aria-expanded="false" aria-controls="acc-notif" data-acc="notif">Bildirishnomalar</button>
  <div class="settings-acc-body" id="acc-notif" hidden>
    <button class="settings-toggle" role="switch" aria-checked="false" data-toggle-key="telegram_events"></button>
    <button class="settings-toggle" role="switch" aria-checked="true" data-toggle-key="email_events"></button>
    <div class="settings-msg" data-toggle-msg role="status"></div>
  </div>
</section>
`;

let fetchMock;

beforeEach(() => {
  document.body.innerHTML = PAGE;
  window.__CSRF_TOKEN = 'tok123';
  window.__SETTINGS_COPY__ = JSON.stringify({
    saving: 'Saqlanmoqda…',
    saved: 'Saqlangan ✓',
    saveFailed: 'Saqlashda xatolik: __err__',
    network: 'Server bilan bog\u2018lanishda xatolik. Qayta urinib ko\u2018ring.',
    prefSaved: 'Bildirishnoma sozlamalari saqlandi',
    prefFailed: 'Bildirishnoma sozlamalarini saqlashda xatolik',
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function boot() {
  await import('../../public/js/settings.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('AUTH D-09 — settings.js (accordion)', () => {
  it('bosilgan section ochiladi, boshqasi yopiladi (faqat bitta ochiq)', async () => {
    await boot();
    const head = document.querySelector('[data-acc="security"]');
    head.click();
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('acc-security').hidden).toBe(false);
    // Profil yopildi
    const profileHead = document.querySelector('[data-acc="profile"]');
    expect(profileHead.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('acc-profile').hidden).toBe(true);
  });

  it('ochiq sectionni qayta bossa — yopiladi', async () => {
    await boot();
    const profileHead = document.querySelector('[data-acc="profile"]');
    profileHead.click();
    expect(profileHead.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('acc-profile').hidden).toBe(true);
  });

  it('ArrowDown — keyingi head\'ga fokus (keyboard nav)', async () => {
    await boot();
    const heads = document.querySelectorAll('.settings-acc-head[data-acc]');
    heads[0].focus();
    heads[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(heads[1]);
  });

  it('ArrowUp — oldingi head\'ga fokus', async () => {
    await boot();
    const heads = document.querySelectorAll('.settings-acc-head[data-acc]');
    heads[1].focus();
    heads[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(heads[0]);
  });

  it('Home / End — birinchi / oxirgi head', async () => {
    await boot();
    const heads = document.querySelectorAll('.settings-acc-head[data-acc]');
    heads[2].focus();
    heads[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(heads[0]);
    heads[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(heads[2]);
  });
});

describe('AUTH D-09 — settings.js (profil save)', () => {
  it('PATCH /user/api/settings/profile — name+lang yuboriladi, muvaffaqiyat → saved', async () => {
    await boot();
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ ok: true, saved: ['lang', 'name'] }) });
    document.querySelector('[data-profile-save]').click();
    await new Promise((r) => setTimeout(r, 0));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/user/api/settings/profile');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers['X-CSRF-Token']).toBe('tok123');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Ali', lang: 'uz' });
    const msg = document.querySelector('[data-profile-msg]');
    expect(msg.textContent).toBe('Saqlangan ✓');
    expect(msg.className).toContain('ok');
  });

  it('server xatosi → saveFailed, tugma qayta faollashadi', async () => {
    await boot();
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ ok: false, error: 'invalid_profile' }) });
    document.querySelector('[data-profile-save]').click();
    await new Promise((r) => setTimeout(r, 0));
    const msg = document.querySelector('[data-profile-msg]');
    expect(msg.textContent).toBe('Saqlashda xatolik: invalid_profile');
    expect(msg.className).toContain('fail');
    expect(document.querySelector('[data-profile-save]').disabled).toBe(false);
  });

  it('network xatosi → network xabari', async () => {
    await boot();
    fetchMock.mockRejectedValue(new Error('down'));
    document.querySelector('[data-profile-save]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('[data-profile-msg]').textContent).toContain('bog\u2018lanishda xatolik');
  });
});

describe('AUTH D-09 — settings.js (toggle optimistic)', () => {
  it('optimistic: darhol aria-checked almashadi; muvaffaqiyat → saqlanadi', async () => {
    await boot();
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ ok: true, prefs: {} }) });
    const tg = document.querySelector('[data-toggle-key="telegram_events"]');
    tg.click();
    // Optimistic — fetch javobini kutmasdan darhol
    expect(tg.getAttribute('aria-checked')).toBe('true');
    await new Promise((r) => setTimeout(r, 0));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/notifications/prefs');
    expect(JSON.parse(opts.body)).toEqual({ ch_telegram: true });
    expect(tg.getAttribute('aria-checked')).toBe('true'); // rollback yo'q
    expect(document.querySelector('[data-toggle-msg]').textContent).toBe('Bildirishnoma sozlamalari saqlandi');
  });

  it('server xatosi → rollback (avvalgi holatga qaytadi)', async () => {
    await boot();
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ ok: false }) });
    const tg = document.querySelector('[data-toggle-key="telegram_events"]');
    tg.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tg.getAttribute('aria-checked')).toBe('false'); // rollback
    expect(document.querySelector('[data-toggle-msg]').textContent).toBe('Bildirishnoma sozlamalarini saqlashda xatolik');
  });

  it('network xatosi → rollback', async () => {
    await boot();
    fetchMock.mockRejectedValue(new Error('down'));
    const tg = document.querySelector('[data-toggle-key="email_events"]');
    tg.click();
    // Optimistic: false bo'ldi
    expect(tg.getAttribute('aria-checked')).toBe('false');
    await new Promise((r) => setTimeout(r, 0));
    expect(tg.getAttribute('aria-checked')).toBe('true'); // rollback
  });
});
