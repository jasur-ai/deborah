/**
 * Edikit — Feature Flag Service
 *
 * Controls feature availability across the application.
 * Supports:
 *   - In-memory flags (hot-reloadable via API)
 *   - Environment-based defaults (typed)
 *   - Tenant override (for future multi-tenant use)
 *
 * Usage:
 *   import features from './features.js';
 *   if (features.isEnabled('vip')) { ... }
 *   features.setOverride('newUI', true); // hot-reload
 */

// ── Feature flag registry ──
// Each flag has a default value, description, and optional env var name.
const FEATURE_REGISTRY = {
  vip: {
    default: true,
    description: 'VIP hidden premium access control',
    envVar: 'FEATURE_VIP',
  },
  mockTests: {
    default: true,
    description: 'Mock test functionality',
    envVar: 'FEATURE_MOCK_TESTS',
  },
  preTests: {
    default: true,
    description: 'PRE test functionality',
    envVar: 'FEATURE_PRE_TESTS',
  },
  publicTests: {
    default: true,
    description: 'Public test search and sharing',
    envVar: 'FEATURE_PUBLIC_TESTS',
  },
  arena: {
    default: true,
    description: 'Game arena / split-screen mode',
    envVar: 'FEATURE_ARENA',
  },
  excelImport: {
    default: true,
    description: 'Excel question import',
    envVar: 'FEATURE_EXCEL_IMPORT',
  },
};

// ── In-memory overrides (hot-reloadable) ──
const _overrides = new Map();

// ── Tenant overrides (future use) ──
const _tenantOverrides = new Map();

class FeatureFlags {
  /**
   * Check if a feature is enabled.
   * Priority: tenant override > runtime override > env var > default
   */
  isEnabled(name, tenantId = null) {
    const flag = FEATURE_REGISTRY[name];
    if (!flag) {
      // Unknown features are disabled by default
      return false;
    }

    // 1. Tenant override (highest priority)
    if (tenantId && _tenantOverrides.has(`${tenantId}:${name}`)) {
      return _tenantOverrides.get(`${tenantId}:${name}`);
    }

    // 2. Runtime override
    if (_overrides.has(name)) {
      return _overrides.get(name);
    }

    // 3. Environment variable
    if (flag.envVar && process.env[flag.envVar] !== undefined) {
      const envVal = process.env[flag.envVar].toLowerCase();
      return envVal === 'true' || envVal === '1';
    }

    // 4. Default
    return flag.default;
  }

  /**
   * Set a runtime override for a feature flag.
   * Pass `null` to clear the override (reverts to env/default).
   */
  setOverride(name, value) {
    if (!FEATURE_REGISTRY[name]) {
      throw new Error(`Unknown feature flag: "${name}"`);
    }
    if (value === null) {
      _overrides.delete(name);
    } else {
      _overrides.set(name, Boolean(value));
    }
  }

  /**
   * Clear all runtime overrides.
   */
  clearOverrides() {
    _overrides.clear();
  }

  /**
   * Set a tenant-specific override.
   */
  setTenantOverride(tenantId, name, value) {
    if (!FEATURE_REGISTRY[name]) {
      throw new Error(`Unknown feature flag: "${name}"`);
    }
    _tenantOverrides.set(`${tenantId}:${name}`, Boolean(value));
  }

  /**
   * Get all feature flags with their current effective values.
   */
  getAll(tenantId = null) {
    const result = {};
    for (const [name, flag] of Object.entries(FEATURE_REGISTRY)) {
      result[name] = {
        enabled: this.isEnabled(name, tenantId),
        description: flag.description,
        source: this._getSource(name, tenantId),
      };
    }
    return result;
  }

  /**
   * Get the source of a flag's value (for debugging).
   */
  _getSource(name, tenantId = null) {
    if (tenantId && _tenantOverrides.has(`${tenantId}:${name}`)) return 'tenant';
    if (_overrides.has(name)) return 'override';
    const flag = FEATURE_REGISTRY[name];
    if (flag.envVar && process.env[flag.envVar] !== undefined) return 'env';
    return 'default';
  }

  /**
   * Get the feature registry (for admin UI).
   */
  getRegistry() {
    return { ...FEATURE_REGISTRY };
  }
}

const features = new FeatureFlags();
export default features;
export { FeatureFlags };
