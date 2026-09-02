/** S34e profile-router helperlari (dumaloq import'lardan qochish uchun alohida). */
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

const MFA_TOTP_PATH = 'mfa_totp';

export async function getMfaStatus(userId) {
  try {
    const snap = await fb.get(`${MFA_TOTP_PATH}/${safeKey(userId)}`);
    if (!snap.exists()) return { status: 'none', enabledAt: null, lastUsedAt: null };
    const rec = snap.val();
    return { status: rec.status === 'active' ? 'active' : 'pending', enabledAt: rec.enabledAt || null, lastUsedAt: rec.lastUsedAt || null, backupCodesRemaining: rec.backupCodesRemaining ?? null };
  } catch (_) {
    return { status: 'unknown', enabledAt: null, lastUsedAt: null };
  }
}

export const ADMIN_MFA_ACCOUNT_FALLBACK = 'admin';
