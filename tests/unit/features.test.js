/**
 * Edikit — Unit Tests: Feature Flags
 *
 * Tests the FeatureFlags service: isEnabled, setOverride, tenant override,
 * env var integration, and getAll().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import features from '../../src/config/features.js';

describe('FeatureFlags — default values', () => {
  beforeEach(() => {
    features.clearOverrides();
  });

  it('should return true for known enabled features', () => {
    expect(features.isEnabled('vip')).toBe(true);
    expect(features.isEnabled('arena')).toBe(true);
    expect(features.isEnabled('excelImport')).toBe(true);
  });

  it('should return false for unknown features', () => {
    expect(features.isEnabled('nonexistent_feature')).toBe(false);
  });
});

describe('FeatureFlags — runtime overrides', () => {
  beforeEach(() => {
    features.clearOverrides();
  });

  it('should override a feature flag', () => {
    features.setOverride('vip', false);
    expect(features.isEnabled('vip')).toBe(false);
  });

  it('should revert to default when override is cleared', () => {
    features.setOverride('vip', false);
    expect(features.isEnabled('vip')).toBe(false);

    features.setOverride('vip', null);
    expect(features.isEnabled('vip')).toBe(true);
  });

  it('should throw for unknown feature flags', () => {
    expect(() => features.setOverride('unknown', true)).toThrow();
  });

  it('should clear all overrides', () => {
    features.setOverride('vip', false);
    features.setOverride('arena', false);
    features.clearOverrides();
    expect(features.isEnabled('vip')).toBe(true);
    expect(features.isEnabled('arena')).toBe(true);
  });
});

describe('FeatureFlags — tenant overrides', () => {
  beforeEach(() => {
    features.clearOverrides();
  });

  it('should override for a specific tenant', () => {
    features.setTenantOverride('tenant1', 'vip', false);
    expect(features.isEnabled('vip', 'tenant1')).toBe(false);
    expect(features.isEnabled('vip', 'tenant2')).toBe(true); // unaffected
  });
});

describe('FeatureFlags — getAll()', () => {
  beforeEach(() => {
    features.clearOverrides();
  });

  it('should return all features with status and source', () => {
    const all = features.getAll();
    expect(all.vip).toBeDefined();
    expect(all.vip.enabled).toBe(true);
    expect(all.vip.description).toBe('VIP hidden premium access control');
    expect(all.vip.source).toBe('default');
  });

  it('should reflect overrides in getAll', () => {
    features.setOverride('vip', false);
    const all = features.getAll();
    expect(all.vip.enabled).toBe(false);
    expect(all.vip.source).toBe('override');
  });
});

describe('FeatureFlags — getRegistry()', () => {
  it('should return the feature registry', () => {
    const registry = features.getRegistry();
    expect(registry.vip).toBeDefined();
    expect(registry.vip.default).toBe(true);
    expect(registry.vip.envVar).toBe('FEATURE_VIP');
  });
});
