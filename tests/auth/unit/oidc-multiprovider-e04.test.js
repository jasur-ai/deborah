/**
 * Deborah — E-04b: Multi-provider OIDC registry (oidc.js)
 * ---------------------------------------------------------------------------
 * `PROVIDERS` registry — Google default; `getProvider`/`listProviders` orqali
 * provider-agnostic kirish. Issuer provider'dan olinadi (A-24 §7 EXACT).
 */
import { describe, it, expect } from 'vitest';
import {
  getProvider,
  listProviders,
  generatePkceChallenge,
  getOidcStatus,
} from '../../../src/modules/auth/oidc.js';

describe('E-04b — multi-provider OIDC registry', () => {
  it('1) getProvider default — google mavjud', () => {
    const p = getProvider();
    expect(p).not.toBeNull();
    expect(p.authUrl).toContain('accounts.google.com');
    expect(p.issuer).toBe('https://accounts.google.com');
    expect(Array.isArray(p.scopes)).toBe(true);
  });

  it('2) getProvider("google") — clientId config dan keladi', () => {
    const p = getProvider('google');
    expect(p).not.toBeNull();
    expect(typeof p.clientId).toBe('string');
    expect(typeof p.clientSecret).toBe('string');
  });

  it('3) getProvider noma\'lum — null qaytaradi (fail-closed)', () => {
    expect(getProvider('microsoft')).toBeNull();
    expect(getProvider('nonexistent')).toBeNull();
  });

  it('4) listProviders — google ro\'yxatda', () => {
    const providers = listProviders();
    expect(providers).toContain('google');
    expect(Array.isArray(providers)).toBe(true);
  });

  it('5) PKCE — provider-agnostic (registry o\'zgarishi challenge\'ga ta\'sir qilmaydi)', () => {
    const { verifier, challenge, method } = generatePkceChallenge();
    expect(verifier).toBeTruthy();
    expect(challenge).toBeTruthy();
    expect(method).toBe('S256');
    expect(verifier).not.toBe(challenge);
  });

  it('6) getOidcStatus — enabled holati registry bilan izchil', () => {
    const s = getOidcStatus();
    expect(typeof s.enabled).toBe('boolean');
    expect(typeof s.hasClientId).toBe('boolean');
    expect(s.redirectUri !== undefined).toBe(true);
  });
});
