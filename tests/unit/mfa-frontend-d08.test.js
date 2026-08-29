/**
 * Deborah — D-08 MFA login step (public/js/mfa.js) — Unit tests
 * --------------------------------------------------------------
 * jsdom environment'da mfa.js DOM logikasini tekshiramiz:
 *   - single-digit 6 input: avto-next, backspace, arrow keys
 *   - paste → to'liq kod tarqatiladi
 *   - backup toggle ("boshqa usul") → backup input, qaytish
 *   - submit: to'liq kod → POST /api/mfa/verify (CSRF header)
 *   - invalid code → inline error; locked → lock box + input blok
 *   - resend → POST /api/mfa/resend + challenge yangilanadi + countdown
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const HTML = `
<form id="mfa-form" data-challenge-id="ch-abc123" data-code-short="Kodni to'liq kiriting"
      data-invalid-code="Kod noto'g'ri. Qayta urinib ko'ring."
      data-network="Server bilan bog'lanishda xatolik."
      data-locked-tpl="Juda ko'p urinish — __m__ daqiqadan so'ng qayta urining">
  <input type="hidden" name="_csrf" value="csrf-1">
  <div class="digits" id="mfa-digits">
    <input class="digit" data-digit type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code">
    <input class="digit" data-digit type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code">
    <input class="digit" data-digit type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code">
    <input class="digit" data-digit type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code">
    <input class="digit" data-digit type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code">
    <input class="digit" data-digit type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code">
  </div>
  <input class="code-inp" id="mfa-backup-input" inputmode="numeric" maxlength="10" hidden disabled>
  <button type="submit" id="mfa-submit">Tasdiqlash</button>
  <div class="err" id="mfa-error" role="alert" hidden></div>
  <div class="err" id="mfa-locked" role="alert" hidden></div>
</form>
<button type="button" id="mfa-use-backup">Boshqa usul: backup kod</button>
<button type="button" id="mfa-use-totp" hidden>Kodni kiriting</button>
<button type="button" id="mfa-resend" data-resend-label="Kodni qayta olish" data-resend-tpl="Qayta yuborish __s__ soniyadan keyin">Kodni qayta olish</button>
`;

let fetchMock;

beforeEach(() => {
  document.body.innerHTML = HTML;
  window.__CSRF_TOKEN = 'csrf-1';
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ok: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function bootMfa() {
  await import('../../public/js/mfa.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

function digits() {
  return Array.from(document.querySelectorAll('input[data-digit]'));
}

function fillCode(code) {
  const d = digits();
  code.split('').forEach((ch, i) => {
    d[i].value = ch;
    d[i].dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** fetch zanjiri (json().then) to'liq ishlashi uchun mikro-task'larni kutyapti. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('D-08 — single-digit input (6 xonali TOTP)', () => {
  it('6 ta single-digit input render', async () => {
    await bootMfa();
    expect(digits().length).toBe(6);
    expect(digits()[0].getAttribute('autocomplete')).toBe('one-time-code');
  });

  it('raqam kiritsa avto-next (fokus keyingisiga o\'tadi)', async () => {
    await bootMfa();
    const d = digits();
    d[0].focus();
    d[0].value = '1';
    d[0].dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.activeElement).toBe(d[1]);
  });

  it('backspace bo\'sh inputda avvalgisiga qaytadi', async () => {
    await bootMfa();
    const d = digits();
    d[1].focus();
    d[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(document.activeElement).toBe(d[0]);
  });

  it('arrow keys navigatsiya', async () => {
    await bootMfa();
    const d = digits();
    d[2].focus();
    d[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(d[3]);
    d[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(d[2]);
  });

  it('paste → to\'liq kod tarqatiladi', async () => {
    await bootMfa();
    const d = digits();
    const pasteEv = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEv, 'clipboardData', { value: { getData: () => '123456' } });
    d[0].dispatchEvent(pasteEv);
    expect(d.map((el) => el.value).join('')).toBe('123456');
  });

  it('raqam bo\'lmagan belgilar filtrlanadi', async () => {
    await bootMfa();
    const d = digits();
    const pasteEv = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEv, 'clipboardData', { value: { getData: () => '12a-45 6' } });
    d[0].dispatchEvent(pasteEv);
    expect(d.map((el) => el.value).join('')).toBe('12456');
  });
});

describe('D-08 — submit → /api/mfa/verify', () => {
  it('to\'liq kod → POST verify (CSRF header bilan)', async () => {
    await bootMfa();
    fillCode('123456');
    document.getElementById('mfa-submit').click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/mfa/verify');
    expect(opts.headers['X-CSRF-Token']).toBe('csrf-1');
    expect(JSON.parse(opts.body).code).toBe('123456');
    expect(JSON.parse(opts.body).challengeId).toBe('ch-abc123');
  });

  it('to\'liq bo\'lmagan kod → xato ko\'rsatiladi, fetch chaqirilmaydi', async () => {
    await bootMfa();
    fillCode('123');
    document.getElementById('mfa-submit').click();
    expect(fetchMock).not.toHaveBeenCalled();
    const err = document.getElementById('mfa-error');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('to\'liq');
  });

  it('invalid code → inline error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ ok: false, error: 'invalid_code' }),
    });
    await bootMfa();
    fillCode('000000');
    document.getElementById('mfa-submit').click();
    await flush();
    const err = document.getElementById('mfa-error');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('noto\'g\'ri');
  });

  it('locked (429) → lock box + inputlar bloklanadi', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ ok: false, error: 'locked', retryAfterSeconds: 900 }),
    });
    await bootMfa();
    fillCode('123456');
    document.getElementById('mfa-submit').click();
    await flush();
    const lock = document.getElementById('mfa-locked');
    expect(lock.hidden).toBe(false);
    expect(lock.textContent).toContain('15');
    digits().forEach((d) => expect(d.disabled).toBe(true));
  });
});

describe('D-08 — backup toggle va resend', () => {
  it('backup toggle → backup input ochiladi, digits yashirinadi; qaytish → digits', async () => {
    await bootMfa();
    document.getElementById('mfa-use-backup').click();
    const backup = document.getElementById('mfa-backup-input');
    expect(backup.hidden).toBe(false);
    expect(backup.disabled).toBe(false);
    digits().forEach((d) => expect(d.hidden).toBe(true));
    expect(document.getElementById('mfa-use-totp').hidden).toBe(false);

    document.getElementById('mfa-use-totp').click();
    expect(backup.hidden).toBe(true);
    expect(document.getElementById('mfa-use-backup').hidden).toBe(false);
    digits().forEach((d) => expect(d.hidden).toBe(false));
  });

  it('backup kod submit → verify body code = backup input qiymati', async () => {
    await bootMfa();
    document.getElementById('mfa-use-backup').click();
    document.getElementById('mfa-backup-input').value = 'backup1234';
    document.getElementById('mfa-submit').click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).code).toBe('backup1234');
  });

  it('resend → POST /api/mfa/resend + challenge yangilanadi + countdown', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, challengeId: 'ch-new-999' }),
    });
    await bootMfa();
    const btn = document.getElementById('mfa-resend');
    btn.click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/mfa/resend');
    expect(JSON.parse(opts.body).challengeId).toBe('ch-abc123');
    // challenge form'da yangilandi
    expect(document.getElementById('mfa-form').getAttribute('data-challenge-id')).toBe('ch-new-999');
    // countdown ishlayapti (tugma disabled + vaqt matni)
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('60');
    await vi.advanceTimersByTimeAsync(61000);
    expect(btn.disabled).toBe(false);
  });
});
