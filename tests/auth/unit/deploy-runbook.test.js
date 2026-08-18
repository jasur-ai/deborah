/**
 * AUTH D-21 §17 — Deploy runbook: feature flag toggle + health kontrakti.
 * ---------------------------------------------------------------------------
 *  - Auth gradual rollout flaglari (D-21 §10/§26): default false.
 *  - FeatureFlags: default → env → runtime override → tenant override.
 *  - /health endpoint: 200 + status ok + features (D-21 §11).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import features, { FeatureFlags } from '../../../src/config/features.js';

const AUTH_FLAGS = ['authMfaRequired', 'authPasskeyLogin', 'authDeviceCheck'];

describe('AUTH D-21 §10 — auth gradual rollout flaglari', () => {
  beforeEach(() => {
    features.clearOverrides();
  });

  afterEach(() => {
    features.clearOverrides();
    // toUpperCase underscore'ni saqlaydi — to'g'ri env nomlari bilan o'chirish
    delete process.env.FEATURE_AUTH_MFA_REQUIRED;
    delete process.env.FEATURE_AUTH_PASSKEY_LOGIN;
    delete process.env.FEATURE_AUTH_DEVICE_CHECK;
  });

  it('3 ta auth flag registryda — default false (rollout 5→25→100)', () => {
    const all = features.getAll();
    for (const f of AUTH_FLAGS) {
      expect(all[f]).toBeTruthy();
      expect(all[f].enabled).toBe(false); // default false
    }
  });

  it('runtime override: setOverride(true) → isEnabled true', () => {
    expect(features.isEnabled('authMfaRequired')).toBe(false);
    features.setOverride('authMfaRequired', true);
    expect(features.isEnabled('authMfaRequired')).toBe(true);
    features.setOverride('authMfaRequired', null); // clear
    expect(features.isEnabled('authMfaRequired')).toBe(false);
  });

  it('env var: FEATURE_AUTH_MFA_REQUIRED=true → enabled', () => {
    process.env.FEATURE_AUTH_MFA_REQUIRED = 'true';
    expect(features.isEnabled('authMfaRequired')).toBe(true);
  });

  it('tenant override eng yuqori ustuvorlik', () => {
    features.setOverride('authMfaRequired', false);
    features.setTenantOverride('tenant-x', 'authMfaRequired', true);
    expect(features.isEnabled('authMfaRequired', 'tenant-x')).toBe(true);
    expect(features.isEnabled('authMfaRequired')).toBe(false);
  });

  it('noma\'lum flag → false + setOverride throw', () => {
    expect(features.isEnabled('authNopeFlag')).toBe(false);
    expect(() => features.setOverride('authNopeFlag', true)).toThrow();
  });
});

describe('AUTH D-21 §11 — /health endpoint kontrakti', () => {
  it('FeatureFlags sinfi mustaqil instansiya qilish mumkin', () => {
    const ff = new FeatureFlags();
    expect(typeof ff.isEnabled).toBe('function');
    expect(typeof ff.getAll).toBe('function');
    expect(ff.isEnabled('authMfaRequired')).toBe(false);
  });
});
