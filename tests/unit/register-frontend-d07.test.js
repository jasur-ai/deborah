/**
 * Deborah — D-07 Register frontend (public/js/register.js) — Unit tests
 * --------------------------------------------------------------------
 * jsdom environment'da register.js'ning DOM logikasini tekshiramiz:
 *   - rol kartalari → teacher-note + teacher-app-fields (A-19/B-29)
 *   - invite toggle (aria-expanded + fokus)
 *   - email live check debounce 300ms (B-05 + D-07)
 *   - password strength meter (zxcvbn / heuristic, B-27 + D-07)
 *   - honeypot submit guard (A-21 + D-07)
 *
 * register.js IIFE — DOMContentLoaded'da ishlaydi, shuning uchun test'da
 * DOM yaratib, faylni import qilib, DOMContentLoaded'ni dispatch qilamiz.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const HTML = `
<div id="auth-alert" class="msg" role="alert"></div>
<fieldset class="role-grid" id="role-select">
  <label class="role-card">
    <input type="radio" name="role" value="" checked>
  </label>
  <label class="role-card">
    <input type="radio" name="role" value="teacher">
  </label>
</fieldset>
<p class="role-note" id="teacher-note" hidden></p>
<div id="teacher-app-fields" hidden>
  <input id="reg-university" name="university">
</div>
<form id="form-reg" class="auth-form" method="POST" action="/user/login">
  <div class="hp-field" aria-hidden="true">
    <input id="reg-website" name="website" type="text" tabindex="-1" value="">
  </div>
  <input id="reg-email" name="email" type="email"
    data-disposable="Doimiy email manzilini ishlating"
    data-checking="Tekshirilmoqda..."
    data-available="Email mavjud ✓">
  <div class="err-text" id="err-reg-email" data-inline-error="reg-email" style="display:none" role="alert"><span></span></div>
  <div class="email-suggest" id="email-suggest" hidden role="status" aria-live="polite" data-typo-tpl="Did you mean %s?">
    <button type="button" id="email-suggest-btn"><span></span></button>
  </div>
  <div class="email-status" id="email-status" hidden role="status"></div>
  <div class="pw-wrap">
    <input id="reg-password" name="password" type="password" minlength="15" maxlength="128">
  </div>
  <div class="strength" id="pw-strength">
    <div class="strength-bar"><div class="strength-fill" id="pw-strength-bar"></div></div>
    <span class="strength-hint" id="pw-strength-hint" data-labels='["Juda zaif","Zaif","Ortacha","Yaxshi","Zor"]'></span>
  </div>
  <div class="invite-row">
    <button type="button" class="invite-toggle" id="invite-toggle" aria-expanded="false" aria-controls="invite-fields"></button>
  </div>
  <div class="invite-fields" id="invite-fields" hidden>
    <input id="reg-invite" name="invite">
  </div>
</form>
`;

let fetchMock;

beforeEach(() => {
  document.body.innerHTML = HTML;
  // window.__CSRF_TOKEN (register.ejs da inline script o'rnatadi)
  window.__CSRF_TOKEN = 'test-csrf';
  // fetch mock — default: mavjud email
  fetchMock = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: true, suggestion: null }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function bootRegister() {
  // register.js IIFE DOMContentLoaded listener'ini qo'shadi
  await import('../../public/js/register.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('D-07 — rol kartalari (A-19/B-29)', () => {
  it('student (default) → teacher-note va app fields yashirin', async () => {
    await bootRegister();
    expect(document.getElementById('teacher-note').hidden).toBe(true);
    expect(document.getElementById('teacher-app-fields').hidden).toBe(true);
  });

  it('teacher tanlansa → teacher-note + app fields kochrinadi, university required', async () => {
    await bootRegister();
    const teacher = document.querySelector('input[name="role"][value="teacher"]');
    teacher.checked = true;
    teacher.dispatchEvent(new Event('change'));
    expect(document.getElementById('teacher-note').hidden).toBe(false);
    expect(document.getElementById('teacher-app-fields').hidden).toBe(false);
    expect(document.getElementById('reg-university').required).toBe(true);
  });

  it('teacher → student ga qaytsa → yashirin, required olib tashlanadi', async () => {
    await bootRegister();
    const teacher = document.querySelector('input[name="role"][value="teacher"]');
    teacher.checked = true;
    teacher.dispatchEvent(new Event('change'));
    const student = document.querySelector('input[name="role"][value=""]');
    student.checked = true;
    student.dispatchEvent(new Event('change'));
    expect(document.getElementById('teacher-note').hidden).toBe(true);
    expect(document.getElementById('teacher-app-fields').hidden).toBe(true);
    expect(document.getElementById('reg-university').required).toBe(false);
  });
});

describe('D-07 — invite toggle', () => {
  it('bosilsa ochiladi (aria-expanded=true) va fokus invite ga otadi', async () => {
    await bootRegister();
    const btn = document.getElementById('invite-toggle');
    const fields = document.getElementById('invite-fields');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const focusSpy = vi.spyOn(document.getElementById('reg-invite'), 'focus');
    btn.dispatchEvent(new Event('click'));
    expect(fields.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(focusSpy).toHaveBeenCalled();
  });

  it('yana bosilsa yopiladi', async () => {
    await bootRegister();
    const btn = document.getElementById('invite-toggle');
    btn.dispatchEvent(new Event('click'));
    btn.dispatchEvent(new Event('click'));
    expect(document.getElementById('invite-fields').hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('D-07 — email live check (debounce 300ms, B-05)', () => {
  it('input da 300ms debounce — tez yozishda bitta sorov', async () => {
    // Faqat setTimeout'ni fake qilamiz — Date.now() real qoladi (throttle uchun)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await bootRegister();
    const email = document.getElementById('reg-email');
    email.value = 'a@b';
    email.dispatchEvent(new Event('input'));
    email.value = 'ab@';
    email.dispatchEvent(new Event('input'));
    email.value = 'user@deborah.uz';
    email.dispatchEvent(new Event('input'));
    expect(fetchMock).not.toHaveBeenCalled(); // hali debounce kutmoqda
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mavjud email → Email mavjud status kochrinadi', async () => {
    vi.useFakeTimers();
    await bootRegister();
    const email = document.getElementById('reg-email');
    email.value = 'user@deborah.uz';
    email.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve(); // fetch .then larini yugurtirish
    await Promise.resolve();
    const status = document.getElementById('email-status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Email mavjud ✓');
  });

  it('disposable email → inline xato (hard block)', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, reason: 'disposable', suggestion: null }),
    });
    await bootRegister();
    const email = document.getElementById('reg-email');
    email.value = 'user@mailinator.com';
    email.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();
    await Promise.resolve();
    const err = document.getElementById('err-reg-email');
    expect(err.style.display).toBe('flex');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(err.textContent).toContain('Doimiy email manzilini ishlating');
  });

  it('typo domen → suggestion kochrinadi va bosilsa domen tuzatiladi', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, suggestion: 'gmail.com' }),
    });
    await bootRegister();
    const email = document.getElementById('reg-email');
    email.value = 'user@gmial.com';
    email.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();
    await Promise.resolve();
    const suggest = document.getElementById('email-suggest');
    expect(suggest.hidden).toBe(false);
    document.getElementById('email-suggest-btn').click();
    expect(email.value).toBe('user@gmail.com');
    expect(suggest.hidden).toBe(true);
  });

  it('blur da darhol tekshiradi (debounce ni kutmaydi)', async () => {
    await bootRegister();
    const email = document.getElementById('reg-email');
    email.value = 'user@deborah.uz';
    email.dispatchEvent(new Event('blur'));
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('D-07 — password strength meter (B-27/zxcvbn)', () => {
  it('kuchli parol → bar kengayadi, setCustomValidity tozalanadi', async () => {
    await bootRegister();
    const pw = document.getElementById('reg-password');
    const bar = document.getElementById('pw-strength-bar');
    pw.value = 'parol-2026-x-uzun-kuchli';
    pw.dispatchEvent(new Event('input'));
    expect(bar.style.width).not.toBe('0%');
    expect(pw.validity.customError).toBe(false);
  });

  it('qisqa parol → customError (min 15)', async () => {
    await bootRegister();
    const pw = document.getElementById('reg-password');
    pw.value = 'qisqa';
    pw.dispatchEvent(new Event('input'));
    expect(pw.validity.customError).toBe(true);
  });
});

describe('D-07 — honeypot guard (A-21)', () => {
  it('honeypot toldirilgan bolsa submit bloklanadi', async () => {
    await bootRegister();
    const form = document.getElementById('form-reg');
    const honey = document.getElementById('reg-website');
    honey.value = 'http://spam.example';
    const ev = new Event('submit', { cancelable: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('honeypot bosh bolsa submit bloklanmaydi', async () => {
    await bootRegister();
    const form = document.getElementById('form-reg');
    const ev = new Event('submit', { cancelable: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
