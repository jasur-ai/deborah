/**
 * AUTH D-08 — Passkey frontend unit testlari (wsl qismi)
 * --------------------------------------------------------
 *  1. i18n (data/auth-i18n.js): passkeySettings bloki 4 tilda, barcha kalitlar
 *     (D-08 §15 — settings i18n; oldin hardcoded Uzbek edi).
 *  2. public/js/passkey-settings.js (jsdom):
 *     - copy parse (data-copy) → renderList empty / ro'yxat / loadFail
 *     - remove tugmasi aria-label + min-height:44px (A11y §13)
 *     - PublicKeyCredential yo'q bo'lsa — xavfsiz chiqish
 *  3. public/js/passkey-login.js: copy fallback (data-copy bo'lmasa default).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AUTH_COPY } from '../../data/auth-i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_JS = readFileSync(join(__dirname, '../../public/js/passkey-settings.js'), 'utf8');
const LOGIN_JS = readFileSync(join(__dirname, '../../public/js/passkey-login.js'), 'utf8');

const SETTINGS_MARKUP = (copyAttr) => `
<!DOCTYPE html><html><body>
<div class="mfa-card" id="passkey-card" data-copy='${copyAttr}'>
  <div id="passkey-list"><div class="loading">x</div></div>
  <button id="passkey-add-btn" type="button">Add</button>
  <div id="passkey-err" role="alert"></div>
  <div id="passkey-reauth" style="display:none">
    <input id="passkey-reauth-pw" type="password">
    <button id="passkey-reauth-btn" type="button">T</button>
    <div id="passkey-reauth-err" role="alert"></div>
  </div>
</div>
</body></html>`;

const COPY = {
  empty: "Hozircha passkey qoshilmagan",
  remove: 'Ochirish',
  device: 'Qurilma',
  sync: 'Sync',
  lastUsed: 'Oxirgi kirish',
  loadFail: 'Yuklab bolmadi',
};

/** data-copy attribute'idagi apostrof'lar HTML entity bo'lishi kerak (real EJS). */
function escAttr(v) {
  return JSON.stringify(v).replace(/'/g, '&#39;');
}

async function buildSettings({ passkeys = [], ok = true, withCred = true } = {}) {
  const fetchStub =
    'window.fetch = async () => ({ json: async () => ({ ok: ' + ok + ', passkeys: ' +
    JSON.stringify(passkeys) + ', max: 25 }) });';
  const credStub = withCred
    ? 'window.PublicKeyCredential = { isConditionalMediationAvailable: async () => false, isUserVerifyingPlatformAuthenticatorAvailable: async () => true };'
    : '';
  const dom = new JSDOM(
    SETTINGS_MARKUP(escAttr(COPY)) +
      '<script>' + fetchStub + credStub + '</script>' +
      '<script>' + SETTINGS_JS + '</script>',
    { runScripts: 'dangerously', url: 'http://localhost/user/security-profile' }
  );
  const w = dom.window;
  await new Promise((r) => w.setTimeout(r, 20));
  return w;
}

const REQUIRED_KEYS = [
  'title', 'desc', 'empty', 'add', 'remove', 'lastUsed', 'device', 'sync',
  'reauthTitle', 'reauthPlaceholder', 'reauthSubmit', 'reauthRequired',
  'reauthRate', 'reauthWrong', 'loadFail', 'addFail', 'removeFail',
  'startFail', 'verifyFail', 'recoveryNote',
];

describe('AUTH D-08 — passkeySettings i18n (4 til)', () => {
  it('uz / uz-cyrl / ru / en — passkeySettings bloki bor, 20 kalit, bo\'sh emas', () => {
    for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
      const ps = AUTH_COPY[lang] && AUTH_COPY[lang].passkeySettings;
      expect(ps, `${lang}.passkeySettings mavjud emas`).toBeTruthy();
      expect(Object.keys(ps).length).toBeGreaterThanOrEqual(REQUIRED_KEYS.length);
      for (const k of REQUIRED_KEYS) {
        expect(ps[k], `${lang}.passkeySettings.${k}`).toBeTruthy();
      }
    }
  });

  it('passkeySettings.login bilan kesishmaydi (login bloki o\'z kalitlarida)', () => {
    // D-08: login bloki (passkey/passkeyError/passkeyRate) — settings bloki alohida
    expect(AUTH_COPY.uz.login.passkey).toBeTruthy();
    expect(AUTH_COPY.uz.passkeySettings.title).not.toBe(AUTH_COPY.uz.login.passkey);
  });
});

describe('AUTH D-08 — passkey-settings.js (jsdom)', () => {
  it("bo'sh ro'yxat → copy.empty matni render qilinadi", async () => {
    const w = await buildSettings({ passkeys: [] });
    expect(w.document.getElementById('passkey-list').textContent).toContain(COPY.empty);
  });

  it("ro'yxat → deviceName + sync chip + remove tugmasi (aria-label, min-height:44px)", async () => {
    const w = await buildSettings({
      passkeys: [{ id: 'cred1', deviceName: 'iPhone 15', backedUp: true, lastUsedAt: Date.now() }],
    });
    const list = w.document.getElementById('passkey-list');
    expect(list.textContent).toContain('iPhone 15');
    expect(list.textContent).toContain(COPY.sync);
    expect(list.textContent).toContain(COPY.lastUsed);
    const btn = list.querySelector('[data-remove="cred1"]');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe(COPY.remove + ': iPhone 15');
    expect(btn.textContent.trim()).toBe(COPY.remove);
    expect(btn.style.minHeight).toContain('44px');
  });

  it('loadFail: server xato → copy.loadFail ko\'rsatiladi', async () => {
    const w = await buildSettings({ ok: false });
    expect(w.document.getElementById('passkey-list').textContent).toContain(COPY.loadFail);
  });

  it("PublicKeyCredential yo'q bo'lsa — xavfsiz chiqish (xato ko'tarmaydi)", async () => {
    const w = await buildSettings({ withCred: false });
    expect(w.document.getElementById('passkey-list')).toBeTruthy();
    // Script return qilgan — list loading holatda qoladi
    expect(w.document.getElementById('passkey-list').querySelector('.loading')).toBeTruthy();
  });
});

describe('AUTH D-08 — passkey-login.js copy fallback', () => {
  it("data-copy bo'lmasa ham default xabarlar ishlaydi (xato yo'q)", async () => {
    const dom = new JSDOM(
      '<div id="passkey-login" data-copy="{}"><button id="passkey-login-btn" type="button">B</button>' +
        '<p id="passkey-login-hint"></p></div>' +
        '<script>window.PublicKeyCredential = { isConditionalMediationAvailable: async () => false, isUserVerifyingPlatformAuthenticatorAvailable: async () => false };</script>' +
        '<script>' + LOGIN_JS + '</script>',
      { runScripts: 'dangerously', url: 'http://localhost/user/login' }
    );
    const w = dom.window;
    await new Promise((r) => w.setTimeout(r, 20));
    const btn = w.document.getElementById('passkey-login-btn');
    expect(btn).toBeTruthy();
    btn.click();
    await new Promise((r) => w.setTimeout(r, 30));
    // fetch yo'q (jsdom) → catch → copy.error fallback
    expect(w.document.getElementById('passkey-login-hint').textContent).toContain('Kirishda xatolik');
  });
});
