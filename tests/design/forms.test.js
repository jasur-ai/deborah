import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const ROOT = process.cwd();
const rd = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');

describe('STEP 13 — Input & form field components', () => {
  const inp = rd('public/design/components/input.css');
  const sel = rd('public/design/components/select.css');
  const form = rd('public/design/components/form.css');
  const login = rd('views/user/login.ejs');
  const authJs = rd('public/js/auth.js');
  const fieldPartial = rd('views/partials/components/form-field.ejs');

  describe('S13.01 — Form field anatomy', () => {
    it('label, hint, error, count anatomy mavjud', () => {
      expect(inp).toContain('.form-field__label');
      expect(inp).toContain('.form-field__hint');
      expect(inp).toContain('.form-field__error');
      expect(inp).toContain('.form-field__count');
    });

    it('form-field.ejs partial: label + required + optional', () => {
      expect(fieldPartial).toContain('form-field__label');
      expect(fieldPartial).toContain('required');
      expect(fieldPartial).toContain('optional');
      expect(fieldPartial).toContain('type === \'textarea\'');
      expect(fieldPartial).toContain('type === \'select\'');
    });
  });

  describe('S13.02 — placeholder label emas', () => {
    it('placeholder faqat format/example (view larida label bor)', () => {
      // Login view'ida label input'dan oldin keladi
      const usernameIdx = login.indexOf('for="login-username"');
      const inputIdx = login.indexOf('id="login-username"');
      expect(usernameIdx).toBeGreaterThan(-1);
      expect(inputIdx).toBeGreaterThan(usernameIdx);
    });
  });

  describe('S13.03 — control size', () => {
    it('44px desktop, 48px mobile, mobile font 16px', () => {
      expect(inp).toMatch(/min-height: 44px/);
      expect(inp).toMatch(/@media \(max-width: 640px\)[\s\S]*min-height: 48px/);
      expect(inp).toMatch(/font-size: var\(--deborah-typography-font-size-md, 16px\)/);
    });
  });

  describe('S13.04-05 — border + focus', () => {
    it('border token va focus ring layout-shift yoq', () => {
      expect(inp).toContain('--deborah-semantic-color-border-default');
      expect(inp).toContain('outline: 3px solid var(--deborah-semantic-color-focus');
      // Border doim 2px — focus'da border-width o'zgarmaydi (layout shift yoq)
      expect(inp).toMatch(/border: 2px solid/);
    });

    it('hover != focus vizual farqli', () => {
      expect(inp).toContain(':hover:not(:disabled):not(:focus)');
    });
  });

  describe('S13.06-07 — states', () => {
    it('error (danger), warning (amber) states', () => {
      expect(inp).toContain('aria-invalid');
      expect(inp).toContain('--deborah-semantic-color-status-danger');
      expect(inp).toContain('--deborah-semantic-color-status-warning');
    });

    it('read-only != disabled', () => {
      expect(inp).toContain(':read-only');
      expect(inp).toContain(':disabled');
      expect(inp).toContain('cursor: default'); // read-only
      expect(inp).toContain('cursor: not-allowed'); // disabled
    });
  });

  describe('S13.08 — HTML attributes', () => {
    it('login: autocomplete + inputmode + aria-required + aria-describedby', () => {
      expect(login).toContain('autocomplete="username"');
      expect(login).toContain('autocomplete="current-password"');
      expect(login).toContain('inputmode="text"');
      expect(login).toContain('aria-required="true"');
      expect(login).toContain('aria-describedby="err-username"');
    });
  });

  describe('S13.09 — server error saqlash', () => {
    it('prevUsername view da saqlanadi', () => {
      expect(login).toContain('prevUsername');
      // value attribute'da qayta ko rsatiladi
      expect(login).toMatch(/value="<%= mode === 'login' && typeof prevUsername/);
    });

    it('error summary CSS mavjud', () => {
      expect(form).toContain('.error-summary');
    });
  });

  describe('S13.10 — password show/hide + caps-lock', () => {
    it('pw-toggle mavjud (login + reg)', () => {
      expect(login).toContain('data-pw-toggle="login-password"');
      expect(login).toContain('data-pw-toggle="reg-password"');
      expect(login).toContain('aria-pressed="false"');
    });

    it('caps-hint element + auth.js getModifierState', () => {
      expect(login).toContain('caps-hint');
      expect(login).toContain('id="caps-hint-login"');
      expect(authJs).toContain('getModifierState');
      expect(authJs).toContain('initCapsLockHints');
    });
  });

  describe('S13.11 — native select', () => {
    it('form-select styled, appearance none, chevron', () => {
      expect(sel).toContain('.form-select');
      expect(sel).toContain('appearance: none');
      expect(sel).toContain('background-image');
      expect(sel).toMatch(/min-height: 44px/);
    });
  });

  describe('S13.12 — tolerance', () => {
    it('forced-colors + 200% zoom tolerant', () => {
      expect(form).toContain('forced-colors');
    });
  });

  describe('S12.10 davomi — login gradient qolmagan', () => {
    it('login btn-primary solid (gradient emas)', () => {
      expect(login).not.toMatch(/btn-primary\{background:linear-gradient/);
    });
  });
});
