/**
 * Deborah — Auth Module Barrel Export
 *
 * Single import point for all authorization, tenant context,
 * RLS policy, and audit modules.
 *
 * Usage:
 *   import auth from '../modules/auth/index.js';
 *   // Or:
 *   import { authorize, audit, tenant } from '../modules/auth/index.js';
 */

export { default as authorization, AuthorizationService, AuthResult } from './authorization.js';
export {
  getCurrentTenant,
  getTenantId,
  runWithTenant,
  tenantMiddleware,
  queryByTenant,
  validateTenantScope,
} from './tenant-context.js';
export {
  enableRls,
  createTenantPolicy,
  createAllPolicies,
  setSessionTenant,
} from './rls.js';
export {
  audit,
  queryAuditLog,
  auditMiddleware,
  AUDIT_ACTIONS,
} from './audit.js';
export {
  isOidcEnabled,
  getOidcStatus,
  generatePkceChallenge,
  getAuthUrl,
  completeOidcLogin,
  findOrCreateUser,
} from './oidc.js';

// ── WebAuthn (Passkey) ──
export {
  generateRegistrationChallenge,
  verifyRegistrationResponse,
  generateAuthenticationChallenge,
  verifyAuthenticationResponse,
  listPasskeys,
  removePasskey,
  hasPasskeys,
  setRpConfig,
  getRpConfig,
} from './webauthn.js';

// ── Session Manager ──
export {
  recordSession,
  touchSession,
  getUserSessions,
  revokeSession,
  revokeOtherSessions,
  generateRecoveryCodes,
  verifyRecoveryCode,
  getRecoveryCodeStatus,
  revokeRecoveryCodes,
} from './session-manager.js';

// ── Account Linking ──
export {
  createLinkRequest,
  approveLinkRequest,
  rejectLinkRequest,
  removeLink,
  getLinkedAccounts,
  reportIdentityMismatch,
  getMismatchQueue,
  resolveMismatch,
  countOpenMismatches,
} from './account-linking.js';
