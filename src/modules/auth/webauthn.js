/**
 * Deborah — WebAuthn (Passkey) Service (AUTH A-27)
 *
 * Production-grade passkey support built on @simplewebauthn/server v13:
 *   - full attestation/assertion signature verification (COSE/ECDSA/RSA/OKP)
 *   - origin + RP ID validation on every response
 *   - single-use, 5-minute challenges (stored in session)
 *   - server-authoritative monotonic counter (regression/replay → reject)
 *   - resident-key (discoverable) credentials → Conditional UI + userless login
 *   - raw biometric data never reaches the server (WebAuthn spec)
 *
 * Storage (Firebase-compatible local DB):
 *   passkeys/<safeKey(credentialId)>   → credential record
 *   passkeys_index/<userId>            → [{ id, createdAt }]
 *
 * @module webauthn
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { audit, AUDIT_ACTIONS } from './audit.js';

// @simplewebauthn/server import'i ~15s (katta graflar) — LAZY yuklanadi,
// faqat passkey ishlatilganda. Boot va passkey ishlatmaydigan testlar tez.
let swaPromise = null;
function swa() {
  if (!swaPromise) {
    // Transient import xatosi kelajakdagi barcha passkey ops'larini buzmasligi
    // uchun promise reset qilinadi (review topilmasi).
    swaPromise = import('@simplewebauthn/server').catch((err) => {
      swaPromise = null;
      throw err;
    });
  }
  return swaPromise;
}

// ── Constants ──
const CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CREDENTIALS_PER_USER = 25;
const CREDENTIAL_BASE_PATH = 'passkeys';
const CREDENTIAL_INDEX_PATH = 'passkeys_index';

// ── Relying Party configuration ──
// Production: set RP_ID (domain without protocol), RP_ORIGIN, RP_NAME env vars.
// Defaults (localhost dev / tests) are derived per-request via rpFromRequest().
const RP_CONFIG = {
  name: process.env.RP_NAME || 'Deborah',
  id: process.env.RP_ID || '',
  origin: process.env.RP_ORIGIN || '',
};

/**
 * Derive the RP { id, origin } for a given request.
 * In production RP_ID/RP_ORIGIN env vars win; otherwise derived from the
 * incoming Host header so tests and multi-origin deployments stay consistent.
 *
 * @param {import('express').Request} req
 * @returns {{ id: string, origin: string }}
 */
export function rpFromRequest(req) {
  const host = (req.get && req.get('host')) || 'localhost';
  const hostname = host.split(':')[0].toLowerCase();
  // RP_ID/RP_ORIGIN env o'rnatilgan bo'lsa — barqaror (production override,
  // test'lar uchun ham: supertest har so'rovda yangi port ochadi).
  // Aks holda Host header'dan olinadi (browser flow — bitta origin).
  const id = process.env.RP_ID || hostname;
  const origin = process.env.RP_ORIGIN || `${req.protocol}://${host}`;
  return { id, origin };
}

/**
 * Deterministic user handle (WebAuthn `user.id`) — stable across enrollments.
 * @param {string} userId
 * @returns {Uint8Array}
 */
function userHandleFor(userId) {
  return new Uint8Array(crypto.createHash('sha256').update(`deborah:passkey:${userId}`).digest());
}

// ── Storage helpers ──

// Credential ID base64url (case-sensitive, path-safe [A-Za-z0-9_-]) —
// safeKey() ishlatilmaydi: u lowercase + 60 belgiga qirqadi (collision xavfi).
async function getCredential(credentialId) {
  const snap = await fb.get(`${CREDENTIAL_BASE_PATH}/${credentialId}`);
  return snap.exists() ? snap.val() : null;
}

async function getIndex(userId) {
  const snap = await fb.get(`${CREDENTIAL_INDEX_PATH}/${safeKey(userId)}`);
  return snap.exists() && Array.isArray(snap.val()) ? snap.val() : [];
}

async function setIndex(userId, list) {
  if (list.length === 0) await fb.remove(`${CREDENTIAL_INDEX_PATH}/${safeKey(userId)}`);
  else await fb.set(`${CREDENTIAL_INDEX_PATH}/${safeKey(userId)}`, list);
}

/** Public (safe) view of a stored credential. */
function publicCredential(rec) {
  return {
    id: rec.id,
    deviceName: rec.deviceName || 'Unknown',
    deviceType: rec.deviceType || 'singleDevice',
    backedUp: !!rec.backedUp,
    createdAt: rec.createdAt,
    lastUsedAt: rec.lastUsedAt,
    counter: rec.counter,
  };
}

// ── Registration ──

/**
 * Generate WebAuthn registration options (JSON-serializable).
 * Stores the single-use challenge in the session.
 *
 * @param {Object} session - Express session
 * @param {{ userId: string, userName: string }} identity
 * @param {{ id: string, origin: string }} [rp]
 * @returns {Promise<Object|null>} PublicKeyCredentialCreationOptionsJSON
 */
export async function generateRegistrationChallenge(session, { userId, userName }, rp) {
  if (!userId) return null;
  const rpId = (rp && rp.id) || RP_CONFIG.id || 'localhost';
  const existing = await getIndex(userId);
  const { generateRegistrationOptions } = await swa();

  const options = await generateRegistrationOptions({
    rpName: RP_CONFIG.name,
    rpID: rpId,
    userName,
    userID: userHandleFor(userId),
    userDisplayName: userName,
    attestationType: 'none',
    // residentKey: 'required' → discoverable passkeys → Conditional UI + userless login
    // userVerification: 'required' → NIST AAL2+ (passkey = MFA) — UV'ga majbur
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    // ES256 / RS256 / EdDSA allowlist (stop condition: alg allowlist)
    supportedAlgorithmIDs: [-7, -257, -8],
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
  });

  session.webauthnChallenge = {
    challenge: options.challenge,
    type: 'registration',
    userId,
    createdAt: Date.now(),
  };
  return options;
}

/**
 * Verify a WebAuthn registration response and persist the credential.
 *
 * @param {Object} session
 * @param {Object} response - RegistrationResponseJSON from @simplewebauthn/browser
 * @param {{ id: string, origin: string }} [rp]
 * @returns {Promise<{ ok: boolean, error?: string, credential?: Object }>}
 */
export async function verifyRegistrationResponseFlow(session, response, rp) {
  const stored = session.webauthnChallenge;
  if (!stored || stored.type !== 'registration') {
    return { ok: false, error: 'no_challenge', message: 'Avval passkey ro\'yxatdan o\'tkazishni boshlang.' };
  }
  if (Date.now() - (stored.createdAt || 0) > CHALLENGE_TIMEOUT_MS) {
    delete session.webauthnChallenge;
    return { ok: false, error: 'challenge_expired', message: 'Chaqiruv muddati tugadi. Qayta urinib ko\'ring.' };
  }

  let verification;
  try {
    const { verifyRegistrationResponse } = await swa();
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: (rp && rp.origin) || RP_CONFIG.origin,
      expectedRPID: (rp && rp.id) || RP_CONFIG.id || 'localhost',
      requireUserVerification: true, // AAL2+ — UV majbur (review topilmasi)
    });
  } catch (err) {
    return { ok: false, error: 'verification_failed', message: err.message };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: 'verification_failed', message: 'Registratsiyani tekshirib bo\'lmadi.' };
  }

  const info = verification.registrationInfo;
  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = info;
  const counter = credential.counter;

  // Guard: counter must start at 0 for a fresh credential
  if (counter !== 0) {
    return { ok: false, error: 'counter_anomaly', message: 'Noto\'g\'ri dastlabki counter qiymati.' };
  }

  const userId = stored.userId;

  // Max-credential guard + duplicate check (before writing)
  const index = await getIndex(userId);
  if (index.length >= MAX_CREDENTIALS_PER_USER) {
    return { ok: false, error: 'limit_reached', message: `Ko\'pi bilan ${MAX_CREDENTIALS_PER_USER} ta passkey saqlash mumkin.` };
  }
  if (index.some((c) => c.id === credential.id)) {
    return { ok: false, error: 'duplicate', message: 'Bu passkey allaqachon ro\'yxatdan o\'tgan.' };
  }

  const record = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    aaguid,
    transports: (response && response.response && response.response.transports) || [],
    userId,
    deviceName: 'Qurilma',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  await fb.set(`${CREDENTIAL_BASE_PATH}/${credential.id}`, record);
  index.push({ id: credential.id, createdAt: record.createdAt, transports: record.transports });
  await setIndex(userId, index);

  // Single-use challenge
  delete session.webauthnChallenge;

  await audit({
    action: AUDIT_ACTIONS.PASSKEY_REGISTER,
    userId,
    resourceType: 'passkey',
    details: { credentialId: `${credential.id.slice(0, 12)}…`, deviceType: credentialDeviceType },
  }).catch(() => {});

  return { ok: true, credential: publicCredential(record) };
}

// ── Authentication ──

/**
 * Generate WebAuthn authentication options (JSON-serializable).
 * `userId` is optional: when provided, allowCredentials is scoped to that
 * user's passkeys; when omitted the request is userless/discoverable
 * (required for Conditional UI).
 *
 * `userId` may also be an ARRAY of userIds (e.g. admin current + legacy
 * accounts) — passkeys registered under ANY of the listed ids are merged
 * into allowCredentials so each can be used to sign in.
 *
 * @param {Object} session
 * @param {{ userId?: string | string[] }} [opts]
 * @param {{ id: string, origin: string }} [rp]
 * @returns {Promise<Object|null>} PublicKeyCredentialRequestOptionsJSON
 */
export async function generateAuthenticationChallenge(session, { userId } = {}, rp) {
  const rpId = (rp && rp.id) || RP_CONFIG.id || 'localhost';
  const userIds = Array.isArray(userId) ? userId.filter(Boolean) : (userId ? [userId] : []);
  let allowCredentials;
  if (userIds.length) {
    const creds = [];
    for (const id of userIds) {
      try {
        const userCreds = await getIndex(id);
        if (userCreds.length) creds.push(...userCreds);
      } catch (_) { /* bitta index xatosi qolganlarini buzmasin */ }
    }
    allowCredentials = creds.map((c) => ({ id: c.id, transports: c.transports || [] }));
  }
  const { generateAuthenticationOptions } = await swa();

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials, // undefined → discovery
    userVerification: 'required', // AAL2+ — UV majbur (review topilmasi)
  });

  session.webauthnChallenge = {
    challenge: options.challenge,
    type: 'authentication',
    userId: userIds.length ? userIds[0] : null,
    createdAt: Date.now(),
  };
  return options;
}

/**
 * Verify a WebAuthn assertion, enforce the monotonic counter policy and
 * refresh the credential record.
 *
 * @param {Object} session
 * @param {Object} response - AuthenticationResponseJSON from @simplewebauthn/browser
 * @param {{ id: string, origin: string }} [rp]
 * @returns {Promise<{ ok: boolean, error?: string, userId?: string, credential?: Object }>}
 */
export async function verifyAuthenticationResponseFlow(session, response, rp) {
  const stored = session.webauthnChallenge;
  if (!stored || stored.type !== 'authentication') {
    return { ok: false, error: 'no_challenge', message: 'Avval kirishni boshlang.' };
  }
  if (Date.now() - (stored.createdAt || 0) > CHALLENGE_TIMEOUT_MS) {
    delete session.webauthnChallenge;
    return { ok: false, error: 'challenge_expired', message: 'Chaqiruv muddati tugadi. Qayta urinib ko\'ring.' };
  }

  if (!response || !response.id || !response.response) {
    return { ok: false, error: 'invalid_assertion' };
  }

  const record = await getCredential(response.id);
  if (!record) {
    return { ok: false, error: 'unknown_credential', message: 'Bu passkey tizimda topilmadi.' };
  }

  const prevCounter = record.counter || 0;

  // ── Counter monotonic PRE-check (aniq error kodlari) ──
  // authenticatorData 33-36-baytlarida counter bor; simplewebauthn v13 ham
  // o'zi rad qiladi, lekin bu yerda counter_regression / counter_replay
  // aniq ajratiladi (defense-in-depth).
  let preCounter = 0;
  try {
    const authBuf = Buffer.from(response.response.authenticatorData, 'base64url');
    if (authBuf.length >= 37) preCounter = authBuf.readUInt32BE(33);
  } catch (_) { /* bad base64url → verify quyida rad qiladi */ }
  if (preCounter < prevCounter || (preCounter === prevCounter && prevCounter > 0)) {
    const reason = preCounter < prevCounter ? 'counter_regression' : 'counter_replay';
    await audit({
      action: AUDIT_ACTIONS.PASSKEY_FAIL,
      userId: record.userId,
      resourceType: 'passkey',
      details: { credentialId: `${record.id.slice(0, 12)}…`, reason, prevCounter, newCounter: preCounter },
    }).catch(() => {});
    return { ok: false, error: reason };
  }

  let verification;
  try {
    const { verifyAuthenticationResponse } = await swa();
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: (rp && rp.origin) || RP_CONFIG.origin,
      expectedRPID: (rp && rp.id) || RP_CONFIG.id || 'localhost',
      credential: {
        id: record.id,
        publicKey: Buffer.from(record.publicKey, 'base64url'),
        counter: prevCounter,
        transports: record.transports || [],
      },
      requireUserVerification: true, // AAL2+ — UV majbur (review topilmasi)
    });
  } catch (err) {
    // simplewebauthn v13 counter errori ham shu yerdan keladi
    if (err.message && /counter/i.test(err.message)) {
      return { ok: false, error: 'counter_anomaly', message: err.message };
    }
    return { ok: false, error: 'verification_failed', message: err.message };
  }

  if (!verification.verified) {
    await audit({
      action: AUDIT_ACTIONS.PASSKEY_FAIL,
      userId: record.userId,
      resourceType: 'passkey',
      details: { credentialId: `${record.id.slice(0, 12)}…`, reason: 'assertion_invalid' },
    }).catch(() => {});
    return { ok: false, error: 'assertion_invalid' };
  }

  const newCounter = verification.authenticationInfo.newCounter;

  record.counter = newCounter;
  record.deviceType = verification.authenticationInfo.credentialDeviceType;
  record.backedUp = verification.authenticationInfo.credentialBackedUp;
  record.lastUsedAt = Date.now();
  await fb.set(`${CREDENTIAL_BASE_PATH}/${record.id}`, record);

  // Single-use challenge
  delete session.webauthnChallenge;

  return { ok: true, userId: record.userId, credential: publicCredential(record) };
}

// ── Management ──

/**
 * List a user's passkeys (public view).
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export async function listPasskeys(userId) {
  const index = await getIndex(userId);
  const out = [];
  for (const entry of index) {
    const rec = await getCredential(entry.id);
    if (rec) out.push(publicCredential(rec));
  }
  return out;
}

/**
 * Rename a passkey's device label (owner-only, multi-device management E-05).
 *
 * Validation: trim, 1..50 chars, no control characters — XSS server-side ham
 * tekshiriladi (view'lar auto-escape qiladi, lekin API'ga yomon nom kirmasligi
 * uchun qo'shimcha himoya).
 *
 * @param {string} credentialId
 * @param {string} userId
 * @param {string} newName
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function renamePasskey(credentialId, userId, newName) {
  const name = typeof newName === 'string' ? newName.trim() : '';
  if (!name || name.length > 50) return { ok: false, error: 'invalid_name' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: 'invalid_name' };

  const rec = await getCredential(credentialId);
  if (!rec) return { ok: false, error: 'not_found' };
  // IDOR: boshqa user'ga tegishli bo'lsa ham 'not_found' qaytadi (remove bilan bir xil siyosat).
  if (rec.userId !== userId) return { ok: false, error: 'not_found' };

  const prevName = rec.deviceName || 'Qurilma';
  rec.deviceName = name;
  rec.updatedAt = Date.now();
  await fb.set(`${CREDENTIAL_BASE_PATH}/${credentialId}`, rec);

  await audit({
    action: AUDIT_ACTIONS.PASSKEY_RENAME,
    userId,
    resourceType: 'passkey',
    details: { credentialId: `${credentialId.slice(0, 12)}…`, prevName },
  }).catch(() => {});

  return { ok: true, credential: publicCredential(rec) };
}

/**
 * Remove a passkey (owner-only).
 * @param {string} credentialId
 * @param {string} userId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function removePasskey(credentialId, userId) {
  const rec = await getCredential(credentialId);
  if (!rec) return { ok: false, error: 'not_found' };
  // IDOR: boshqa user'ga tegishli bo'lsa ham 'not_found' qaytadi — credential
  // mavjudligi oshkor bo'lmaydi (review topilmasi).
  if (rec.userId !== userId) return { ok: false, error: 'not_found' };

  await fb.remove(`${CREDENTIAL_BASE_PATH}/${credentialId}`);
  const index = (await getIndex(userId)).filter((c) => c.id !== credentialId);
  await setIndex(userId, index);

  await audit({
    action: AUDIT_ACTIONS.PASSKEY_REMOVE,
    userId,
    resourceType: 'passkey',
    details: { credentialId: `${credentialId.slice(0, 12)}…` },
  }).catch(() => {});

  return { ok: true };
}

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function hasPasskeys(userId) {
  return (await getIndex(userId)).length > 0;
}

/**
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function countPasskeys(userId) {
  return (await getIndex(userId)).length;
}

// ── Config (tests / dynamic) ──

export function setRpConfig(config) {
  if (config.name) RP_CONFIG.name = config.name;
  if (config.id) RP_CONFIG.id = config.id;
  if (config.origin) RP_CONFIG.origin = config.origin;
}

export function getRpConfig() {
  return { ...RP_CONFIG };
}

export { CHALLENGE_TIMEOUT_MS, MAX_CREDENTIALS_PER_USER };
