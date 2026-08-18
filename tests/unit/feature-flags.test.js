import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  FLAG_CONTEXTS, envName, resolveFlag, resolveFlags, sessionStableContexts, resolveFlagsForTest,
} from '../../utils/feature-flags.js';

const savedEnv = {};

describe('STEP 40 — Feature flags', () => {
  beforeEach(() => {
    for (const ctx of FLAG_CONTEXTS) {
      const k = envName(ctx);
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const ctx of FLAG_CONTEXTS) {
      const k = envName(ctx);
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    }
  });

  it('default: barcha kontekstlar ON', () => {
    expect(FLAG_CONTEXTS).toContain('theme');
    expect(FLAG_CONTEXTS).toContain('cast');
    expect(FLAG_CONTEXTS).toContain('admin');
    expect(resolveFlags({})).toEqual({
      theme: true, landing: true, auth: true, workspace: true, cast: true, admin: true,
    });
  });

  it('env orqali OFF qilish mumkin', () => {
    process.env.DEBORAH_FF_CAST = '0';
    expect(resolveFlag({}, 'cast')).toBe(false);
    expect(resolveFlag({}, 'theme')).toBe(true);
  });

  it('env orqali ON', () => {
    process.env.DEBORAH_FF_CAST = '1';
    expect(resolveFlag({}, 'cast')).toBe(true);
  });

  it('query override faqat non-production', () => {
    const origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    expect(resolveFlag({ query: { ff_cast: '0' } }, 'cast')).toBe(false);
    expect(resolveFlag({ query: { ff_cast: '1' } }, 'cast')).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(resolveFlag({ query: { ff_cast: '0' } }, 'cast')).toBe(true); // prod'da query ishlamaydi
    process.env.NODE_ENV = origNodeEnv;
  });

  it('cookie session-stable (env > cookie > default)', () => {
    // env yo'q, cookie OFF
    expect(resolveFlag({ headers: { cookie: 'deborah_ff_theme=0' } }, 'theme')).toBe(false);
    // env ON, cookie OFF — env ustun
    process.env.DEBORAH_FF_THEME = '1';
    expect(resolveFlag({ headers: { cookie: 'deborah_ff_theme=0' } }, 'theme')).toBe(true);
  });

  it('sessionStableContexts: theme va cast', () => {
    expect(sessionStableContexts()).toContain('theme');
    expect(sessionStableContexts()).toContain('cast');
  });

  it('resolveFlagsForTest: env-only', () => {
    process.env.DEBORAH_FF_ADMIN = '0';
    const f = resolveFlagsForTest(process.env);
    expect(f.admin).toBe(false);
    expect(f.theme).toBe(true);
  });

  it('noto\'g\'ri kontekst — default true', () => {
    expect(resolveFlag({}, 'nope')).toBe(true);
  });
});
