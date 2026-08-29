import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('AUTH A-23 — Email validation (unit)', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disposable (temp-mail) → hard blok', async () => {
    const { validateEmail } = await import('../../src/modules/email/validation.js');
    const r = await validateEmail('user@mailinator.com');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('disposable');
  });

  it('disposable subdomain variantlar ham bloklanadi', async () => {
    const { validateEmail } = await import('../../src/modules/email/validation.js');
    for (const email of ['a@10minutemail.com', 'b@temp-mail.org', 'c@guerrillamail.com', 'd@yopmail.com']) {
      const r = await validateEmail(email);
      expect(r.reason, email).toBe('disposable');
    }
  });

  it('syntax xato → syntax rad', async () => {
    const { validateEmail } = await import('../../src/modules/email/validation.js');
    expect((await validateEmail('not-an-email')).reason).toBe('syntax');
    expect((await validateEmail('a@b')).reason).toBe('syntax');
    expect((await validateEmail('')).reason).toBe('syntax');
  });

  it('MX tekshiruvi: checkMx mock orqali — ok bo`lsa o`tadi', async () => {
    const { validateEmail } = await import('../../src/modules/email/validation.js');
    const r = await validateEmail('user@deborah.uz', { checkMx: async () => true });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(true);
  });

  it('MX yo`q (mock false) → no-mx rad', async () => {
    const { validateEmail } = await import('../../src/modules/email/validation.js');
    const r = await validateEmail('user@nodomain.zz', { checkMx: async () => false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-mx');
  });

  it('test rejimida default checkMx DNS`ga chiqmaydi (fail-open)', async () => {
    const { checkMx } = await import('../../src/modules/email/validation.js');
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const ok = await checkMx('deborah.uz');
      expect(ok).toBe(true);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it('syntax tekshiruvi MX dan OLDIN (disposable tekshiruv ham)', async () => {
    const { validateEmail } = await import('../../src/modules/email/validation.js');
    const checkMx = vi.fn(async () => true);
    await validateEmail('bad-email', { checkMx });
    expect(checkMx).not.toHaveBeenCalled();
  });
});
