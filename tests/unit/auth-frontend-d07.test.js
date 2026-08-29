/**
 * AUTH D-07 — Login frontend (public/js/auth.js) unit testlari
 * --------------------------------------------------------------
 * Haqiqiy auth.js kodini jsdom'da login sahifasi markup'iga yuklab,
 * UX invariantlarini tekshiradi:
 *   - parol show/hide toggle (aria-pressed + label)
 *   - inline error reveal (server xatosi → field-level) + D-07 clear-on-type
 *   - lockout countdown (birlashtirilgan: matn + vaqt + hint + submit blok)
 *   - lockout idempotent init (ikki timer raqobati yo'q)
 *   - submit lock (dublikat submit blok)
 *   - tab roving (aria-selected/tabindex + arrow keys)
 *   - window.DeborahAuth.csrfToken() helper
 *   - parol strength meter (zxcvbn fallback)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_JS = readFileSync(join(__dirname, '../../public/js/auth.js'), 'utf8');

const LOGIN_MARKUP = `
<!DOCTYPE html><html><body>
  <div id="auth-alert" class="msg" role="alert" aria-live="assertive" data-field=""></div>
  <div id="lockout-countdown" class="msg err" role="alert" aria-live="assertive"
       data-seconds="0" data-lockout="0" style="display:none">
    <div class="lockout-line"><span data-lockout-text></span> <strong data-lockout-time></strong></div>
    <div class="lockout-hint" data-lockout-hint></div>
  </div>
  <form id="form-login" class="auth-form is-active" action="/user/login" method="POST">
    <input type="hidden" name="_csrf" value="csrf-123">
    <label for="login-username">Login</label>
    <input class="inp" id="login-username" name="username" type="text" autocomplete="username"
           aria-invalid="false" data-inline-error="err-username">
    <div class="err-text" id="err-username" data-inline-error="login-username" style="display:none" role="alert"><span></span></div>
    <label for="login-password">Parol</label>
    <input class="inp" id="login-password" name="password" type="password" autocomplete="current-password"
           aria-invalid="false" data-inline-error="err-login-password">
    <button type="button" class="pw-toggle" data-pw-toggle="login-password"
            data-label-show="Ko'rsatish" data-label-hide="Yashirish" aria-pressed="false">
      <span data-pw-toggle-label>icon</span>
    </button>
    <div class="err-text" id="err-login-password" data-inline-error="login-password" style="display:none" role="alert"><span></span></div>
    <button type="submit" class="btn auth-submit"><span class="auth-spinner"></span>Kirish</button>
  </form>
  <form id="form-reg" class="auth-form" action="/user/login" method="POST">
    <input type="hidden" name="_csrf" value="csrf-reg">
    <button type="submit" class="btn auth-submit">Ro'yxatdan o'tish</button>
  </form>
  <div class="auth-tabs" role="tablist" aria-label="Kirish / Ro'yxat">
    <button type="button" class="auth-tab" role="tab" id="tab-login" aria-selected="true" tabindex="0">Kirish</button>
    <button type="button" class="auth-tab" role="tab" id="tab-reg" aria-selected="false" tabindex="-1">Ro'yxat</button>
  </div>
  <a href="/auth/google" data-google-btn>Google</a>
</body></html>
`;

/** auth.js ni login markup'iga yuklab, DOMContentLoaded o'tishini kutadi. */
async function build(html = LOGIN_MARKUP) {
  const dom = new JSDOM(html + '<script>' + AUTH_JS + '</script>', {
    runScripts: 'dangerously',
    url: 'http://localhost/user/login',
  });
  const w = dom.window;
  // jsdom lifecycle: DOMContentLoaded asinxron keladi
  await new Promise((r) => w.setTimeout(r, 15));
  return w;
}

describe('AUTH D-07 — auth.js (login frontend)', () => {
  it('parol toggle: type text <-> password, aria-pressed va label almashadi', async () => {
    const w = await build();
    const doc = w.document;
    const input = doc.getElementById('login-password');
    const btn = doc.querySelector('[data-pw-toggle="login-password"]');
    expect(input.type).toBe('password');

    btn.click();
    expect(input.type).toBe('text');
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    btn.click();
    expect(input.type).toBe('password');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('server xatosi → field-level inline error reveal (inp-error + aria-invalid + matn)', async () => {
    const html = LOGIN_MARKUP.replace(
      '<div id="auth-alert" class="msg" role="alert" aria-live="assertive" data-field=""></div>',
      '<div id="auth-alert" class="msg err" role="alert" aria-live="assertive" data-field="username">Login yoki parol xato</div>'
    );
    const w = await build(html);
    const doc = w.document;
    const input = doc.getElementById('login-username');
    const err = doc.getElementById('err-username');

    expect(input.classList.contains('inp-error')).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(err.style.display).toBe('flex');
    expect(err.querySelector('span').textContent).toContain('Login yoki parol xato');
  });

  it('D-07: inline xato yozish bilan tozalanadi (error → yechim)', async () => {
    const html = LOGIN_MARKUP.replace(
      '<div id="auth-alert" class="msg" role="alert" aria-live="assertive" data-field=""></div>',
      '<div id="auth-alert" class="msg err" role="alert" aria-live="assertive" data-field="username">Login yoki parol xato</div>'
    );
    const w = await build(html);
    const doc = w.document;
    const input = doc.getElementById('login-username');
    const err = doc.getElementById('err-username');

    input.value = 'a';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));

    expect(input.classList.contains('inp-error')).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(err.style.display).toBe('none');
  });

  it('lockout: submit bloklanadi, matn+vaqt+hint render, is-locked qo\'shiladi', async () => {
    const html = LOGIN_MARKUP.replace(
      '<div id="lockout-countdown" class="msg err" role="alert" aria-live="assertive"\n       data-seconds="0" data-lockout="0" style="display:none">',
      // EJS <%-= %> HTML-escape qiladi (' → &#39;) — browser dekodlab beradi,
      // shuning uchun test markup ham &#39; ishlatadi (production bilan bir xil)
      '<div id="lockout-countdown" class="msg err" role="alert" aria-live="assertive"\n       data-seconds="65" data-lockout="1" data-copy=\'{"locked":"Juda ko&#39;p urinish","support":"Yordam"}\'>'
    );
    const w = await build(html);
    const doc = w.document;
    const box = doc.getElementById('lockout-countdown');

    // barcha auth submit + inputlar bloklangan, form is-locked
    doc.querySelectorAll('.auth-submit').forEach((b) => expect(b.disabled).toBe(true));
    expect(doc.getElementById('login-username').disabled).toBe(true);
    doc.querySelectorAll('.auth-form').forEach((f) => expect(f.classList.contains('is-locked')).toBe(true));

    expect(box.querySelector('[data-lockout-text]').textContent).toContain('Juda ko\'p urinish');
    expect(box.querySelector('[data-lockout-time]').textContent).toBe('1:05');
    expect(box.querySelector('[data-lockout-hint]').textContent).toContain('Yordam');
  });

  it('lockout: vaqt tugagach qayta ochiladi va box yashirinadi', async () => {
    const html = LOGIN_MARKUP.replace(
      '<div id="lockout-countdown" class="msg err" role="alert" aria-live="assertive"\n       data-seconds="0" data-lockout="0" style="display:none">',
      '<div id="lockout-countdown" class="msg err" role="alert" aria-live="assertive"\n       data-seconds="1" data-lockout="1">'
    );
    const w = await build(html);
    const doc = w.document;

    expect(doc.querySelector('.auth-submit').disabled).toBe(true);
    // real timer: 1 soniya countdown → 1.3s kutamiz
    await new Promise((r) => w.setTimeout(r, 1400));
    doc.querySelectorAll('.auth-submit').forEach((b) => expect(b.disabled).toBe(false));
    expect(doc.getElementById('login-username').disabled).toBe(false);
    doc.querySelectorAll('.auth-form').forEach((f) => expect(f.classList.contains('is-locked')).toBe(false));
    expect(doc.getElementById('lockout-countdown').style.display).toBe('none');
  }, 10000);

  it('lockout: idempotent — qayta init ikki timer boshlamaydi', async () => {
    const html = LOGIN_MARKUP.replace(
      '<div id="lockout-countdown" class="msg err" role="alert" aria-live="assertive"\n       data-seconds="0" data-lockout="0" style="display:none">',
      '<div id="lockout-countdown" class="msg err" role="alert" aria-live="assertive"\n       data-seconds="65" data-lockout="1" data-copy=\'{"locked":"Blok"}\'>'
    );
    const w = await build(html);
    const doc = w.document;
    const box = doc.getElementById('lockout-countdown');
    expect(box.getAttribute('data-countdown-started')).toBe('1');

    // DOMContentLoaded'ni qayta chaqirish (masalan SPA re-init) — qayta start yo'q
    doc.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
    expect(box.getAttribute('data-countdown-started')).toBe('1');
    expect(box.querySelector('[data-lockout-time]').textContent).toBe('1:05');
  });

  it('submit lock: birinchi submit pending, ikkinchisi bloklanadi', async () => {
    const w = await build();
    const doc = w.document;
    const form = doc.getElementById('form-login');
    const btn = form.querySelector('.auth-submit');

    const ev1 = new w.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(ev1);
    expect(form.dataset.submitting).toBe('1');
    expect(btn.classList.contains('is-pending')).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');

    const ev2 = new w.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(true);
  });

  it('tablar: roving tabindex + arrow key fokus', async () => {
    const w = await build();
    const doc = w.document;
    const loginTab = doc.getElementById('tab-login');
    const regTab = doc.getElementById('tab-reg');

    regTab.click();
    expect(regTab.getAttribute('aria-selected')).toBe('true');
    expect(regTab.tabIndex).toBe(0);
    expect(loginTab.getAttribute('aria-selected')).toBe('false');
    expect(loginTab.tabIndex).toBe(-1);
    expect(doc.getElementById('form-reg').classList.contains('is-active')).toBe(true);

    // ArrowRight → login tab tanlanadi va fokuslanadi
    regTab.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(loginTab.getAttribute('aria-selected')).toBe('true');
    expect(doc.activeElement).toBe(loginTab);
  });

  it('DeborahAuth.csrfToken() — hidden _csrf qiymatini qaytaradi', async () => {
    const w = await build();
    expect(w.DeborahAuth.csrfToken()).toBe('csrf-123');
  });

  it('Google tugmasi: bosishda is-pending + aria-busy', async () => {
    const w = await build();
    const btn = w.document.querySelector('[data-google-btn]');
    btn.click();
    expect(btn.classList.contains('is-pending')).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('strength meter: kuchli parol → ball 4 (label) + bar 100%', async () => {
    const html = `
      <input id="reg-password" type="password" value="">
      <div class="strength-bar"><div id="pw-strength-bar"></div></div>
      <span id="pw-strength-hint" data-labels='["juda zaif","zaif","o&#39;rta","kuchli","juda kuchli"]'></span>
    `;
    const w = await build(html);
    const doc = w.document;
    const input = doc.getElementById('reg-password');
    input.value = 'Abcdefgh1!xyzabcde'; // 18: harf + raqam + maxsus
    input.dispatchEvent(new w.Event('input', { bubbles: true }));

    expect(doc.getElementById('pw-strength-hint').textContent).toBe('juda kuchli');
    expect(doc.getElementById('pw-strength-bar').style.width).toBe('100%');
  });
});
