import { describe, it, expect } from 'vitest';
import {
  isAbsoluteExpired,
  shouldRotateSession,
  isReauthFresh,
} from '../../src/modules/auth/session-timeout.js';

const HOUR = 60 * 60 * 1000;

describe('AUTH A-25 — absolute timeout / rotation / reauth', () => {
  it('isAbsoluteExpired: 12 soatdan oshgan sessiya — expired', () => {
    const now = Date.now();
    expect(isAbsoluteExpired(now - 13 * HOUR, now)).toBe(true);
    expect(isAbsoluteExpired(now - 11 * HOUR, now)).toBe(false);
    expect(isAbsoluteExpired(now - 30 * 1000, now)).toBe(false);
  });

  it('isAbsoluteExpired: startedAt yoq — fail-open (expired emas)', () => {
    expect(isAbsoluteExpired(undefined)).toBe(false);
    expect(isAbsoluteExpired(null)).toBe(false);
    expect(isAbsoluteExpired('nope')).toBe(false);
  });

  it('isAbsoluteExpired: custom absoluteMs', () => {
    const now = Date.now();
    expect(isAbsoluteExpired(now - 2 * HOUR, now, 1 * HOUR)).toBe(true);
    expect(isAbsoluteExpired(now - 2 * HOUR, now, 3 * HOUR)).toBe(false);
  });

  it('shouldRotateSession: 30 daqiqadan keyin rotation kerak', () => {
    const now = Date.now();
    expect(shouldRotateSession(now - 31 * 60 * 1000, now)).toBe(true);
    expect(shouldRotateSession(now - 5 * 60 * 1000, now)).toBe(false);
    // hali aylantirilmagan sessiya — birinchi imkoniyatda aylantiriladi
    expect(shouldRotateSession(undefined, now)).toBe(true);
  });

  it('isReauthFresh: 10 daqiqa TTL ichida reauth yangi', () => {
    const now = Date.now();
    expect(isReauthFresh(now - 60 * 1000, now)).toBe(true);
    expect(isReauthFresh(now - 11 * 60 * 1000, now)).toBe(false);
    expect(isReauthFresh(undefined, now)).toBe(false);
    expect(isReauthFresh(null, now)).toBe(false);
  });
});
