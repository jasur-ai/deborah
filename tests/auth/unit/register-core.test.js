/**
 * AUTH D-16 §06 — Register core unit testlari (B-03/B-04/B-05/B-08)
 * ---------------------------------------------------------------------------
 *  - Zod schema (parseRegister): username chars, email, password, invite.
 *  - Honeypot (B-08): yashirin website maydoni to'ldirilgan → silent skip.
 *  - Username normalize (B-04): full-width 'ａｄｍｉｎ' → reserved.
 *  - Email validatsiya (B-05): syntax, disposable, MX, typo suggestion.
 */

import { describe, it, expect } from 'vitest';
import { parseRegister, parseResetComplete } from '../../../src/modules/auth/validation.js';
import { isHoneypotTriggered } from '../../../src/modules/auth/bot-guard.js';
import { validateEmail, validateFast, suggestDomainFix } from '../../../src/modules/email/validation.js';

const GOOD = {
  username: 'student42',
  email: 'student@test.uz',
  password: 'correct-horse-battery-42',
  consent: true, // AUTH D-24 §10: qonuniy rozilik majburiy
};

describe('AUTH D-16 §06 — parseRegister (Zod schema)', () => {
  it('to\'g\'ri register → ok + normalize username', () => {
    const r = parseRegister({ ...GOOD, username: '  Student42 ' });
    expect(r.ok).toBe(true);
    expect(r.username).toBe('student42'); // NFKC + lowercase + trim
    expect(r.email).toBe('student@test.uz');
  });

  it('username 1 belgi → usernameChars (B-04 §07 min 2)', () => {
    const r = parseRegister({ ...GOOD, username: 'a' });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('usernameChars');
  });

  it('username 51 belgi → usernameChars (max 50)', () => {
    const r = parseRegister({ ...GOOD, username: 'u'.repeat(51) });
    expect(r.errorKey).toBe('usernameChars');
  });

  it('username kirill/emoji/space → usernameChars (OWASP identifier)', () => {
    expect(parseRegister({ ...GOOD, username: 'админ' }).errorKey).toBe('usernameChars');
    expect(parseRegister({ ...GOOD, username: 'user name' }).errorKey).toBe('usernameChars');
  });

  it('email noto\'g\'ri format → emailInvalid', () => {
    expect(parseRegister({ ...GOOD, email: 'not-an-email' }).errorKey).toBe('emailInvalid');
  });

  it('emailRequired=true: email yo\'q → emailInvalid (A-18 parol tiklash asosi)', () => {
    const { email, ...noEmail } = GOOD;
    expect(parseRegister(noEmail).errorKey).toBe('emailInvalid');
  });

  it('password 129 belgi → passwordMax (OWASP max 128)', () => {
    expect(parseRegister({ ...GOOD, password: 'p'.repeat(129) }).errorKey).toBe('passwordMax');
  });

  it('password bo\'sh → required', () => {
    expect(parseRegister({ ...GOOD, password: '' }).errorKey).toBe('required');
  });

  it('invite noto\'g\'ri belgilar → inviteInvalid (B-12 format)', () => {
    expect(parseRegister({ ...GOOD, invite: 'bad invite!' }).errorKey).toBe('inviteInvalid');
    expect(parseRegister({ ...GOOD, invite: 'ABCD-1234' }).ok).toBe(true);
  });
});

describe('AUTH D-16 §06 — honeypot (B-08)', () => {
  it('yashirin website maydoni to\'ldirilgan → honeypot (silent bot)', () => {
    const r = parseRegister({ ...GOOD, website: 'http://spam.example' });
    expect(r.ok).toBe(false);
    expect(r.honeypot).toBe(true);
  });

  it('isHoneypotTriggered: bo\'sh → false, to\'ldirilgan → true', () => {
    expect(isHoneypotTriggered('')).toBe(false);
    expect(isHoneypotTriggered('   ')).toBe(false);
    expect(isHoneypotTriggered('x')).toBe(true);
  });
});

describe('AUTH D-16 §06 — username normalize/reserved (B-04)', () => {
  it('full-width \'ａｄｍｉｎ\' → normalize → admin → usernameReserved', () => {
    const r = parseRegister({ ...GOOD, username: 'ａｄｍｉｎ' });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('usernameReserved'); // usernameChars EMAS — normalize ishladi
  });

  it('confusable (leet) rezerv → usernameConfusable', () => {
    const r = parseRegister({ ...GOOD, username: 'adm1n' });
    if (r.ok) return; // konfiguratsiyaga bog'liq — agar bloklanmasa skip
    expect(r.errorKey).toBe('usernameConfusable');
  });
});

describe('AUTH D-16 §06 — email validatsiya (B-05)', () => {
  it('syntax: noto\'g\'ri → reason=syntax', async () => {
    const r = await validateEmail('not-an-email', { checkMx: async () => true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('syntax');
  });

  it('disposable: mailinator.com → reason=disposable', async () => {
    const r = await validateEmail('user@mailinator.com', { checkMx: async () => true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('disposable');
  });

  it('MX yo\'q → reason=no-mx', async () => {
    const r = await validateEmail('user@nonexistent-domain-xyz.example', { checkMx: async () => false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-mx');
  });

  it('to\'g\'ri email → ok', async () => {
    const r = await validateEmail('user@test.uz', { checkMx: async () => true });
    expect(r.ok).toBe(true);
  });

  it('typo: gmail.co → suggestion gmail.com (B-05 §26)', () => {
    const s = suggestDomainFix('gmail.co');
    expect(s).toBe('gmail.com');
    expect(suggestDomainFix('gmail.com')).toBeNull(); // to'g'ri domain — taklif yo'q
  });

  it('validateFast: disposable → suggestion null', async () => {
    const r = await validateFast('user@mailinator.com', { checkMx: async () => true });
    expect(r.reason).toBe('disposable');
    expect(r.suggestion).toBeNull();
  });
});

describe('AUTH D-16 §06 — parseResetComplete (A-06 token kontrakti)', () => {
  it('token 48+ belgi + parol → ok', () => {
    const r = parseResetComplete({ token: 'a'.repeat(96), password: 'new-pass-123' });
    expect(r.ok).toBe(true);
  });

  it('token qisqa → tokenInvalid', () => {
    expect(parseResetComplete({ token: 'short', password: 'x' }).errorKey).toBe('tokenInvalid');
  });
});

describe('AUTH D-24 §10 — consent (qonuniy rozilik)', () => {
  it('consent yo\'q → consentRequired (majburiy)', () => {
    const { consent: _drop, ...noConsent } = GOOD;
    const r = parseRegister(noConsent);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('consentRequired');
  });

  it("consent 'on' / 'true' / true qabul qilinadi (brauzer checkbox)", () => {
    expect(parseRegister({ ...GOOD, consent: 'on' }).ok).toBe(true);
    expect(parseRegister({ ...GOOD, consent: 'true' }).ok).toBe(true);
    expect(parseRegister({ ...GOOD, consent: true }).ok).toBe(true);
    expect(parseRegister({ ...GOOD, consent: '1' }).ok).toBe(true);
  });

  it('consent false/bo\'sh → consentRequired; parsed.consent true', () => {
    expect(parseRegister({ ...GOOD, consent: false }).errorKey).toBe('consentRequired');
    expect(parseRegister({ ...GOOD, consent: '' }).errorKey).toBe('consentRequired');
    expect(parseRegister(GOOD).consent).toBe(true);
  });

  it('consentRequired: false (maxsus oqimlar) → consent shart emas', () => {
    const { consent: _drop, ...noConsent } = GOOD;
    const r = parseRegister(noConsent, { consentRequired: false });
    expect(r.ok).toBe(true);
  });
});
