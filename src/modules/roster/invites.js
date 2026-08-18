/**
 * Edikit — Roster Invite System (AUTH A-11 §13-15)
 *
 * Roster commit'dan so'ng har talaba uchun aktivatsiya invite'i yaratiladi:
 *   - Token: 48 bayt (96 hex) — faqat HASH'i saqlanadi (reset token namunasi)
 *   - Muddati: 7 kun (expiresAt), 1 marta ishlatiladi, revoke qilish mumkin
 *   - Aktivatsiya: parol o'rnatish (argon2id) → guruh prefilled + enroll
 *   - Teacher (P1): "N talaba aktivatsiya qilmadi" xabari uchun summary
 *
 * Storage: invites/{tokenHash} → { sessionId, courseCode, groupCode, email,
 *          telegramId, usedBy, usedAt, expiresAt, revokedAt, status }
 *
 * @module roster/invites
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { safeKey, hashPassword } from '../../../utils/helpers.js';
import { parseRegister } from '../auth/validation.js';
import { recordConsent, CONSENT_PURPOSES } from '../legal/consent.js';
import { sendEmail } from '../email/provider.js';
import { renderInvite } from '../email/templates.js';
import { logEmailRecord } from '../email/log.js';

const INVITES_PATH = 'invites';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 kun (A-11 §14)

// AUTH B-11 §13: invite yuborish rate limit — 50/soat per teacher (batch abuse)
const INVITE_SEND_MAX = 50;
const INVITE_SEND_WINDOW_MS = 60 * 60 * 1000;
const INVITE_SEND_MAX_KEYS = 5000; // xotira cheklovi — oidc.js namunasi
const inviteSendAttempts = new Map(); // userKey -> [timestamps]

/**
 * AUTH B-11 §13: per-teacher invite yuborish rate limit.
 * @param {string} userKey
 * @returns {{allowed: boolean, retryAfterSeconds?: number}}
 */
export function checkInviteSendLimit(userKey) {
  const now = Date.now();
  const key = String(userKey || 'unknown');
  const arr = (inviteSendAttempts.get(key) || []).filter((t) => now - t < INVITE_SEND_WINDOW_MS);
  if (arr.length >= INVITE_SEND_MAX) {
    return { allowed: false, retryAfterSeconds: Math.ceil((arr[0] + INVITE_SEND_WINDOW_MS - now) / 1000) };
  }
  arr.push(now);
  inviteSendAttempts.set(key, arr);
  // Xotira cheklovi: unique userlar 5000 dan oshsa eng eski kalitlarni tozalaymiz
  if (inviteSendAttempts.size > INVITE_SEND_MAX_KEYS) {
    const oldest = inviteSendAttempts.keys().next().value;
    inviteSendAttempts.delete(oldest);
  }
  return { allowed: true };
}

/** Token bo'yicha in-flight mutex — parallel accept race'ini oldini oladi. */
const acceptLocks = new Map();

/** Invite holatlari. */
export const INVITE_STATUS = {
  PENDING: 'pending',
  USED: 'used',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
};

function tokenHashOf(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Committed sessiya qatorlari uchun invite'lar yaratadi (A-11 §13).
 * Idempotent: sessiya+identity uchun invite allaqachon mavjud bo'lsa o'tkazib
 * yuboriladi. Faqat paroli bo'lmagan (roster'dan yaratilgan) userlar uchun.
 *
 * @param {string} sessionId
 * @param {Object} [opts] - { channel: 'email'|'telegram'|'both' }
 * @returns {Promise<Object>} { ok, created, invites }
 */
export async function createInvitesForSession(sessionId, opts = {}) {
  const { getStagingSession, getParsedRows } = await import('./staging.js');
  const { loadColumnMapping: loadMap } = await import('./mapper.js');

  const session = await getStagingSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found' };
  if (session.status !== 'committed') {
    return { ok: false, error: `Invites faqat committed sessiyada yaratiladi (status: ${session.status})` };
  }

  const rows = await getParsedRows(sessionId);
  if (!rows || rows.length === 0) return { ok: false, error: 'No parsed rows found' };

  // Identity ustunini aniqlash — qaysi kolonka user identity ekanini bilish
  // uchun mapping'ni o'qiymiz (qator identity'si resolve qilinadi).
  const saved = await loadMap(sessionId);
  const mapping = saved?.mapping || {};
  const identityCol = Object.entries(mapping).find(([, m]) =>
    ['userId', 'username', 'email'].includes(m.field))?.[0];
  // AUTH B-11 fix: email ham mapping orqali topiladi (raw column nomi emas) —
  // foydalanuvchi 'elektron pochta'/'email_address' kabi ixtiyoriy ustun
  // nomini mapping'laganda invite'ga email tushmas edi.
  const emailCol = Object.entries(mapping).find(([, m]) => m.field === 'email')?.[0];

  // Review fix: per-row DB read emas — users + invites bir marta o'qiladi.
  // (5000 qatorli faylda ~10k sequential read + O(n²) scan bo'lar edi.)
  const usersSnap = await fb.get('users');
  const users = usersSnap.exists() ? usersSnap.val() : {};
  const invitesSnap = await fb.get(INVITES_PATH);
  const allInvites = invitesSnap.exists() ? invitesSnap.val() : {};

  const channel = opts.channel || 'email';
  const created = [];
  let skipped = 0;

  for (const row of rows) {
    const identity = identityCol ? String(row.data?.[identityCol] || '').trim() : '';
    if (!identity) { skipped++; continue; }
    const userKey = safeKey(identity);

    // User allaqachon parol o'rnatgan bo'lsa (aktiv) — invite kerak emas
    if (users[userKey]?.password) { skipped++; continue; }

    // Idempotency: bu sessiya + user uchun invite bor mi?
    const dup = Object.values(allInvites).find(inv =>
      inv.sessionId === sessionId && inv.identity === identity && inv.status !== INVITE_STATUS.REVOKED);
    if (dup) { skipped++; continue; }

    const token = crypto.randomBytes(48).toString('hex');
    const tokenHash = tokenHashOf(token);
    const invite = {
      tokenHash,
      sessionId,
      identity,
      email: (emailCol ? String(row.data?.[emailCol] || '') : '') || row.data?.email || row.data?.elektron_pochta || '',
      telegramId: row.data?.telegram_id || '',
      courseCode: row.data?.fan || row.data?.course_code || '',
      groupCode: row.data?.guruh || row.data?.group || '',
      channel,
      status: INVITE_STATUS.PENDING,
      createdAt: Date.now(),
      expiresAt: Date.now() + INVITE_TTL_MS,
      usedBy: null,
      usedAt: null,
      revokedAt: null,
    };

    await fb.set(`${INVITES_PATH}/${tokenHash}`, invite);
    allInvites[tokenHash] = invite; // keyingi row'larda dedupe uchun
    created.push({
      id: tokenHash,
      identity,
      email: invite.email,
      courseCode: invite.courseCode,
      groupCode: invite.groupCode,
      expiresAt: invite.expiresAt,
      // Token faqat dev/test'da qaytariladi (reset token namunasi)
      ...(process.env.NODE_ENV !== 'production' ? { token } : {}),
    });
  }

  await audit({
    action: AUDIT_ACTIONS.INVITE_CREATED,
    resourceType: 'roster_staging',
    resourceId: sessionId,
    details: { created: created.length, skipped, channel },
  });

  return { ok: true, created: created.length, skipped, invites: created };
}

/**
 * AUTH B-13: invite'ni foydalanuvchiga bog'lash (yagona helper).
 * Enrollment idempotent yoziladi + invite USED/usedBy/usedAt + audit.
 * Password va Google accept path'lar bir xil kontrakt ishlatadi.
 */
async function writeInviteBinding({ tokenHash, invite, userKey, provider }) {
  // Enrollment (course prefilled, idempotent)
  if (invite.courseCode) {
    const enrollKey = `${userKey}_${invite.courseCode}`;
    const enrollSnap = await fb.get(`enrollments/${enrollKey}`);
    if (!enrollSnap.exists()) {
      await fb.set(`enrollments/${enrollKey}`, {
        id: enrollKey,
        userId: userKey,
        courseCode: invite.courseCode,
        groupCode: invite.groupCode || '',
        status: 'active',
        source: 'roster_invite',
        created_at: Date.now(),
      });
    }
  }

  // Invite'ni yopamiz (1 marta)
  await fb.set(`${INVITES_PATH}/${tokenHash}/status`, INVITE_STATUS.USED);
  await fb.set(`${INVITES_PATH}/${tokenHash}/usedBy`, userKey);
  await fb.set(`${INVITES_PATH}/${tokenHash}/usedAt`, Date.now());
  if (provider !== 'password') {
    await fb.set(`${INVITES_PATH}/${tokenHash}/usedProvider`, provider);
  }

  await audit({
    action: AUDIT_ACTIONS.INVITE_USED,
    userId: userKey,
    resourceType: 'roster_invite',
    resourceId: tokenHash,
    details: {
      sessionId: invite.sessionId,
      courseCode: invite.courseCode,
      groupCode: invite.groupCode,
      ...(provider !== 'password' ? { provider } : {}),
    },
  });
}

/**
 * AUTH B-13 §06: Google accept — invite'ni claim qilish (user yaratilishidan
 * OLDIN chaqiriladi; per-token mutex bilan race himoya). Status/expiry
 * tekshiruvi qayta o'qish bilan amalga oshiriladi — replay mumkin emas.
 *
 * @param {string} tokenHash — URL'dagi 64-hex hash
 * @param {string} userKey — google:{sub} canonical key
 * @returns {Promise<{ok: boolean, error?: string, invite?: object}>}
 */
export async function claimInviteForGoogle({ tokenHash, userKey }) {
  if (!tokenHash || typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) {
    return { ok: false, error: 'Noto\'g\'ri taklif havolasi' };
  }
  const prev = acceptLocks.get(tokenHash);
  const run = (prev || Promise.resolve()).then(async () => {
    const snap = await fb.get(`${INVITES_PATH}/${tokenHash}`);
    if (!snap.exists()) return { ok: false, error: 'Noto\'g\'ri yoki muddati o\'tgan invite' };
    const invite = snap.val();

    if (invite.status === INVITE_STATUS.USED) {
      return { ok: false, error: 'Bu invite allaqachon ishlatilgan' };
    }
    if (invite.status === INVITE_STATUS.REVOKED) {
      return { ok: false, error: 'Bu invite bekor qilingan' };
    }
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      await fb.set(`${INVITES_PATH}/${tokenHash}/status`, INVITE_STATUS.EXPIRED);
      return { ok: false, error: 'Invite muddati o\'tgan (7 kun)' };
    }

    await writeInviteBinding({ tokenHash, invite, userKey, provider: 'google' });
    return {
      ok: true,
      invite: {
        courseCode: invite.courseCode || '',
        groupCode: invite.groupCode || '',
        email: invite.email || '',
      },
    };
  });
  acceptLocks.set(tokenHash, run);
  try {
    return await run;
  } finally {
    acceptLocks.delete(tokenHash);
  }
}

/**
 * Invite'ni aktivlashtiradi (A-11 §13: parol → guruh prefilled).
 * 1 marta ishlatiladi; ishlatilgan/revoked/expired → reject.
 *
 * @param {Object} params - { token, username, password }
 * @returns {Promise<Object>}
 */
export async function acceptInvite({ token, username, password, email, consent }) {
  if (!token) return { ok: false, error: 'Token talab qilinadi' };

  // Review fix: email link `/invite/{tokenHash}` — foydalanuvchi HASH'ni
  // oladi (raw token DB'da yo'q). 64-hex kirish → hash sifatida to'g'ridan-
  // to'g'ri lookup; aks holda raw token'ni hash'laymiz (creator/dev oqimi).
  const tokenHash = /^[0-9a-f]{64}$/.test(token) ? token : tokenHashOf(token);

  // Per-token mutex: parallel accept race'ini oldini oladi (bitta user 2 marta yaratilmasin)
  const prev = acceptLocks.get(tokenHash);
  const run = (prev || Promise.resolve()).then(async () => {
    const snap = await fb.get(`${INVITES_PATH}/${tokenHash}`);
    if (!snap.exists()) return { ok: false, error: 'Noto\'g\'ri yoki muddati o\'tgan invite' };
    const invite = snap.val();

    if (invite.status === INVITE_STATUS.USED) {
      return { ok: false, error: 'Bu invite allaqachon ishlatilgan' };
    }
    if (invite.status === INVITE_STATUS.REVOKED) {
      return { ok: false, error: 'Bu invite bekor qilingan' };
    }
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      await fb.set(`${INVITES_PATH}/${tokenHash}/status`, INVITE_STATUS.EXPIRED);
      return { ok: false, error: 'Invite muddati o\'tgan (7 kun)' };
    }

    // Register validatsiyasi (min 8 + harf + raqam + A-18 email) — /user/login bilan bir xil.
    // Email: invite'da allaqachon mavjud (roster import) — undan ishlatamiz;
    // bo'lmasa body'dagi email'ni qabul qilamiz (A-18 email majburiy).
    const inviteEmail = invite.email || email || '';
    // Invite roster'dan kelgan (tashqi manba tasdiqlagan) — email bo'lmasa ham qabul qilamiz.
    // '' yuborilsa schema min(3) fail qiladi — bo'lmasa undefined (optional) qilamiz.
    const parsed = parseRegister(
      { username, password, email: inviteEmail || undefined, consent },
      { emailRequired: !!inviteEmail },
    );
    if (!parsed.ok) {
      return { ok: false, error: parsed.errorKey || 'invalid_input' };
    }

    // AUTH B-04: parsed.username canonical (NFKC+lowercase) — raw emas!
    // (parsed ishlatilmasa 'John.Doe' saqlanib, userKey 'john_doe' bo'lib qolardi.)
    const userKey = safeKey(parsed.username);
    const taken = await fb.get(`users/${userKey}`);
    if (taken.exists()) return { ok: false, error: 'Bu username allaqachon band' };

    // AUTH B-36: role'li invite (teacher/co_teacher) — role admin EMAS,
    // faqat o'z kursida (co_teacher) yoki teacher workspace'ida.
    const inviteRole = invite.role === 'teacher' || invite.role === 'co_teacher'
      ? invite.role : 'student';
    // Co-teacher: scope record'ini yozamiz (limit qayta tekshiriladi)
    if (inviteRole === 'co_teacher' && invite.scope?.courseCode) {
      const { bindCoTeacher } = await import('../teacher/co-teacher.js');
      const bound = await bindCoTeacher({
        userKey,
        courseCode: invite.scope.courseCode,
        owner: invite.scope.owner,
      });
      if (!bound.ok) {
        return { ok: false, error: bound.error === 'co_teacher_limit'
          ? 'Co-teacher limiti to\'lgan (3 ta)' : 'Invite scope no\'to\'g\'ri' };
      }
    }

    // Parolni argon2id bilan hash'lab user yaratamiz + guruh prefilled
    const hashed = await hashPassword(password);
    await fb.set(`users/${userKey}`, {
      username: parsed.username,
      password: hashed,
      created_at: Date.now(),
      safeKey: userKey,
      isVip: false,
      email: inviteEmail,
      email_verified: true, // invite email roster'dan — tashqi manba tasdiqlangan (A-18)
      display_name: invite.identity || invite.display_name || '',
      group: invite.groupCode || '',
      role: inviteRole,
      source: inviteRole === 'student' ? 'roster_invite' : `invite_${inviteRole}`,
      inviteTokenHash: tokenHash,
    });

    // AUTH D-24 §10 / D-25 §07: qonuniy rozilik — purpose'li yozuv
    // (parseRegister'da majburiy tekshirilgan; invite'da ip_hash yo'q — public)
    if (parsed.consent) {
      await recordConsent(userKey, CONSENT_PURPOSES.PRIVACY_POLICY, { lang: invite.lang || 'uz' })
        .catch(() => {});
    }

    // AUTH B-13: binding yagona helper orqali (Google path bilan bir xil kontrakt)
    await writeInviteBinding({ tokenHash, invite, userKey, provider: 'password' });

    return { ok: true, user: userKey, group: invite.groupCode || null, role: inviteRole };
  });
  acceptLocks.set(tokenHash, run);
  try {
    return await run;
  } finally {
    acceptLocks.delete(tokenHash);
  }
}

/**
 * AUTH B-11 §10: invite havolasini validatsiya qiladi (GET /invite/:token).
 * Status'ga qarab yaroqli/ishlatilgan/revoked/expired qaytaradi.
 *
 * @param {string} tokenHash — URL'dagi identifikator (invites/{hash} key)
 * @returns {Promise<{ok: boolean, status?: string, error?: string, invite?: object}>}
 */
export async function getInviteByHash(tokenHash) {
  if (!tokenHash || typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) {
    return { ok: false, error: 'Noto\'g\'ri taklif havolasi' };
  }
  const snap = await fb.get(`${INVITES_PATH}/${tokenHash}`);
  if (!snap.exists()) return { ok: false, error: 'Taklif topilmadi yoki muddati o\'tgan' };
  const invite = snap.val();
  if (invite.status === INVITE_STATUS.USED) return { ok: false, error: 'Bu taklif allaqachon ishlatilgan' };
  if (invite.status === INVITE_STATUS.REVOKED) return { ok: false, error: 'Bu taklif bekor qilingan' };
  if (invite.status === INVITE_STATUS.EXPIRED || (invite.expiresAt && invite.expiresAt < Date.now())) {
    return { ok: false, error: 'Taklif muddati o\'tgan (7 kun)' };
  }
  return {
    ok: true,
    status: INVITE_STATUS.PENDING,
    invite: {
      tokenHash: invite.tokenHash,
      courseCode: invite.courseCode || '',
      groupCode: invite.groupCode || '',
      email: invite.email || '',
      identity: invite.identity || '',
    },
  };
}

/**
 * AUTH B-11 §09: yaratilgan invite'lar uchun email yetkazish (batch).
 * Faqat email'i bor va hali yuborilmagan (deliveredAt yo'q) pending
 * invite'larga yuboradi — idempotent. Har biri email_log'ga tushadi.
 *
 * @param {Object} [opts] - { inviteIds?: string[], lang?: string }
 * @returns {Promise<Object>} { ok, sent, skipped, failed }
 */
export async function sendInviteEmails(opts = {}) {
  const { inviteIds = null, lang = 'uz' } = opts;
  const snap = await fb.get(INVITES_PATH);
  if (!snap.exists()) return { ok: true, sent: 0, skipped: 0, failed: [] };

  const all = Object.values(snap.val());
  const targets = inviteIds
    ? all.filter((inv) => inviteIds.includes(inv.tokenHash))
    : all;

  const base = process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`;
  let sent = 0;
  let skipped = 0;
  const failed = [];

  for (const invite of targets) {
    if (!invite || invite.status !== INVITE_STATUS.PENDING) { skipped++; continue; }
    if (!invite.email) { skipped++; continue; }
    if (invite.deliveredAt) { skipped++; continue; } // idempotent

    const inviteUrl = `${base.replace(/\/$/, '')}/invite/${invite.tokenHash}`;
    const tpl = renderInvite({
      inviteUrl,
      courseCode: invite.courseCode || '',
      groupCode: invite.groupCode || '',
      lang,
    });

    const sentRes = await sendEmail({
      to: invite.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      tag: 'invite',
    }).catch((err) => {
      console.warn('[roster:invite] send failed:', err?.message || err);
      return { ok: false };
    });

    if (sentRes.ok) {
      // Review fix: deliveredAt faqat MUVAFFAQIYATDA yoziladi — aks holda
      // muvaffaqiyatsiz send retry qilib bo'lmas edi.
      await fb.set(`${INVITES_PATH}/${invite.tokenHash}/deliveredAt`, Date.now());
      sent++;
      await logEmailRecord({
        email: invite.email,
        template: 'invite',
        status: sentRes.provider === 'mock' ? 'sent' : 'queued',
        providerMsgId: sentRes.messageId || null,
      }).catch(() => {});
    } else {
      // Retry imkoniyati: deliveryError hisoblagich + oxirgi xato (PII yo'q)
      const prevErr = invite.deliveryErrors || 0;
      await fb.set(`${INVITES_PATH}/${invite.tokenHash}/deliveryErrors`, prevErr + 1);
      await fb.set(`${INVITES_PATH}/${invite.tokenHash}/lastDeliveryError`, String(sentRes.error || 'send-failed').slice(0, 200));
      failed.push({ tokenHash: invite.tokenHash, identity: invite.identity, error: sentRes.error || 'send-failed' });
    }
  }

  await audit({
    action: AUDIT_ACTIONS.INVITE_SENT,
    resourceType: 'roster_invite',
    details: { sent, skipped, failed: failed.length },
  }).catch(() => {});

  return { ok: true, sent, skipped, failed };
}

/**
 * AUTH B-11 §12: expiry job — 7 kundan oshgan pending invite'lar 'expired'
 * holatiga o'tkaziladi (accept'da ham tekshiriladi, bu orqali stats to'g'ri).
 *
 * @returns {Promise<{ok: boolean, expired: number}>}
 */
export async function expireOverdueInvites() {
  const snap = await fb.get(INVITES_PATH);
  if (!snap.exists()) return { ok: true, expired: 0 };

  const now = Date.now();
  let expired = 0;
  for (const [hash, inv] of Object.entries(snap.val())) {
    if (inv && inv.status === INVITE_STATUS.PENDING && inv.expiresAt && inv.expiresAt < now) {
      await fb.set(`${INVITES_PATH}/${hash}/status`, INVITE_STATUS.EXPIRED);
      await fb.set(`${INVITES_PATH}/${hash}/expiredAt`, now);
      expired++;
    }
  }
  if (expired > 0) {
    await audit({
      action: AUDIT_ACTIONS.INVITE_EXPIRED,
      resourceType: 'roster_invite',
      details: { expired },
    }).catch(() => {});
  }
  return { ok: true, expired };
}

/**
 * Invite'ni bekor qiladi (A-11 §14 revoke). Faqat pending bo'lishi mumkin.
 *
 * @param {string} tokenHash
 * @returns {Promise<Object>}
 */
export async function revokeInvite(tokenHash) {
  const snap = await fb.get(`${INVITES_PATH}/${tokenHash}`);
  if (!snap.exists()) return { ok: false, error: 'Invite topilmadi' };
  const invite = snap.val();
  if (invite.status !== INVITE_STATUS.PENDING) {
    return { ok: false, error: `Faqat pending invite revoke qilinadi (holat: ${invite.status})` };
  }

  await fb.set(`${INVITES_PATH}/${tokenHash}/status`, INVITE_STATUS.REVOKED);
  await fb.set(`${INVITES_PATH}/${tokenHash}/revokedAt`, Date.now());

  await audit({
    action: AUDIT_ACTIONS.INVITE_REVOKED,
    resourceType: 'roster_invite',
    resourceId: tokenHash,
    details: { sessionId: invite.sessionId, identity: invite.identity },
  });

  return { ok: true };
}

/**
 * Sessiya invite'larini ro'yxatlaydi (status bilan).
 *
 * @param {string} sessionId
 * @returns {Promise<Object>} { invites, counts }
 */
export async function listInvites(sessionId) {
  const snap = await fb.get(INVITES_PATH);
  if (!snap.exists()) return { invites: [], counts: { pending: 0, used: 0, revoked: 0, expired: 0 } };

  const invites = Object.values(snap.val())
    .filter(inv => inv.sessionId === sessionId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const counts = { pending: 0, used: 0, revoked: 0, expired: 0 };
  for (const inv of invites) {
    counts[inv.status] = (counts[inv.status] || 0) + 1;
  }
  return { invites, counts };
}

/**
 * Teacher "N aktivatsiya qilmadi" xabari uchun summary (A-11 §14 P1).
 * Pending invite'lar soni va eng eski yoshi.
 *
 * @returns {Promise<Object>} { totalPending, bySession, oldestAgeMs }
 */
export async function getPendingInviteSummary() {
  const snap = await fb.get(INVITES_PATH);
  if (!snap.exists()) return { totalPending: 0, bySession: [], oldestAgeMs: 0 };

  const now = Date.now();
  const bySession = new Map();
  let oldest = 0;

  for (const inv of Object.values(snap.val())) {
    const effective = inv.status === INVITE_STATUS.PENDING && (!inv.expiresAt || inv.expiresAt > now)
      ? 'pending'
      : (inv.status === INVITE_STATUS.PENDING ? 'expired' : inv.status);
    if (effective === 'pending') {
      const age = now - inv.createdAt;
      if (age > oldest) oldest = age;
      const rec = bySession.get(inv.sessionId) || { sessionId: inv.sessionId, pending: 0, identity: [] };
      rec.pending++;
      if (rec.identity.length < 5) rec.identity.push(inv.identity);
      bySession.set(inv.sessionId, rec);
    }
  }

  return {
    totalPending: [...bySession.values()].reduce((s, r) => s + r.pending, 0),
    bySession: [...bySession.values()].sort((a, b) => b.pending - a.pending),
    oldestAgeMs: oldest,
  };
}
