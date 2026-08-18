/**
 * Edikit — AUTH B-03 Register forma — Unit tests
 * ----------------------------------------------
 * parseRegister'ning B-03 yangi maydonlari: name (ishm) + invite kod.
 */
import { describe, it, expect } from 'vitest';
import { parseRegister } from '../../src/modules/auth/validation.js';

const BASE = {
  username: 'b03user',
  email: 'b03@test.uz',
  password: 'parol-2026-x-uzun',
  consent: true, // AUTH D-24 §10: qonuniy rozilik majburiy
};

describe('AUTH B-03 — parseRegister name/invite', () => {
  it('name qisqa (1 belgi) → nameShort', () => {
    const r = parseRegister({ ...BASE, name: 'A' });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('nameShort');
  });

  it('name uzun (>100) → nameLong', () => {
    const r = parseRegister({ ...BASE, name: 'A'.repeat(101) });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('nameLong');
  });

  it('name trim + max 100 → muvaffaqiyatli', () => {
    const r = parseRegister({ ...BASE, name: '  Aziza Karimova  ' });
    expect(r.ok).toBe(true);
    expect(r.name).toBe('Aziza Karimova');
  });

  it('name berilmagan → name empty (optional)', () => {
    const r = parseRegister(BASE);
    expect(r.ok).toBe(true);
    expect(r.name).toBe('');
  });

  it('invite noto\'g\'ri belgilar → inviteInvalid', () => {
    const r = parseRegister({ ...BASE, invite: 'bad<code>!' });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('inviteInvalid');
  });

  it('invite qisqa (<6) → inviteInvalid', () => {
    const r = parseRegister({ ...BASE, invite: 'ab' });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('inviteInvalid');
  });

  it('invite to\'g\'ri format ([A-Za-z0-9-]{6,48}) → qabul', () => {
    const r = parseRegister({ ...BASE, invite: 'INV-2026-EDIKIT' });
    expect(r.ok).toBe(true);
    expect(r.invite).toBe('INV-2026-EDIKIT');
  });

  it('invite bo\'sh → invite undefined', () => {
    const r = parseRegister({ ...BASE, invite: '' });
    expect(r.ok).toBe(true);
    expect(r.invite).toBeUndefined();
  });
});
