/**
 * Edikit — Cast Role / Invite Service
 * ------------------------------------
 * Scoped invitation, one-time redeem, revoke.
 * Redeem'da authenticated accountga role record yaratiladi; nonce invalidate.
 */

import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';

const INVITE_ROOT = 'cast_invites';

export async function upsertInvite(sessionId, nonce, invite) {
  await fb.set(`${INVITE_ROOT}/${sessionId}/${nonce}`, invite);
}

export async function getInvite(sessionId, nonce) {
  const snap = await fb.get(`${INVITE_ROOT}/${sessionId}/${nonce}`);
  return snap.exists() ? snap.val() : null;
}

/**
 * One-time redeem → role record. Nonce invalidate.
 */
export async function redeemInvite(sessionId, nonce, actorId) {
  const invite = await getInvite(sessionId, nonce);
  if (!invite) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Taklif topilmadi');
  }
  if (invite.redeemedBy) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Taklif allaqachon ishlatilgan');
  }
  if (invite.expiresAt < Date.now()) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Taklif muddati o‘tgan');
  }

  const roleRecord = {
    actorId,
    role: invite.role,
    sessionId,
    permissionsVersion: 1,
    revokedAt: null,
    grantedAt: Date.now(),
    grantedVia: 'invite',
  };
  await fb.set(`cast_sessions/${sessionId}/roles/${encodeURIComponent(actorId)}`, roleRecord);
  await fb.update(`${INVITE_ROOT}/${sessionId}/${nonce}`, { redeemedBy: actorId, redeemedAt: Date.now() });
  return roleRecord;
}

export async function revokeInvite(sessionId, nonce) {
  await fb.remove(`${INVITE_ROOT}/${sessionId}/${nonce}`);
}

/**
 * Revoke a role (kick co-host / moderator).
 */
export async function revokeRole(sessionId, actorId) {
  await fb.update(`cast_sessions/${sessionId}/roles/${encodeURIComponent(actorId)}`, { revokedAt: Date.now() });
}
