/**
 * Deborah — Account Linking Service
 *
 * Manages linking multiple authentication methods to a single Deborah account.
 *
 * Flow:
 *   1. User requests to link a new auth method (e.g., Google to existing password account)
 *   2. System verifies ownership of both accounts (email verification or current password)
 *   3. Links are stored with audit trail
 *   4. Identity mismatches are queued for manual review
 *
 * Supported link types:
 *   - password ↔ google (OIDC)
 *   - password ↔ passkey
 *   - google ↔ passkey
 *
 * Link IDs encode sourceUser and targetUser for bidirectional lookups.
 * Keys are stored via safeKey() which collapses `__` to `_`, so we store
 * sourceUserId + targetUserId as STRUCTURAL FIELDS in the link data
 * rather than parsing them from the key.
 *
 * Security:
 *   - Email alone is NOT sufficient for merge authority
 *   - Both accounts must be verified (password or existing session)
 *   - All linking operations are audited
 *   - Links are revocable with re-verification
 *
 * @module account-linking
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { audit, AUDIT_ACTIONS } from './audit.js';
import { syncLinkedOneIds } from './identity.js';

// ── Constants ──
const LINK_PATH = 'account_links';
const QUEUE_PATH = 'identity_mismatch_queue';

// ── Account Link Management ──

/**
 * Create an account link request.
 * One of the accounts must be verified (current session).
 *
 * @param {Object} params
 * @param {string} params.sourceUserId - Currently logged-in user's safeKey
 * @param {string} params.targetUserId - Target user safeKey to link with
 * @param {string} params.sourceMethod - 'password' | 'google' | 'passkey'
 * @param {string} params.targetMethod - 'password' | 'google' | 'passkey'
 * @param {string} [params.verificationToken] - Email verification token
 * @returns {Promise<Object>} { ok, error, linkId }
 */
export async function createLinkRequest({ sourceUserId, targetUserId, sourceMethod, targetMethod, verificationToken }) {
  if (!sourceUserId || !targetUserId) {
    return { ok: false, error: 'Both source and target users are required.' };
  }

  if (sourceUserId === targetUserId) {
    return { ok: false, error: 'Cannot link an account to itself.' };
  }

  // Check if link already exists (both approved links and pending requests)
  // Compare by structural fields (sourceUserId/targetUserId), not by key parsing
  const existingSnap = await fb.get(LINK_PATH);
  if (existingSnap.exists()) {
    const existingLinks = existingSnap.val();
    for (const link of Object.values(existingLinks)) {
      if ((link.sourceUserId === sourceUserId && link.targetUserId === targetUserId) ||
          (link.sourceUserId === targetUserId && link.targetUserId === sourceUserId)) {
        return { ok: false, error: 'These accounts are already linked.' };
      }
    }
  }

  // 2. Check pending requests (QUEUE_PATH)
  const queueSnap = await fb.get(QUEUE_PATH);
  if (queueSnap.exists()) {
    const queue = queueSnap.val();
    for (const entry of Object.values(queue)) {
      if (entry.status === 'pending' &&
          ((entry.sourceUserId === sourceUserId && entry.targetUserId === targetUserId) ||
           (entry.sourceUserId === targetUserId && entry.targetUserId === sourceUserId))) {
        return { ok: false, error: 'These accounts already have a pending link request.' };
      }
    }
  }

  // Create link request
  const requestId = crypto.randomBytes(16).toString('hex');
  const request = {
    id: requestId,
    sourceUserId,
    targetUserId,
    sourceMethod: sourceMethod || 'unknown',
    targetMethod: targetMethod || 'unknown',
    status: 'pending', // pending | approved | rejected | expired
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    verificationToken: verificationToken || null,
    verifiedAt: null,
    resolvedBy: null,
    resolvedAt: null,
  };

  await fb.set(`${QUEUE_PATH}/${requestId}`, request);

  return { ok: true, linkId: requestId };
}

/**
 * Approve a link request (after verification).
 *
 * @param {Object} params
 * @param {string} params.requestId - The link request ID
 * @param {string} params.approvedBy - Admin or user who approves
 * @param {boolean} [params.skipVerification] - Admin override
 * @returns {Promise<Object>} { ok, error }
 */
export async function approveLinkRequest({ requestId, approvedBy, skipVerification }) {
  // Get the request
  const requestSnap = await fb.get(`${QUEUE_PATH}/${requestId}`);
  if (!requestSnap.exists()) {
    return { ok: false, error: 'Link request not found.' };
  }

  const request = requestSnap.val();

  if (request.status !== 'pending') {
    return { ok: false, error: `Link request is already ${request.status}.` };
  }

  // Check expiry
  if (Date.now() > request.expiresAt) {
    request.status = 'expired';
    await fb.set(`${QUEUE_PATH}/${requestId}`, request);
    return { ok: false, error: 'Link request has expired.' };
  }

  // Create the actual link (bidirectional)
  // NOTE: safeKey() collapses `__`, so we store sourceUserId + targetUserId
  // as STRUCTURAL FIELDS in link data (NOT parsing from key)
  const linkId = `${request.sourceUserId}|${request.targetUserId}`;

  const linkData = {
    linkedAt: Date.now(),
    linkedBy: approvedBy || 'system',
    sourceUserId: request.sourceUserId,
    targetUserId: request.targetUserId,
    sourceMethod: request.sourceMethod,
    targetMethod: request.targetMethod,
  };

  // Store only one direction (source→target) and look up by field comparison
  await fb.set(`${LINK_PATH}/${safeKey(linkId)}`, linkData);

  // Update request status
  request.status = 'approved';
  request.resolvedBy = approvedBy || 'system';
  request.resolvedAt = Date.now();
  await fb.set(`${QUEUE_PATH}/${requestId}`, request);

  // Audit
  await audit({
    action: AUDIT_ACTIONS.ACCOUNT_LINKED,
    userId: request.sourceUserId,
    resourceType: 'account_link',
    resourceId: requestId,
    details: {
      sourceMethod: request.sourceMethod,
      targetMethod: request.targetMethod,
      targetUser: request.targetUserId,
      approvedBy,
      skipVerification: !!skipVerification,
    },
  });

  // E-01a: linked account'lar bitta canonical OneID oladi (fail-soft — link
  // oqimi OneID xatosida buzilmaydi, audit'da qayd etiladi).
  const oneIdResult = await syncLinkedOneIds(request.sourceUserId, request.targetUserId);
  if (!oneIdResult.ok) {
    await audit({
      action: AUDIT_ACTIONS.ONEID_SYNC_FAILED,
      userId: request.sourceUserId,
      resourceType: 'account_link',
      resourceId: requestId,
      details: { error: oneIdResult.error, targetUser: request.targetUserId },
    });
  }

  return { ok: true };
}

/**
 * Reject a link request.
 *
 * @param {Object} params
 * @param {string} params.requestId
 * @param {string} params.rejectedBy
 * @param {string} [params.reason]
 * @returns {Promise<Object>} { ok, error }
 */
export async function rejectLinkRequest({ requestId, rejectedBy, reason }) {
  const requestSnap = await fb.get(`${QUEUE_PATH}/${requestId}`);
  if (!requestSnap.exists()) {
    return { ok: false, error: 'Link request not found.' };
  }

  const request = requestSnap.val();
  request.status = 'rejected';
  request.rejectedBy = rejectedBy || 'system';
  request.rejectedAt = Date.now();
  request.rejectionReason = reason || null;
  await fb.set(`${QUEUE_PATH}/${requestId}`, request);

  return { ok: true };
}

/**
 * Remove an account link (unlink).
 *
 * @param {Object} params
 * @param {string} params.userId1 - One side of the link
 * @param {string} params.userId2 - Other side of the link
 * @param {string} params.unlinkedBy - Who removed the link
 * @returns {Promise<Object>} { ok, error }
 */
export async function removeLink({ userId1, userId2, unlinkedBy }) {
  // Find the link by structural field comparison, not by key
  const existingSnap = await fb.get(LINK_PATH);
  if (!existingSnap.exists()) {
    return { ok: false, error: 'No link found between these accounts.' };
  }

  const existingLinks = existingSnap.val();
  let foundKey = null;
  for (const [key, link] of Object.entries(existingLinks)) {
    if ((link.sourceUserId === userId1 && link.targetUserId === userId2) ||
        (link.sourceUserId === userId2 && link.targetUserId === userId1)) {
      foundKey = key;
      break;
    }
  }

  if (!foundKey) {
    return { ok: false, error: 'No link found between these accounts.' };
  }

  await fb.remove(`${LINK_PATH}/${foundKey}`);

  await audit({
    action: AUDIT_ACTIONS.ACCOUNT_UNLINKED,
    userId: userId1,
    resourceType: 'account_link',
    details: { unlinkedWith: userId2, unlinkedBy },
  });

  return { ok: true };
}

/**
 * Get all linked accounts for a user.
 *
 * Uses structural fields (sourceUserId/targetUserId) in link data,
 * NOT parsing from the key (since safeKey() collapses `__` to `_`).
 *
 * @param {string} userId
 * @returns {Promise<Array>} Array of { linkedUserId, linkedAt, method }
 */
export async function getLinkedAccounts(userId) {
  const allLinksSnap = await fb.get(LINK_PATH);
  if (!allLinksSnap.exists()) return [];

  const allLinks = allLinksSnap.val();
  const linkedAccounts = [];

  for (const linkData of Object.values(allLinks)) {
    if (linkData.sourceUserId === userId) {
      linkedAccounts.push({
        linkedUserId: linkData.targetUserId,
        linkedAt: linkData.linkedAt,
        method: linkData.targetMethod,
      });
    } else if (linkData.targetUserId === userId) {
      linkedAccounts.push({
        linkedUserId: linkData.sourceUserId,
        linkedAt: linkData.linkedAt,
        method: linkData.sourceMethod,
      });
    }
  }

  return linkedAccounts;
}

// ── Identity Mismatch Queue ──

/**
 * Report an identity mismatch (when automatic matching fails).
 * Creates a manual review queue entry.
 *
 * @param {Object} params
 * @param {string} params.email - Email that caused the mismatch
 * @param {string} [params.userId1] - First user safeKey
 * @param {string} [params.userId2] - Second user safeKey
 * @param {string} params.reason - 'email_exists' | 'google_email_taken' | 'duplicate_account' | 'manual'
 * @param {Object} [params.metadata] - Additional context
 * @returns {Promise<string>} Queue entry ID
 */
export async function reportIdentityMismatch({ email, userId1, userId2, reason, metadata }) {
  const entryId = crypto.randomBytes(8).toString('hex');
  const entry = {
    id: entryId,
    email: email || null,
    userId1: userId1 || null,
    userId2: userId2 || null,
    reason: reason || 'manual',
    metadata: metadata || {},
    status: 'open', // open | investigating | resolved | dismissed
    createdAt: Date.now(),
    assignedTo: null,
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
  };

  await fb.set(`${QUEUE_PATH}/${entryId}`, entry);

  // Audit
  await audit({
    action: AUDIT_ACTIONS.IDENTITY_MISMATCH,
    resourceType: 'identity_mismatch',
    resourceId: entryId,
    details: { reason, email },
  });

  return entryId;
}

/**
 * Get all open identity mismatch queue entries.
 *
 * @param {Object} [filters]
 * @param {string} [filters.status] - 'open' | 'investigating' | 'resolved' | 'dismissed'
 * @returns {Promise<Array>}
 */
export async function getMismatchQueue(filters = {}) {
  const snap = await fb.get(QUEUE_PATH);
  if (!snap.exists()) return [];

  const queue = snap.val();
  const entries = Object.values(queue);

  if (filters.status) {
    return entries.filter(e => e.status === filters.status);
  }

  // Default: sort by status (open first), then by date
  return entries.sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (a.status !== 'open' && b.status === 'open') return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

/**
 * Resolve an identity mismatch entry.
 *
 * @param {Object} params
 * @param {string} params.entryId
 * @param {string} params.resolvedBy - Admin username
 * @param {string} params.resolution - 'merged' | 'separate' | 'dismissed' | 'manual_override'
 * @param {string} [params.notes]
 * @returns {Promise<Object>} { ok, error }
 */
export async function resolveMismatch({ entryId, resolvedBy, resolution, notes }) {
  const snap = await fb.get(`${QUEUE_PATH}/${entryId}`);
  if (!snap.exists()) {
    return { ok: false, error: 'Mismatch entry not found.' };
  }

  const entry = snap.val();
  entry.status = resolution === 'dismissed' ? 'dismissed' : 'resolved';
  entry.resolvedBy = resolvedBy;
  entry.resolvedAt = Date.now();
  entry.resolution = resolution || 'manual_override';
  if (notes) entry.notes = notes;

  await fb.set(`${QUEUE_PATH}/${entryId}`, entry);

  await audit({
    action: AUDIT_ACTIONS.IDENTITY_RESOLVED,
    userId: entry.userId1,
    resourceType: 'identity_mismatch',
    resourceId: entryId,
    details: { resolution, email: entry.email, resolvedBy },
  });

  return { ok: true };
}

/**
 * Count open mismatch entries.
 *
 * @returns {Promise<number>}
 */
export async function countOpenMismatches() {
  const entries = await getMismatchQueue({ status: 'open' });
  return entries.length;
}
