/**
 * Edikit — AUTH B-05 Email validatsiya (typo + fast/full) — Unit tests
 * ---------------------------------------------------------------------
 *  - suggestDomainFix: ma'lum typo xarita + Levenshtein 1 (faqat ishonchli)
 *  - validateFast: syntax/disposable/MX/suggestion
 *  - validateFull: SMTP probe (fail-open, test'da tarmoqqa chiqmaydi)
 */
import { describe, it, expect } from 'vitest';
import {
  suggestDomainFix,
  validateFast,
  validateFull,
  smtpProbe,
  interpretSmtpReply,
  _emailCacheResetForTests,
} from '../../src/modules/email/validation.js';

describe('AUTH B-05 — suggestDomainFix', () => {
  it('ma\'lum typo: gmial→gmail, hotmial→hotmail, yaho→yahoo', () => {
    expect(suggestDomainFix('gmial.com')).toBe('gmail.com');
    expect(suggestDomainFix('hotmial.com')).toBe('hotmail.com');
    expect(suggestDomainFix('yaho.com')).toBe('yahoo.com');
    expect(suggestDomainFix('outlok.com')).toBe('outlook.com');
  });

  it('Levenshtein masofa 1 bo\'lsa ham taklif qiladi', () => {
    expect(suggestDomainFix('gmiall.com')).toBe('gmail.com'); // typo map
    expect(suggestDomainFix('gmil.com')).toBe('gmail.com');   // typo map
  });

  it('to\'g\'ri domen yoki noma\'lum domen → null (shovqin yo\'q)', () => {
    expect(suggestDomainFix('gmail.com')).toBeNull(); // to'g'ri — taklif kerak emas
    expect(suggestDomainFix('example.org')).toBeNull(); // noma'lum — chalg'itmaydi
    expect(suggestDomainFix('')).toBeNull();
    expect(suggestDomainFix(null)).toBeNull();
  });

  it('distanse 2+ bo\'lsa taklif qilmaydi (ishonchli emas)', () => {
    // 'gmaiix.com' → gmail.com dan 2 farq — taklif chiqmasligi kerak
    expect(suggestDomainFix('gmaiix.com')).toBeNull();
  });
});

describe('AUTH B-05 — validateFast', () => {
  beforeEach(() => _emailCacheResetForTests());

  it('valid email → ok + suggestion (injected)', async () => {
    const r = await validateFast('user@gmial.com', { checkMx: async () => true });
    expect(r.ok).toBe(true);
    expect(r.suggestion).toBe('gmail.com');
  });

  it('disposable → hard blok, suggestion yo\'q', async () => {
    const r = await validateFast('user@mailinator.com', { checkMx: async () => true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('disposable');
    expect(r.suggestion).toBeNull();
  });

  it('syntax xato → syntax', async () => {
    const r = await validateFast('not-an-email');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('syntax');
  });

  it('MX yo\'q → no-mx (injected checkMx false)', async () => {
    const r = await validateFast('user@nodomain.zzz', { checkMx: async () => false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-mx');
  });

  it('suggest injeksiyasi ishlaydi (override)', async () => {
    const r = await validateFast('user@example.org', {
      checkMx: async () => true,
      suggest: () => 'example.com',
    });
    expect(r.ok).toBe(true);
    expect(r.suggestion).toBe('example.com');
  });
});

describe('AUTH B-05 — interpretSmtpReply (SMTP javob kodlari)', () => {
  it('250 → exists', () => {
    expect(interpretSmtpReply(250)).toEqual({ mailbox: 'exists' });
  });

  it('550/551/553/554 → missing (mailbox yo\'q)', () => {
    for (const code of [550, 551, 553, 554]) {
      expect(interpretSmtpReply(code).mailbox).toBe('missing');
    }
  });

  it('451 (greylisting) → bir marta retry; ikkinchi marta unknown', () => {
    expect(interpretSmtpReply(451)).toEqual({ retry: true });
    expect(interpretSmtpReply(451, { greylisted: true }).mailbox).toBe('unknown');
  });

  it('boshqa kodlar → unknown (fail-open)', () => {
    expect(interpretSmtpReply(421).mailbox).toBe('unknown');
    expect(interpretSmtpReply(503).mailbox).toBe('unknown');
  });
});

describe('AUTH B-05 — validateFull / smtpProbe', () => {
  it('test rejimida smtpProbe tarmoqqa chiqmaydi (fail-open)', async () => {
    const r = await smtpProbe('gmail.com');
    expect(r.mailbox).toBe('unknown');
  });

  it('smtpProbe injected dialog natijasini qaytaradi (missing)', async () => {
    const r = await smtpProbe('example.org', {
      resolveMx: async () => [{ exchange: 'mx.example.org' }],
      dialog: async () => ({ mailbox: 'missing', code: 550 }),
    });
    expect(r.mailbox).toBe('missing');
    expect(r.code).toBe(550);
  });

  it('smtpProbe injected dialog — exists', async () => {
    const r = await smtpProbe('example.org', {
      resolveMx: async () => [{ exchange: 'mx.example.org' }],
      dialog: async () => ({ mailbox: 'exists', code: 250 }),
    });
    expect(r.mailbox).toBe('exists');
  });

  it('injected probe natijasini qaytaradi (missing → flag uchun)', async () => {
    const r = await validateFull('user@example.org', {
      probe: async () => ({ mailbox: 'missing' }),
    });
    expect(r.ok).toBe(true);
    expect(r.mailbox).toBe('missing');
  });

  it('probe xatosi → fail-open unknown', async () => {
    const r = await validateFull('user@example.org', {
      probe: async () => { throw new Error('boom'); },
    });
    expect(r.ok).toBe(true);
    expect(r.mailbox).toBe('unknown');
  });

  it('syntax xato email → fail-open (validatsiya buzmaydi)', async () => {
    const r = await validateFull('not-an-email');
    expect(r.ok).toBe(true);
    expect(r.mailbox).toBe('unknown');
  });
});
